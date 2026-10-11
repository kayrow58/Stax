import { useEffect, useState } from 'react'
import { logout } from '@netlify/identity'
import { hourLabel, localTimeZone, nextPayday, prettyDate, todayIn } from '../lib/payday'
import { isInstalled, isIOS, pushIsOn, sendTestPush, turnOffPush, turnOnPush, type PushResult } from '../lib/push'
import { setSoundOn, soundOn } from '../lib/feedback'
import { api, errorText } from '../lib/api'
import type { Member, PayKind, PaySchedule } from '../lib/types'
import { BackIcon } from '../components/Icons'

const KINDS: [PayKind, string][] = [
  ['weekly', 'Weekly'],
  ['biweekly', 'Every 2 weeks'],
  ['semimonthly', '1st and 15th'],
  ['monthly', 'Monthly'],
]
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6)

export const denseGrid = () => localStorage.getItem('ss.dense') === '1'

const PUSH_MESSAGES: Record<Exclude<PushResult, 'ok'>, string> = {
  denied: 'Notifications are blocked. Turn them on for Stax in your phone’s settings, then try again.',
  unsupported: 'This browser can’t show notifications. Try Chrome on Android, or Safari on iPhone after adding Stax to your Home Screen.',
  'needs-install': 'On iPhone, add Stax to your Home Screen first: tap Share, then “Add to Home Screen”. Open it from there and turn this on.',
  error: 'Couldn’t turn on notifications. Please try again.',
}

type Props = {
  me: Member
  schedule: PaySchedule | null
  defaultKind: PayKind | null
  onboarding: boolean
  onSaved: (s: PaySchedule) => void
  onBack: () => void
  onInvite: () => void
  onNewChart: () => void
  onRenamed: () => void
}

export function Settings({ me, schedule, defaultKind, onboarding, onSaved, onBack, onInvite, onNewChart, onRenamed }: Props) {
  const tz = schedule?.timezone || localTimeZone()
  const today = todayIn(tz)
  const [kind, setKind] = useState<PayKind>(schedule?.kind ?? defaultKind ?? 'biweekly')
  const [anchor, setAnchor] = useState(schedule?.anchor_date ?? today)
  const [hour, setHour] = useState(schedule?.remind_hour ?? 9)
  const [push, setPush] = useState(false)
  const [pushMsg, setPushMsg] = useState<string | null>(null)
  const [name, setName] = useState(me.display_name)
  const [dense, setDense] = useState(denseGrid())
  const [sound, setSound] = useState(soundOn())
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void pushIsOn().then(setPush)
  }, [])

  const needsAnchor = kind !== 'semimonthly'
  const next = nextPayday(kind, needsAnchor ? anchor : null, today)

  async function togglePush() {
    setPushMsg(null)
    if (push) {
      await turnOffPush()
      setPush(false)
      return
    }
    const r = await turnOnPush()
    if (r === 'ok') {
      setPush(true)
      setPushMsg('Notifications are on for this phone.')
    } else setPushMsg(PUSH_MESSAGES[r])
  }

  async function testPush() {
    setPushMsg(null)
    try {
      const sent = await sendTestPush()
      setPushMsg(sent ? 'Sent! It should appear in a few seconds.' : 'No phones are set up for notifications yet.')
    } catch (e) {
      setPushMsg(errorText(e))
    }
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const s = await api<PaySchedule>('PUT', '/schedule', {
        kind,
        anchor_date: needsAnchor ? anchor : null,
        remind_hour: hour,
        timezone: localTimeZone(),
      })
      if (name.trim() && name.trim() !== me.display_name) {
        await api('POST', '/profile', { name: name.trim() })
        onRenamed()
      }
      onSaved(s)
      if (!onboarding) {
        setSaved(true)
        window.setTimeout(() => setSaved(false), 1800)
      }
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="screen">
      {!onboarding && (
        <button type="button" className="icon-btn" aria-label="Back to the chart" onClick={onBack}>
          <BackIcon />
        </button>
      )}
      <div className="stack">
        {onboarding && <span className="eyebrow">Step 3 of 3</span>}
        <h1 className="title">{onboarding ? 'When do you get paid?' : 'Settings'}</h1>
        <p className="lede">We&rsquo;ll nudge you on payday. You and your partner each set your own schedule.</p>
      </div>

      <div className="stack-8">
        <span className="label" id="kind">
          Your pay schedule
        </span>
        <div className="chips cols-2" role="group" aria-labelledby="kind">
          {KINDS.map(([k, l]) => (
            <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {needsAnchor && (
        <div className="stack-8">
          <label className="label" htmlFor="anchor">
            {kind === 'monthly' ? 'A recent or upcoming payday' : 'Your next payday'}
          </label>
          <input id="anchor" className="input" type="date" value={anchor} onChange={(e) => setAnchor(e.target.value || today)} />
        </div>
      )}

      <div className="stack-8">
        <label className="label" htmlFor="hour">
          Remind me at
        </label>
        <select id="hour" className="select" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {hourLabel(h)}
            </option>
          ))}
        </select>
        {next && (
          <span className="small">
            Next reminder: {next === today ? 'today' : prettyDate(next)} at {hourLabel(hour)}
          </span>
        )}
      </div>

      <button type="button" role="switch" aria-checked={push} className="switch-row" onClick={() => void togglePush()}>
        <span className="grow">
          <strong>Payday notifications on this phone</strong>
          <span className="small">{isIOS() && !isInstalled() ? 'iPhone: add Stax to your Home Screen first' : 'Turn on for each phone you use'}</span>
        </span>
        <span className="track" aria-hidden="true" />
      </button>
      {push && (
        <button type="button" className="link-btn" onClick={() => void testPush()}>
          Send a test notification
        </button>
      )}
      {pushMsg && <div className="notice" role="status">{pushMsg}</div>}

      {!onboarding && (
        <>
          <div className="stack-8">
            <label className="label" htmlFor="myname">
              Your name
            </label>
            <input id="myname" className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={dense}
            className="switch-row"
            onClick={() => {
              localStorage.setItem('ss.dense', dense ? '0' : '1')
              setDense(!dense)
            }}
          >
            <span className="grow">
              <strong>Classic 10-across grid</strong>
              <span className="small">Smaller squares that look like the printable chart</span>
            </span>
            <span className="track" aria-hidden="true" />
          </button>

          <button
            type="button"
            role="switch"
            aria-checked={sound}
            className="switch-row"
            onClick={() => {
              setSoundOn(!sound)
              setSound(!sound)
            }}
          >
            <span className="grow">
              <strong>Scratch sounds</strong>
              <span className="small">The scratch and the chime when you finish</span>
            </span>
            <span className="track" aria-hidden="true" />
          </button>
        </>
      )}

      {error && <p className="error" role="alert">{error}</p>}

      <div className="stack-8 push-down">
        <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : onboarding ? 'Save and open our chart' : saved ? 'Saved' : 'Save settings'}
        </button>
        {onboarding ? (
          <button type="button" className="link-btn" onClick={onBack}>
            Skip for now
          </button>
        ) : (
          <>
            <button type="button" className="link-btn" onClick={onInvite}>
              Invite your partner
            </button>
            <button type="button" className="link-btn" onClick={onNewChart}>
              Start a new chart
            </button>
            <button
              type="button"
              className="link-btn danger"
              onClick={() => {
                void turnOffPush().finally(() => void logout())
              }}
            >
              Log out
            </button>
          </>
        )}
      </div>
    </main>
  )
}
