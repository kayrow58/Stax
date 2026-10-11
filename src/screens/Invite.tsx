import { useState } from 'react'
import { errorText, supabase } from '../lib/supabase'
import type { Couple, Member } from '../lib/types'
import { BackIcon, CopyIcon, ShareIcon } from '../components/Icons'

type Props = {
  couple: Couple
  members: Member[]
  me: Member
  onboarding: boolean
  onNext: () => void
  onBack: () => void
  onJoined: () => void
}

export const prettyCode = (c: string) => (c.length === 6 ? `${c.slice(0, 3)}-${c.slice(3)}` : c)

export function Invite({ couple, members, me, onboarding, onNext, onBack, onJoined }: Props) {
  const [copied, setCopied] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const link = `${window.location.origin}/join/${couple.invite_code}`
  const partner = members.find((m) => m.user_id !== me.user_id)

  async function copy() {
    try {
      await navigator.clipboard.writeText(prettyCode(couple.invite_code))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked */
    }
  }

  async function share() {
    const text = `Join our savings chart on Scratch & Save! Code: ${prettyCode(couple.invite_code)}`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Scratch & Save', text, url: link })
      } catch {
        /* cancelled */
      }
    } else {
      try {
        await navigator.clipboard.writeText(`${text}\n${link}`)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1800)
      } catch {
        /* clipboard blocked */
      }
    }
  }

  async function join(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('join_couple', { p_code: code.trim(), p_name: me.display_name })
    setBusy(false)
    if (error) return setError(errorText(error))
    onJoined()
  }

  return (
    <main className="screen">
      {!onboarding && (
        <button type="button" className="icon-btn" aria-label="Back to the chart" onClick={onBack}>
          <BackIcon />
        </button>
      )}
      <div className="stack">
        {onboarding && <span className="eyebrow">Step 2 of 3</span>}
        <h1 className="title">{partner ? 'You’re saving together' : 'Bring your partner in'}</h1>
        <p className="lede">You&rsquo;ll both see the same chart, live. When one of you opens a square, the other sees it pulse.</p>
      </div>

      {!partner && (
        <section className="panel dark" aria-label="Invite code" style={{ alignItems: 'center' }}>
          <span style={{ fontSize: 14, color: '#B9C6BC' }}>Your invite code</span>
          <span className="code-big">{prettyCode(couple.invite_code)}</span>
          <div className="chips cols-2" style={{ width: '100%' }}>
            <button type="button" className="btn small outline" style={{ color: 'var(--ground)', borderColor: '#4A5E51' }} onClick={() => void copy()}>
              <CopyIcon /> {copied ? 'Copied' : 'Copy code'}
            </button>
            <button type="button" className="btn small gold" onClick={() => void share()}>
              <ShareIcon /> Share link
            </button>
          </div>
        </section>
      )}

      <section className="stack-8" aria-label="Who's on this chart">
        <span className="label">On this chart</span>
        {members.map((m, i) => (
          <div key={m.user_id} className="person">
            <span className={`avatar lg c${i % 2}`} aria-hidden="true">
              {m.display_name.slice(0, 1).toUpperCase()}
            </span>
            <div className="grow">
              <strong>{m.user_id === me.user_id ? `${m.display_name} (you)` : m.display_name}</strong>
              <span className="small">Joined</span>
            </div>
          </div>
        ))}
        {!partner && (
          <div className="person pending">
            <span className="avatar lg empty" aria-hidden="true">
              ?
            </span>
            <div className="grow">
              <strong>Your partner</strong>
              <span className="small">Waiting for them to join</span>
            </div>
          </div>
        )}
      </section>

      {!partner && (
        <form className="stack-8" onSubmit={join}>
          <label className="label" htmlFor="their-code">
            Got a code from your partner instead?
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="their-code" className="input code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn small" style={{ width: 'auto' }} disabled={busy || !code.trim()}>
              Join
            </button>
          </div>
          <span className="small">Joining switches you to their chart.</span>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      )}

      <div className="stack-8 push-down">
        {onboarding ? (
          <>
            <button type="button" className="btn" onClick={onNext}>
              Next: payday reminders
            </button>
            {!partner && <span className="small center">You can invite them later from settings.</span>}
          </>
        ) : (
          <button type="button" className="btn outline" onClick={onBack}>
            Back to the chart
          </button>
        )}
      </div>
    </main>
  )
}
