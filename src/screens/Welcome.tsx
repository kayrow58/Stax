import { useState } from 'react'
import { errorText, supabase } from '../lib/supabase'
import { Logo } from '../components/Icons'

/** First time after sign-in: pick a name, then start a chart or join a partner's. */
export function Welcome({ inviteCode, onDone }: { inviteCode: string | null; onDone: (joined: boolean) => void }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState(inviteCode ?? '')
  const [haveCode, setHaveCode] = useState(Boolean(inviteCode))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    setBusy(true)
    setError(null)
    const { error } = haveCode && code.trim()
      ? await supabase.rpc('join_couple', { p_code: code.trim(), p_name: n })
      : await supabase.rpc('create_couple', { p_name: n })
    setBusy(false)
    if (error) return setError(errorText(error))
    onDone(haveCode && Boolean(code.trim()))
  }

  return (
    <main className="screen">
      <Logo size={48} />
      <div className="stack-12">
        <h1 className="title">Welcome! What should we call you?</h1>
        <p className="lede">Your partner will see this name next to the squares you scratch.</p>
      </div>
      <form className="stack-12" onSubmit={submit} style={{ flex: 1 }}>
        <div className="stack-8">
          <label className="label" htmlFor="name">
            Your first name
          </label>
          <input id="name" className="input" autoComplete="given-name" maxLength={40} required value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        {haveCode ? (
          <div className="stack-8">
            <label className="label" htmlFor="invite">
              Invite code from your partner
            </label>
            <input id="invite" className="input code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
        ) : null}

        {error && <p className="error" role="alert">{error}</p>}

        <div className="stack-8 push-down">
          <button className="btn" disabled={busy || !name.trim()}>
            {busy ? 'One moment…' : haveCode ? 'Join my partner’s chart' : 'Start our chart'}
          </button>
          <button type="button" className="link-btn" onClick={() => { setHaveCode(!haveCode); setError(null) }}>
            {haveCode ? 'I’m starting a new chart instead' : 'I have an invite code from my partner'}
          </button>
        </div>
      </form>
    </main>
  )
}
