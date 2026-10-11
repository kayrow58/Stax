import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configured, errorText, supabase } from './lib/supabase'
import { useCouple } from './lib/useCouple'
import type { PayKind } from './lib/types'
import { SignIn } from './screens/SignIn'
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
    localStorage.setItem(INVITE_KEY, m[1].toUpperCase())
    window.history.replaceState(null, '', '/' + window.location.hash)
  }
}
captureInvite()
const pendingInvite = () => localStorage.getItem(INVITE_KEY)
const clearInvite = () => localStorage.removeItem(INVITE_KEY)

export default function App() {
  if (!configured) return <NotConfigured />
  return <Root />
}

function Root() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <Loading />
  if (!session) return <SignIn joining={Boolean(pendingInvite())} />
  return <Home key={session.user.id} userId={session.user.id} />
}

type View = 'board' | 'invite' | 'settings' | 'newchart'
type Onboarding = null | 'invite' | 'reminders'

function Home({ userId }: { userId: string }) {
  const c = useCouple(userId)
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
    void supabase.rpc('join_couple', { p_code: code, p_name: c.member.display_name }).then(({ error }) => {
      if (error) setNotice(errorText(error))
      else void c.reload()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.member?.user_id, c.couple?.id])

  if (c.loading) return <Loading />
  if (c.error && !c.member) return <ErrorScreen message={c.error} onRetry={() => void c.reload()} />

  let screen: React.ReactNode
  if (!c.member || !c.couple) {
    screen = (
      <Welcome
        inviteCode={pendingInvite()}
        onDone={(joined) => {
          clearInvite()
          setOnboarding(joined ? 'reminders' : null)
          void c.reload()
        }}
      />
    )
  } else if (!c.chart || view === 'newchart') {
    screen = (
      <Setup
        replacing={Boolean(c.chart)}
        defaultFreq={c.schedule?.kind ?? null}
        onCancel={c.chart ? () => setView('board') : undefined}
        onCreated={(freq) => {
          setChosenFreq(freq)
          setView('board')
          if (!c.chart) setOnboarding(c.members.length > 1 ? 'reminders' : 'invite')
          void c.reload()
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
        onJoined={() => {
          setView('board')
          setOnboarding(null)
          void c.reload()
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
        <button type="button" className="link-btn" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    </main>
  )
}

function NotConfigured() {
  return (
    <main className="screen">
      <h1 className="title">Almost there</h1>
      <p className="lede">
        This copy of Scratch &amp; Save isn&rsquo;t connected to a database yet. Add <code>VITE_SUPABASE_URL</code> and{' '}
        <code>VITE_SUPABASE_KEY</code> to your environment variables (see the setup guide, step 4), then redeploy.
      </p>
    </main>
  )
}
