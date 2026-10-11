import { useState } from 'react'
import { login, MissingIdentityError, requestPasswordRecovery, signup, updateUser } from '@netlify/identity'
import { Logo } from '../components/Icons'

type Mode = 'signup' | 'login' | 'forgot'

function authMessage(e: unknown, mode: Mode): string {
  if (e instanceof MissingIdentityError) return 'Sign-in isn’t turned on for this site yet. In Netlify, turn on Identity (setup guide, step 3).'
  const status = (e as { status?: number }).status
  const msg = (e as Error)?.message ?? ''
  if (/already registered|already exists/i.test(msg)) return 'There’s already an account with that email. Log in instead.'
  if (/not confirmed|confirm/i.test(msg)) return 'Please confirm your email first. Check your inbox for the link.'
  if (status === 400 || status === 401 || /invalid/i.test(msg))
    return mode === 'login' ? 'That email and password don’t match.' : msg || 'Please check your details.'
  if (/password/i.test(msg)) return msg
  return 'Something went wrong. Please try again.'
}

export function SignIn({ joining, notice }: { joining: boolean; notice?: string | null }) {
  const [mode, setMode] = useState<Mode>('signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(notice ?? null)

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
          await login(email.trim(), password)
        } else {
          setInfo(`Almost done! We sent a confirmation link to ${email.trim()}. Tap it, then come back and log in.`)
          setMode('login')
        }
      } else if (mode === 'login') {
        await login(email.trim(), password)
      } else {
        await requestPasswordRecovery(email.trim())
        setInfo(`If there’s an account for ${email.trim()}, we sent a link to reset the password.`)
        setMode('login')
      }
    } catch (err) {
      setError(authMessage(err, mode))
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
        <button className="btn" disabled={busy}>
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
