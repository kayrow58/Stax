import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import type { KV } from './kv'
import type { AuthUser } from './auth'

// ---------- Face ID sign-in (passkeys) ----------
// passkey/{credentialId}         → the public key for one passkey, and whose it is
// pkuser/{userId}/{credentialId} → index of a person's passkeys
// pkchallenge/{id}               → one-time challenge, used once then deleted
// system/session-secret          → key that signs Face ID sessions, created automatically
//
// After Face ID succeeds, the server hands back its own signed session token
// ("stx." prefix). The API accepts it alongside Netlify Identity's token.
// Removing a passkey ends every session that came from it.

export type PasskeyDoc = {
  id: string
  user_id: string
  email: string
  public_key: string // base64url
  counter: number
  transports?: string[]
  backed_up: boolean
  device: string
  created_at: string
  last_used_at: string | null
}
type Challenge = { challenge: string; user_id: string | null; expires: number }
type SessionPayload = { sub: string; email: string; cred: string; exp: number }

export const SESSION_DAYS = 30
const CHALLENGE_MS = 5 * 60_000
const RP_NAME = 'Stax'

const K = {
  passkey: (id: string) => `passkey/${id}`,
  byUser: (userId: string, id = '') => `pkuser/${userId}/${id}`,
  challenge: (id: string) => `pkchallenge/${id}`,
  secret: 'system/session-secret',
}

export class PasskeyError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
const fail = (status: number, message: string): never => {
  throw new PasskeyError(status, message)
}

/** The site's own address: passkeys only work on the domain they were made for. */
function site(req: Request) {
  const url = new URL(req.url)
  return { rpID: url.hostname, origin: url.origin }
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url')
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'))

// ---------- Session tokens ----------

let secretCache: Buffer | null = null
async function secret(kv: KV): Promise<Buffer> {
  if (secretCache) return secretCache
  const fromEnv = process.env.SESSION_SECRET
  if (fromEnv && fromEnv.length >= 32) return (secretCache = Buffer.from(fromEnv))
  let got = await kv.get<{ key: string }>(K.secret)
  if (!got) {
    await kv.set(K.secret, { key: b64(randomBytes(32)) }, { onlyIfNew: true })
    got = await kv.get<{ key: string }>(K.secret)
  }
  return (secretCache = Buffer.from(got!.data.key, 'base64url'))
}

const sign = (key: Buffer, body: string) => createHmac('sha256', key).update(body).digest('base64url')

export async function issueSession(kv: KV, cred: PasskeyDoc, now = Date.now()) {
  const payload: SessionPayload = { sub: cred.user_id, email: cred.email, cred: cred.id, exp: now + SESSION_DAYS * 86400_000 }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return { token: `stx.${body}.${sign(await secret(kv), body)}`, expires: payload.exp }
}

const sessionCache = new Map<string, { user: AuthUser; until: number }>()

/** Check a Face ID session token. Returns null if it's forged, expired, or its passkey was removed. */
export async function sessionUser(kv: KV, token: string, now = Date.now()): Promise<AuthUser | null> {
  const hit = sessionCache.get(token)
  if (hit && hit.until > now) return hit.user
  const [prefix, body, sig] = token.split('.')
  if (prefix !== 'stx' || !body || !sig) return null
  const want = Buffer.from(sign(await secret(kv), body))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  let p: SessionPayload
  try {
    p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!p.sub || !p.cred || !(p.exp > now)) return null
  const cred = await kv.get<PasskeyDoc>(K.passkey(p.cred))
  if (!cred || cred.data.user_id !== p.sub) return null
  const user = { id: p.sub, email: cred.data.email || p.email }
  if (sessionCache.size > 1000) sessionCache.clear()
  // Re-check every minute so a removed passkey stops working quickly.
  sessionCache.set(token, { user, until: Math.min(now + 60_000, p.exp) })
  return user
}

// ---------- Challenges ----------

async function saveChallenge(kv: KV, challenge: string, userId: string | null) {
  const id = b64(randomBytes(18))
  await kv.set(K.challenge(id), { challenge, user_id: userId, expires: Date.now() + CHALLENGE_MS } satisfies Challenge)
  return id
}

/** One use only: the challenge is deleted as soon as it's read. */
async function takeChallenge(kv: KV, id: unknown, userId: string | null): Promise<string> {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{10,40}$/.test(id)) return fail(400, 'That Face ID request expired. Please try again.')
  const got = await kv.get<Challenge>(K.challenge(id))
  await kv.delete(K.challenge(id))
  if (!got || got.data.expires < Date.now() || got.data.user_id !== userId) fail(400, 'That Face ID request expired. Please try again.')
  return got!.data.challenge
}

// ---------- Setting up Face ID ----------

export async function listPasskeys(kv: KV, userId: string): Promise<PasskeyDoc[]> {
  const keys = await kv.list(K.byUser(userId))
  const docs = await Promise.all(keys.map((k) => kv.get<PasskeyDoc>(K.passkey(k.slice(K.byUser(userId).length)))))
  return docs.flatMap((d) => (d && d.data.user_id === userId ? [d.data] : []))
}

export async function registerOptions(kv: KV, user: AuthUser, req: Request) {
  const { rpID } = site(req)
  const existing = await listPasskeys(kv, user.id)
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: user.email || user.id,
    userDisplayName: user.email || 'Stax',
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    // Don't make a second passkey on a phone that already has one for this account.
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' },
  })
  return { options, challenge_id: await saveChallenge(kv, options.challenge, user.id) }
}

export async function registerVerify(
  kv: KV,
  user: AuthUser,
  req: Request,
  body: { challenge_id?: unknown; response?: unknown; device?: unknown },
) {
  const expectedChallenge = await takeChallenge(kv, body.challenge_id, user.id)
  const { rpID, origin } = site(req)
  let result
  try {
    result = await verifyRegistrationResponse({
      response: body.response as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    })
  } catch (e) {
    console.error('passkey registration failed', e)
    return fail(400, 'Face ID couldn’t be set up. Please try again.')
  }
  if (!result.verified) return fail(400, 'Face ID couldn’t be set up. Please try again.')
  const info = result.registrationInfo
  const now = new Date().toISOString()
  const doc: PasskeyDoc = {
    id: info.credential.id,
    user_id: user.id,
    email: user.email,
    public_key: b64(info.credential.publicKey),
    counter: info.credential.counter,
    transports: info.credential.transports,
    backed_up: info.credentialBackedUp,
    device: typeof body.device === 'string' ? body.device.slice(0, 30) : 'Phone',
    created_at: now,
    last_used_at: now,
  }
  if (!(await kv.set(K.passkey(doc.id), doc, { onlyIfNew: true }))) fail(409, 'That passkey is already in use.')
  await kv.set(K.byUser(user.id, doc.id), { created_at: now })
  return { credential_id: doc.id, ...(await issueSession(kv, doc)) }
}

export async function removePasskey(kv: KV, user: AuthUser, id: unknown) {
  if (typeof id !== 'string' || !id) return fail(400, 'Missing passkey.')
  const got = await kv.get<PasskeyDoc>(K.passkey(id))
  if (got && got.data.user_id !== user.id) return fail(404, 'Not found.')
  await kv.delete(K.passkey(id))
  await kv.delete(K.byUser(user.id, id))
  for (const [t, v] of sessionCache) if (v.user.id === user.id) sessionCache.delete(t)
}

// ---------- Signing in with Face ID ----------

export async function loginOptions(kv: KV, req: Request) {
  const { rpID } = site(req)
  // No account list: the phone offers whichever Stax passkey it has.
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' })
  return { options, challenge_id: await saveChallenge(kv, options.challenge, null) }
}

export async function loginVerify(kv: KV, req: Request, body: { challenge_id?: unknown; response?: unknown }) {
  const expectedChallenge = await takeChallenge(kv, body.challenge_id, null)
  const response = body.response as AuthenticationResponseJSON
  const id = typeof response?.id === 'string' ? response.id : ''
  const stored = id ? await kv.get<PasskeyDoc>(K.passkey(id)) : null
  if (!stored) return fail(404, 'This Face ID sign-in isn’t linked to a Stax account anymore. Log in with your email and password.')
  const cred = stored.data
  const { rpID, origin } = site(req)
  let result
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: { id: cred.id, publicKey: unb64(cred.public_key), counter: cred.counter, transports: cred.transports },
    })
  } catch (e) {
    console.error('passkey sign-in failed', e)
    return fail(401, 'Face ID sign-in didn’t work. Please try again.')
  }
  if (!result.verified) return fail(401, 'Face ID sign-in didn’t work. Please try again.')
  cred.counter = result.authenticationInfo.newCounter
  cred.last_used_at = new Date().toISOString()
  await kv.set(K.passkey(cred.id), cred)
  return { credential_id: cred.id, user: { id: cred.user_id, email: cred.email }, ...(await issueSession(kv, cred)) }
}
