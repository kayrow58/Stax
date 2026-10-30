import { logout } from '@netlify/identity'
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  sendSignal,
  startAuthentication,
  startRegistration,
  WebAuthnError,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import { api, ApiError } from './api'

// Face ID sign-in (passkeys). The server checks Face ID and hands back a
// session token that this phone keeps, so people stay signed in without
// typing a password. See netlify/lib/passkeys.ts.

export type FaceIdSession = { token: string; expires: number; user: { id: string; email: string }; credential_id: string }

const SESSION_KEY = 'stax.faceid.session'
const DEVICE_KEY = 'stax.faceid.device' // which account has Face ID on this phone: { user_id, credential_id }
const ASKED_KEY = (userId: string) => `stax.faceid.asked.${userId}`
const JUST_LOGGED_IN = 'stax.faceid.justLoggedIn'

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function raw(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
  } catch {
    /* storage unavailable */
  }
}

// ---------- The signed-in session ----------

const listeners = new Set<() => void>()
export function onFaceIdChange(fn: () => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
const changed = () => listeners.forEach((fn) => fn())

export function faceIdSession(): FaceIdSession | null {
  const s = read<FaceIdSession>(SESSION_KEY)
  if (!s?.token || !(s.expires > Date.now())) return null
  return s
}

function saveSession(s: FaceIdSession) {
  write(SESSION_KEY, s)
  write(DEVICE_KEY, { user_id: s.user.id, credential_id: s.credential_id })
  changed()
}

/** Ends the Face ID session (the passkey itself stays on the phone for next time). */
export function clearFaceIdSession() {
  write(SESSION_KEY, null)
  changed()
}

/** Log out of everything: the Face ID session and Netlify Identity. */
export async function signOut() {
  clearFaceIdSession()
  await logout().catch(() => undefined)
}

// ---------- What this phone knows ----------

export function deviceFaceId(): { user_id: string; credential_id: string } | null {
  return read(DEVICE_KEY)
}
export function hasFaceIdHere(userId: string) {
  return deviceFaceId()?.user_id === userId
}

let supportCache: Promise<boolean> | null = null
/** Can this phone use Face ID / Touch ID with websites? */
export function faceIdSupported(): Promise<boolean> {
  if (!supportCache) {
    supportCache = browserSupportsWebAuthn()
      ? platformAuthenticatorIsAvailable().catch(() => false)
      : Promise.resolve(false)
  }
  return supportCache
}

/** "Face ID" on iPhone, "Touch ID" on Mac, a generic name elsewhere. */
export function faceIdName(): string {
  const ua = navigator.userAgent
  if (/iphone|ipad|ipod/i.test(ua)) return 'Face ID'
  if (/macintosh/i.test(ua)) return 'Touch ID'
  return 'Face or fingerprint unlock'
}

function deviceLabel(): string {
  const ua = navigator.userAgent
  if (/iphone/i.test(ua)) return 'iPhone'
  if (/ipad/i.test(ua)) return 'iPad'
  if (/android/i.test(ua)) return 'Android phone'
  if (/macintosh/i.test(ua)) return 'Mac'
  if (/windows/i.test(ua)) return 'Windows PC'
  return 'Device'
}

// ---------- When to ask ----------

/** Called right after someone logs in with their email and password. */
export function markPasswordLogin() {
  write(JUST_LOGGED_IN, '1')
}

/** Ask after every password login, and once for anyone already signed in who hasn't been asked. */
export function shouldOfferFaceId(userId: string): boolean {
  if (hasFaceIdHere(userId)) return false
  return raw(JUST_LOGGED_IN) === '1' || raw(ASKED_KEY(userId)) === null
}

/** "Not now": don't ask again until the next password login. */
export function dismissFaceIdOffer(userId: string) {
  write(ASKED_KEY(userId), '1')
  write(JUST_LOGGED_IN, null)
}

// ---------- Turning it on ----------

export type SetupResult = { ok: true } | { ok: false; cancelled?: boolean; message: string }

export async function turnOnFaceId(userId: string): Promise<SetupResult> {
  const name = faceIdName()
  try {
    const { options, challenge_id } = await api<{ options: PublicKeyCredentialCreationOptionsJSON; challenge_id: string }>(
      'POST',
      '/passkey/register/options',
      {},
    )
    const response = await startRegistration({ optionsJSON: options })
    const session = await api<Omit<FaceIdSession, 'user'>>('POST', '/passkey/register/verify', {
      challenge_id,
      response,
      device: deviceLabel(),
    })
    const me = await api<{ me: { user_id: string; email: string } }>('GET', '/state')
    saveSession({ ...session, user: { id: me.me.user_id, email: me.me.email } })
    write(ASKED_KEY(userId), '1')
    write(JUST_LOGGED_IN, null)
    return { ok: true }
  } catch (e) {
    if (e instanceof WebAuthnError && e.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
      return { ok: false, message: `${name} is already set up for this account on this phone. Next time you’re signed out, tap “Sign in with ${name}.”` }
    }
    if (e instanceof Error && e.name === 'NotAllowedError') return { ok: false, cancelled: true, message: `${name} wasn’t set up.` }
    if (e instanceof ApiError) return { ok: false, message: e.message }
    console.error('Face ID setup failed', e)
    return { ok: false, message: `${name} couldn’t be set up on this phone. Please try again.` }
  }
}

export async function turnOffFaceId(): Promise<void> {
  const here = deviceFaceId()
  if (here) await api('DELETE', '/passkey', { id: here.credential_id })
  write(DEVICE_KEY, null)
  // Stay signed in: keep the session if there's also a password session, otherwise this ends it.
  clearFaceIdSession()
}

// ---------- Signing in ----------

export async function signInWithFaceId(): Promise<SetupResult> {
  const name = faceIdName()
  try {
    const { options, challenge_id } = await api<{ options: PublicKeyCredentialRequestOptionsJSON; challenge_id: string }>(
      'POST',
      '/passkey/login/options',
      {},
    )
    const response = await startAuthentication({ optionsJSON: options })
    try {
      const session = await api<FaceIdSession>('POST', '/passkey/login/verify', { challenge_id, response })
      saveSession(session)
      return { ok: true }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // The phone has a passkey the server no longer knows: ask the phone to forget it.
        void sendSignal({ signalName: 'unknownCredential', rpID: options.rpId ?? location.hostname, credentialID: response.id }).catch(() => undefined)
        write(DEVICE_KEY, null)
      }
      throw e
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'NotAllowedError') {
      return { ok: false, cancelled: true, message: `No ${name} sign-in was used. If you haven’t set it up yet, log in with your email and password first.` }
    }
    if (e instanceof ApiError) return { ok: false, message: e.message }
    console.error('Face ID sign-in failed', e)
    return { ok: false, message: `${name} sign-in didn’t work. Please try again or use your password.` }
  }
}
