import { useEffect, useState } from 'react'
import { login, MissingIdentityError, requestPasswordRecovery, signup, updateUser } from '@netlify/identity'
import { FaceIdIcon, Logo } from '../components/Icons'
import { deviceFaceId, faceIdName, faceIdSupported, markPasswordLogin, signInWithFaceId } from '../lib/faceid'

type Mode = 'signup' | 'login' | 'forgot'

const IDENTITY_OFF = 'Sign-in isn\u2019t turned on for this site yet. In Netlify, open Project configuration \u2192 Identity and click Enable Identity (setup guide, step 2).'

/** Is Netlify Identity actually switched on for this site? */
async function identityIsOn(): Promise<boolean> {
  try {
    const r = await fetch('/.netlify/identity/settings', { cache: 'no-store' })
    return r.ok && (r.headers.get('content-type') ?? '').includes('json')
  } catch {
    return true // offline or similar: don't blame Identity
  }
}

async function authMessage(e: unknown, mode: Mode): Promise<string> {
  console.error('sign-in error', e)
  if (e instanceof MissingIdentityError) return IDENTITY_OFF
  const status = (e as { status?: number }).status
  const msg = (e as Error)?.message ?? ''
  if (/already registered|already exists/i.test(msg)) return 'There\u2019s already an account with that email. Log in instead.'
  if (/signups? not allowed|signup.*disabled/i.test(msg))
    return 'New sign-ups are turned off. In Netlify, set Identity \u2192 Registration to Open.'
  if (/not confirmed|confirm/i.test(msg)) return 'Please confirm your email first. Check your inbox for the link.'
  if (/failed to fetch|network/i.test(msg)) return 'Couldn\u2019t reach Stax. Check your connection and try again.'
  if (!(await identityIsOn())) return IDENTITY_OFF
  if (status === 400 || status === 401 || /invalid/i.test(msg))
    return mode === 'login' ? 'That email and password don\u2019t match.' : msg || 'Please check your details.'
  if (/password/i.test(msg)) return msg
  return msg ? `Something went wrong: ${msg}` : 'Something went wrong. Please try again.'
}

export function SignIn({ joining, notice }: { joining: boolean; notice?: string | null }) {
  // Someone who set up Face ID on this phone is a returning user: start on log in.
  const faceIdHere = Boolean(deviceFaceId())
  const [mode, setMode] = useState<Mode>(faceIdHere && !joining ? 'login' : 'signup')
  const [canFaceId, setCanFaceId] = useState(false)
  const [faceBusy, setFaceBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(notice ?? null)

  useEffect(() => {
    void faceIdSupported().then(setCanFaceId)
  }, [])

  async function faceIdSignIn() {
    setFaceBusy(true)
    setError(null)
    setInfo(null)
    const r = await signInWithFaceId()
    // On success the app switches screens by itself.
    if (!r.ok) {
      setFaceBusy(false)
      setError(r.message)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      if (mode === 'signup') {
        const u = await signup(email.trim(), password)
        if (u.confirmedAt) {
          // Auto-confirmed: log straight in so the session cookie is set.
          markPasswordLogin()
          await login(email.trim(), password)
        } else {
          setInfo(`Almost done! We sent a confirmation link to ${email.trim()}. Tap it, then come back and log in.`)
          setMode('login')
        }
      } else if (mode === 'login') {
        markPasswordLogin()
        await login(email.trim(), password)
      } else {
        await requestPasswordRecovery(email.trim())
        setInfo(`If there’s an account for ${email.trim()}, we sent a link to reset the password.`)
        setMode('login')
      }
    } catch (err) {
      setError(await authMessage(err, mode))
    } finally {
      setBusy(false)
    }
  }

  const titles: Record<Mode, string> = {
    signup: joining ? 'Your partner saved you a seat.' : 'Save together, one square at a time.',
    login: 'Welcome back',
    forgot: 'Reset your password',
  }

  return (
    <main className="screen">
      <div style={{ paddingTop: 16 }}>
        <Logo size={56} />
      </div>
      <div className="stack-12">
        <h1 className={'title' + (mode === 'signup' ? ' hero' : '')}>{titles[mode]}</h1>
        {mode === 'signup' && (
          <p className="lede">
            {joining
              ? 'Create an account and you’ll join their savings chart right away.'
              : 'Pick a square, scratch it off, and watch your shared goal fill in. Your money stays in your own bank. Stax just keeps score.'}
          </p>
        )}
        {mode === 'forgot' && <p className="lede">Enter your email and we&rsquo;ll send you a link to choose a new password.</p>}
      </div>

      {info && <div className="notice" role="status">{info}</div>}


      <form className="stack-12 push-down" onSubmit={submit}>
        {canFaceId && mode === 'login' && (
          <>
            <button type="button" className={'btn' + (faceIdHere ? '' : ' outline')} disabled={faceBusy || busy} onClick={() => void faceIdSignIn()}>
              <FaceIdIcon size={24} />
              {faceBusy ? 'One moment…' : `Sign in with ${faceIdName()}`}
            </button>
            <div className="divider" style={{ margin: '8px 0' }}>or use your email</div>
          </>
        )}
        <div className="stack-8">
          <label className="label" htmlFor="email">
            Email
          </label>
          <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {mode !== 'forgot' && (
          <div className="stack-8">
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              minLength={mode === 'signup' ? 8 : undefined}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === 'signup' && <span className="small">At least 8 characters.</span>}
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <button className={'btn' + (canFaceId && faceIdHere && mode === 'login' ? ' outline' : '')} disabled={busy || faceBusy}>
          {busy ? 'One moment…' : mode === 'signup' ? 'Create account' : mode === 'login' ? 'Log in' : 'Send reset link'}
        </button>
        <div className="stack">
          {mode !== 'signup' && (
            <button type="button" className="link-btn" onClick={() => { setMode('signup'); setError(null) }}>
              New here? Create an account
            </button>
          )}
          {mode !== 'login' && (
            <button type="button" className="link-btn" onClick={() => { setMode('login'); setError(null) }}>
              I already have an account
            </button>
          )}
          {mode === 'login' && (
            <button type="button" className="link-btn" onClick={() => { setMode('forgot'); setError(null) }}>
              Forgot your password?
            </button>
          )}
        </div>
      </form>
    </main>
  )
}

/** Shown after someone taps a password-reset link. */
export function NewPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await updateUser({ password })
      onDone()
    } catch (err) {
      setError((err as Error)?.message || 'Couldn’t save that password. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="screen">
      <Logo size={48} />
      <h1 className="title">Choose a new password</h1>
      <form className="stack-12 push-down" onSubmit={submit}>
        <div className="stack-8">
          <label className="label" htmlFor="newpw">
            New password
          </label>
          <input id="newpw" className="input" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
          <span className="small">At least 8 characters.</span>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </main>
  )
}
