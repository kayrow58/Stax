import { useEffect, useState } from 'react'
import { getUser, handleAuthCallback, logout, onAuthChange, type User } from '@netlify/identity'
import { api, errorText } from './lib/api'
import { useCouple } from './lib/useCouple'
import type { AppState, PayKind } from './lib/types'
import { NewPassword, SignIn } from './screens/SignIn'
import { Welcome } from './screens/Welcome'
import { Setup } from './screens/Setup'
import { Invite } from './screens/Invite'
import { Settings } from './screens/Settings'
import { Board } from './screens/Board'

const INVITE_KEY = 'ss.invite'

// Capture /join/CODE links before anything else, then tidy the address bar.
function captureInvite() {
  const m = window.location.pathname.match(/^\/join\/([A-Za-z0-9-]{4,12})\/?$/)
  if (m) {
    localStorage.setItem(INVITE_KEY, m[1].toUpperCase().replace(/-/g, ''))
    window.history.replaceState(null, '', '/' + window.location.hash)
  }
}
captureInvite()
/** Signed in only counts once the session cookie the API reads is in place. */
const hasSession = () => /(?:^|;\s*)nf_jwt=/.test(document.cookie)
const pendingInvite = () => localStorage.getItem(INVITE_KEY)
const clearInvite = () => localStorage.removeItem(INVITE_KEY)

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [recovering, setRecovering] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      // Handles links from emails: confirming an account, or resetting a password.
      try {
        const cb = await handleAuthCallback()
        if (cb?.type === 'recovery') setRecovering(true)
        if (cb?.type === 'confirmation') setNotice('Your email is confirmed. Welcome to Stax!')
      } catch (e) {
        setNotice(`That link didn’t work (${errorText(e)}). It may have expired; try again.`)
      }
      const u = await getUser()
      if (alive) setUser(u && hasSession() ? u : null)
    })()
    const off = onAuthChange((event, u) => {
      if (event === 'recovery') setRecovering(true)
      setUser(u && hasSession() ? u : null)
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  if (user === undefined) return <Loading />
  if (recovering && user) return <NewPassword onDone={() => setRecovering(false)} />
  if (!user) return <SignIn joining={Boolean(pendingInvite())} notice={notice} />
  return <Home key={user.id} />
}

type View = 'board' | 'invite' | 'settings' | 'newchart'
type Onboarding = null | 'invite' | 'reminders'

function Home() {
  const c = useCouple()
  const [view, setView] = useState<View>('board')
  const [onboarding, setOnboarding] = useState<Onboarding>(null)
  const [chosenFreq, setChosenFreq] = useState<PayKind | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Already on a solo chart and then opened a partner's invite link: switch over.
  useEffect(() => {
    const code = pendingInvite()
    if (!code || !c.member || !c.couple) return
    clearInvite()
    if (code === c.couple.invite_code) return
    if (c.members.length > 1) {
      setNotice('You opened an invite link, but you’re already sharing a chart with someone.')
      return
    }
    if (c.chart && c.squares.some((s) => s.scratched_at)) {
      setNotice(
        `You opened an invite link, but you already have a chart with progress. To switch to theirs, go to Settings → Invite your partner and enter code ${code}.`,
      )
      return
    }
    void api<AppState>('POST', '/couple/join', { code, name: c.member.display_name })
      .then(c.apply)
      .catch((e) => setNotice(errorText(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.member?.user_id, c.couple?.id])

  if (c.signedOut) {
    void logout().catch(() => undefined)
    return <Loading />
  }
  if (c.loading) return <Loading />
  if (c.error && !c.member) return <ErrorScreen message={c.error} onRetry={() => void c.reload()} />

  let screen: React.ReactNode
  if (!c.member || !c.couple) {
    screen = (
      <Welcome
        inviteCode={pendingInvite()}
        onDone={(joined, state) => {
          clearInvite()
          setOnboarding(joined ? 'reminders' : null)
          c.apply(state)
        }}
      />
    )
  } else if (!c.chart || view === 'newchart') {
    screen = (
      <Setup
        replacing={Boolean(c.chart)}
        defaultFreq={c.schedule?.kind ?? null}
        onCancel={c.chart ? () => setView('board') : undefined}
        onCreated={(freq, state) => {
          setChosenFreq(freq)
          setView('board')
          if (!c.chart) setOnboarding(c.members.length > 1 ? 'reminders' : 'invite')
          c.apply(state)
        }}
      />
    )
  } else if (onboarding === 'invite' || view === 'invite') {
    screen = (
      <Invite
        couple={c.couple}
        members={c.members}
        me={c.member}
        onboarding={onboarding === 'invite'}
        onNext={() => setOnboarding('reminders')}
        onBack={() => setView('board')}
        onJoined={(state) => {
          setView('board')
          setOnboarding(null)
          c.apply(state)
        }}
      />
    )
  } else if (onboarding === 'reminders' || view === 'settings') {
    screen = (
      <Settings
        me={c.member}
        schedule={c.schedule}
        defaultKind={chosenFreq}
        onboarding={onboarding === 'reminders'}
        onSaved={(s) => {
          c.setSchedule(s)
          if (onboarding) setOnboarding(null)
        }}
        onBack={() => {
          setOnboarding(null)
          setView('board')
        }}
        onInvite={() => setView('invite')}
        onNewChart={() => setView('newchart')}
        onRenamed={() => void c.reload()}
      />
    )
  } else {
    screen = (
      <Board
        me={c.member}
        members={c.members}
        chart={c.chart}
        squares={c.squares}
        schedule={c.schedule}
        partnerViewing={c.partnerViewing}
        remote={c.remote}
        setViewing={c.setViewing}
        patchSquare={c.patchSquare}
        mutate={c.mutate}
        onSettings={() => setView('settings')}
        onInvite={() => setView('invite')}
        onNewChart={() => setView('newchart')}
      />
    )
  }

  return (
    <>
      {screen}
      {notice && (
        <div className="toast" role="alert">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)}>
            OK
          </button>
        </div>
      )}
    </>
  )
}

function Loading() {
  return (
    <div className="loading" aria-label="Loading">
      <div className="spinner" />
    </div>
  )
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="screen">
      <h1 className="title">Couldn&rsquo;t load your chart</h1>
      <p className="lede">{message}</p>
      <div className="stack-8 push-down">
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
        <button type="button" className="link-btn" onClick={() => void logout()}>
          Log out
        </button>
      </div>
    </main>
  )
}
