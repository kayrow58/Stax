import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { crossedMilestone, money } from '../lib/chart'
import { chime } from '../lib/feedback'
import { isPayday, todayIn } from '../lib/payday'
import { api, errorText } from '../lib/api'
import { track } from '../lib/track'
import type { RemoteScratch } from '../lib/useCouple'
import type { Chart, Member, PaySchedule, Square } from '../lib/types'
import { Confetti } from '../components/Confetti'
import { ScratchCard } from '../components/ScratchCard'
import { BellIcon, Gear, Sparkle } from '../components/Icons'
import { denseGrid } from './Settings'

type Filter = 'all' | 'under50' | 'around100' | 'big'
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['under50', 'Under $50'],
  ['around100', 'Around $100'],
  ['big', 'Big ones'],
]

/** Filters scale with the chart so they make sense for small goals too. */
function matcher(filter: Filter, maxAmount: number) {
  const scale = maxAmount / 300
  return (a: number) => {
    if (filter === 'under50') return a < 50 * scale
    if (filter === 'around100') return a >= 75 * scale && a <= 126 * scale
    if (filter === 'big') return a >= 200 * scale
    return true
  }
}

type Toast = { msg: string; undoId?: number } | null

type Props = {
  me: Member
  members: Member[]
  chart: Chart
  squares: Square[]
  schedule: PaySchedule | null
  partnerViewing: number | null
  remote: RemoteScratch | null
  setViewing: (id: number | null) => void
  patchSquare: (id: number, patch: Partial<Square>) => void
  mutate: <T>(fn: () => Promise<T>) => Promise<T>
  onSettings: () => void
  onInvite: () => void
  onNewChart: () => void
}

export function Board(props: Props) {
  const { me, members, chart, squares, schedule, partnerViewing, remote, setViewing, patchSquare, mutate } = props
  const [filter, setFilter] = useState<Filter>('all')
  const [phase, setPhase] = useState<'grid' | 'lift' | 'card'>('grid')
  const [sel, setSel] = useState<Square | null>(null)
  const [fromRect, setFromRect] = useState<DOMRect | null>(null)
  const [burst, setBurst] = useState(0)
  const [bigBurst, setBigBurst] = useState(false)
  const [toast, setToast] = useState<Toast>(null)
  const lockedRef = useRef(false)
  const liftTimer = useRef<number | undefined>(undefined)
  const toastTimer = useRef<number | undefined>(undefined)
  const dense = useMemo(denseGrid, [])

  const partner = members.find((m) => m.user_id !== me.user_id) ?? null
  const colorOf = (uid: string | null) => {
    const i = members.findIndex((m) => m.user_id === uid)
    return i === -1 ? 1 : i % 2
  }
  const nameOf = (uid: string | null) => members.find((m) => m.user_id === uid)?.display_name ?? 'Your partner'

  const total = squares.reduce((t, s) => t + (s.scratched_at ? s.amount : 0), 0)
  const pct = Math.min(100, (total / chart.goal) * 100)
  const next = [25, 50, 75, 100].find((m) => total < (chart.goal * m) / 100)
  const remaining = squares.filter((s) => !s.scratched_at).length
  const maxAmount = chart.step * chart.square_count
  const matches = matcher(filter, maxAmount)

  const showToast = useCallback((t: Toast, ms = 5000) => {
    window.clearTimeout(toastTimer.current)
    setToast(t)
    if (t) toastTimer.current = window.setTimeout(() => setToast(null), ms)
  }, [])

  const resetCard = useCallback(() => {
    window.clearTimeout(liftTimer.current)
    lockedRef.current = false
    setPhase('grid')
    setSel(null)
    setViewing(null)
  }, [setViewing])

  // The phone's back gesture works like the back arrow (until the first scratch).
  useEffect(() => {
    const onPop = () => {
      if (phase === 'grid') return
      if (lockedRef.current) {
        history.pushState({ ssCard: 1 }, '')
        return
      }
      resetCard()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [phase, resetCard])

  const closeCard = useCallback(() => {
    if (history.state?.ssCard) history.back()
    else resetCard()
  }, [resetCard])

  function open(sq: Square, el: HTMLElement) {
    if (phase !== 'grid' || sq.scratched_at) return
    setFromRect(el.getBoundingClientRect())
    setSel(sq)
    setPhase('lift')
    setViewing(sq.id)
    track('card_open', { amount: sq.amount })
    showToast(null)
    history.pushState({ ssCard: 1 }, '')
    liftTimer.current = window.setTimeout(() => setPhase('card'), 300)
  }

  function surprise() {
    const pool = squares.filter((s) => !s.scratched_at && matches(s.amount))
    if (!pool.length) return
    track('surprise')
    const pick = pool[Math.floor(Math.random() * pool.length)]
    const el = document.querySelector<HTMLElement>(`[data-sq="${pick.id}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    window.setTimeout(() => open(pick, el), 280)
  }

  async function complete() {
    if (!sel) return
    const sq = sel
    const before = total
    patchSquare(sq.id, { scratched_at: new Date().toISOString(), scratched_by: me.user_id })
    lockedRef.current = false
    if (history.state?.ssCard) history.back()
    resetCard()
    const milestone = crossedMilestone(chart.goal, before, before + sq.amount)
    setBigBurst(Boolean(milestone))
    setBurst((b) => b + 1)
    chime(Boolean(milestone))
    const msg =
      milestone === 100 ? 'Chart complete! You did it.' : milestone ? `${milestone}% milestone reached!` : `Square scratched · ${money(sq.amount)}`
    showToast({ msg, undoId: sq.id })

    try {
      await mutate(() => api('POST', '/scratch', { id: sq.id }))
    } catch (err) {
      patchSquare(sq.id, { scratched_at: null, scratched_by: null })
      showToast({ msg: errorText(err) })
    }
  }

  async function undo(id: number) {
    const sq = squares.find((s) => s.id === id)
    showToast(null)
    setBurst(0)
    patchSquare(id, { scratched_at: null, scratched_by: null })
    try {
      await mutate(() => api('POST', '/undo', { id }))
    } catch (err) {
      if (sq) patchSquare(id, { scratched_at: sq.scratched_at, scratched_by: sq.scratched_by })
      showToast({ msg: errorText(err) })
    }
  }

  // React to my partner's scratches.
  useEffect(() => {
    if (!remote) return
    const { square } = remote
    const who = nameOf(square.scratched_by)
    if (sel && sel.id === square.id && phase !== 'grid') {
      lockedRef.current = false
      closeCard()
      showToast({ msg: `${who} just saved that one. Pick another!` })
    } else {
      showToast({ msg: `${who} saved ${money(square.amount)}` })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote?.n])

  useEffect(() => () => {
    window.clearTimeout(liftTimer.current)
    window.clearTimeout(toastTimer.current)
  }, [])

  const payday = schedule ? isPayday(schedule.kind, schedule.anchor_date, todayIn(schedule.timezone)) : false
  const viewingSquare = partnerViewing != null ? squares.find((s) => s.id === partnerViewing && !s.scratched_at) : undefined
  const ordered = useMemo(() => [...squares].sort((a, b) => a.position - b.position), [squares])

  return (
    <div className="board">
      <header className="board-head">
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <span className="eyebrow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {chart.name}
          </span>
          <h1>Stax</h1>
        </div>
        <div className="head-right">
          <div className="avatars">
            {members.map((m, i) => (
              <span key={m.user_id} className={`avatar c${i % 2}`} title={m.display_name} aria-label={m.display_name}>
                {m.display_name.slice(0, 1).toUpperCase()}
              </span>
            ))}
          </div>
          <button type="button" className="icon-btn" aria-label="Settings" onClick={props.onSettings}>
            <Gear />
          </button>
        </div>
      </header>

      <section className="tally" aria-label="Progress">
        <div className="tally-top">
          <div>
            <span className="tally-total">{money(total)}</span>
            <span className="tally-of">of {money(chart.goal)}</span>
          </div>
          <span className="tally-pct">{Math.floor(pct)}%</span>
        </div>
        <div className="bar" role="progressbar" aria-label="Saved toward goal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(pct)}>
          <div className="bar-fill" style={{ width: `${pct}%` }} />
          {[25, 50, 75].map((m) => (
            <span key={m} className="bar-tick" style={{ left: `${m}%` }} aria-hidden="true" />
          ))}
        </div>
        <span className="tally-next">
          {next
            ? `Next milestone: ${next}% at ${money((chart.goal * next) / 100)} · ${money((chart.goal * next) / 100 - total)} to go`
            : 'Every square scratched. Time to celebrate!'}
        </span>
      </section>

      {payday && remaining > 0 && (
        <div className="banner payday" role="status">
          <BellIcon /> Payday! Ready to scratch one?
        </div>
      )}
      {!partner && (
        <div className="banner invite">
          Saving is better together.
          <button type="button" className="pill" onClick={props.onInvite}>
            Invite partner
          </button>
        </div>
      )}
      {viewingSquare && partner && (
        <div className="presence" role="status">
          <span className="dot-pulse" aria-hidden="true" />
          {partner.display_name} is looking at the {money(viewingSquare.amount)} square
        </div>
      )}

      {remaining === 0 ? (
        <section className="panel done-card">
          <strong style={{ fontFamily: 'var(--display)', fontSize: 26 }}>You saved {money(chart.goal)} together!</strong>
          <span className="small">Every square is scratched. Celebrate, then start your next goal.</span>
          <button type="button" className="btn" onClick={props.onNewChart}>
            Start a new chart
          </button>
        </section>
      ) : (
        <div className="helpers">
          {FILTERS.map(([k, l]) => (
            <button key={k} type="button" className="pill" aria-pressed={filter === k} onClick={() => {
                setFilter(k)
                if (k !== 'all') track('filter', { value: l })
              }}>
              {l}
            </button>
          ))}
          <button type="button" className="pill surprise" onClick={surprise}>
            <Sparkle /> Surprise me
          </button>
        </div>
      )}

      <div className="grid-wrap">
        <div className={'grid' + (dense ? ' dense' : '') + (phase !== 'grid' ? ' lifting' : '')}>
          {ordered.map((sq) => {
            const done = Boolean(sq.scratched_at)
            const isMatch = filter !== 'all' && matches(sq.amount)
            const cls = [
              'sq',
              done && 'done',
              !done && isMatch && 'match',
              !done && filter !== 'all' && !isMatch && 'faded',
              !done && viewingSquare?.id === sq.id && 'partner',
              sel?.id === sq.id && 'lifted',
            ]
              .filter(Boolean)
              .join(' ')
            const label = done
              ? `${money(sq.amount)}, saved by ${sq.scratched_by === me.user_id ? 'you' : nameOf(sq.scratched_by)}`
              : `${money(sq.amount)}, open`
            return (
              <button key={sq.id} type="button" data-sq={sq.id} className={cls} disabled={done} aria-label={label} onClick={(e) => open(sq, e.currentTarget)}>
                {money(sq.amount)}
                {done && (
                  <span className={`badge c${colorOf(sq.scratched_by)}`} aria-hidden="true">
                    {nameOf(sq.scratched_by).slice(0, 1).toUpperCase()}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {phase === 'card' && sel && (
        <ScratchCard
          key={sel.id}
          amount={sel.amount}
          from={fromRect}
          onClose={() => {
            track('card_back', { amount: sel.amount })
            closeCard()
          }}
          onFirstScratch={() => (lockedRef.current = true)}
          onComplete={() => void complete()}
        />
      )}

      <Confetti burst={burst} big={bigBurst} />

      {toast && (
        <div className="toast" role="status">
          <span>{toast.msg}</span>
          {toast.undoId != null && (
            <button type="button" onClick={() => void undo(toast.undoId!)}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  )
}
