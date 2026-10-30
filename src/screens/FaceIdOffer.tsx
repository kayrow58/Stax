import { useState } from 'react'
import { dismissFaceIdOffer, faceIdName, turnOnFaceId } from '../lib/faceid'
import { track } from '../lib/track'
import { FaceIdIcon } from '../components/Icons'

/** Shown after a password login (and once for people already signed in): offer Face ID sign-in. */
export function FaceIdOffer({ userId, onDone }: { userId: string; onDone: (turnedOn: boolean) => void }) {
  const name = faceIdName()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function turnOn() {
    setBusy(true)
    setError(null)
    const r = await turnOnFaceId(userId)
    setBusy(false)
    if (r.ok) onDone(true)
    else if (!r.cancelled) setError(r.message)
  }

  return (
    <main className="screen">
      <div className="faceid-badge" style={{ marginTop: 16 }}>
        <FaceIdIcon size={44} />
      </div>
      <div className="stack-12">
        <h1 className="title">Skip the password next time?</h1>
        <p className="lede">
          Turn on {name} and Stax keeps you signed in. If you&rsquo;re ever logged out, one glance at your phone gets you back in. No email or password to
          type.
        </p>
        <p className="small">Your face never leaves your phone. Stax only gets a secure key that proves it&rsquo;s you.</p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="stack-8 push-down">
        <button type="button" className="btn" disabled={busy} onClick={() => void turnOn()}>
          {busy ? 'One moment…' : `Turn on ${name}`}
        </button>
        <button
          type="button"
          className="link-btn"
          disabled={busy}
          onClick={() => {
            dismissFaceIdOffer(userId)
            track('passkey_declined')
            onDone(false)
          }}
        >
          Not now
        </button>
      </div>
    </main>
  )
}
