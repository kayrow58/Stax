import { useEffect, useState } from 'react'
import { errorText, supabase } from '../lib/supabase'
import { Logo } from '../components/Icons'

export function SignIn({ joining }: { joining: boolean }) {
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => window.clearTimeout(t)
  }, [cooldown])

  async function send(e?: React.FormEvent) {
    e?.preventDefault()
    const addr = (sentTo ?? email).trim()
    if (!addr) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { emailRedirectTo: window.location.origin, shouldCreateUser: true },
    })
    setBusy(false)
    if (error) return setError(errorText(error))
    setSentTo(addr)
    setCooldown(60)
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    if (!sentTo || code.trim().length < 6) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.verifyOtp({ email: sentTo, token: code.trim(), type: 'email' })
    setBusy(false)
    if (error) setError('That code didn’t work. Check the newest email, or send a new one.')
  }

  if (sentTo) {
    return (
      <main className="screen">
        <Logo size={48} />
        <div className="stack-12">
          <h1 className="title">Check your email</h1>
          <p className="lede">
            We sent a sign-in link to <strong>{sentTo}</strong>. Tap it on this device, or type the code from the email here.
          </p>
        </div>
        <form className="stack-8" onSubmit={verify}>
          <label className="label" htmlFor="code">
            Code from the email
          </label>
          <input
            id="code"
            className="input code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={10}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn" disabled={busy || code.length < 6}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
        </form>
        <div className="stack-8 push-down">
          <button type="button" className="link-btn" disabled={cooldown > 0 || busy} onClick={() => void send()}>
            {cooldown > 0 ? `Send a new email in ${cooldown}s` : 'Send a new email'}
          </button>
          <button type="button" className="link-btn" onClick={() => { setSentTo(null); setCode(''); setError(null) }}>
            Use a different email
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="screen">
      <div style={{ paddingTop: 24 }}>
        <Logo size={56} />
      </div>
      <div className="stack-12">
        <h1 className="title hero">{joining ? 'Your partner saved you a seat.' : 'Save together, one square at a time.'}</h1>
        <p className="lede">
          {joining
            ? 'Sign in and you’ll join their savings chart right away.'
            : 'Pick a square, scratch it off, and watch your shared goal fill in. Your money stays in your own bank. This just keeps score.'}
        </p>
      </div>
      <form className="stack-12 push-down" onSubmit={send}>
        <div className="stack-8">
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" disabled={busy}>
          {busy ? 'Sending…' : 'Email me a sign-in link'}
        </button>
        <p className="small center" style={{ margin: 0 }}>
          No password. We&rsquo;ll send a link that signs you right in.
        </p>
      </form>
    </main>
  )
}
