import { useEffect, useRef, useState } from 'react'
import { api, errorText } from '../lib/api'
import { MAX_GOAL, money, priceSquares } from '../lib/chart'
import type { AppState, Chart, Square } from '../lib/types'

type Props = {
  chart: Chart
  squares: Square[]
  /** Scroll here and focus the goal field when the screen opens. */
  focus?: boolean
  onUpdated: (state: AppState) => void
}

/** Change the chart's name and goal. Scratched squares keep their amounts; open ones are repriced. */
export function GoalEditor({ chart, squares, focus, onUpdated }: Props) {
  const [name, setName] = useState(chart.name)
  const [goalStr, setGoalStr] = useState(String(chart.goal))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!focus) return
    sectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    inputRef.current?.focus({ preventScroll: true })
  }, [focus])

  const goal = Math.floor(Number(goalStr) || 0)
  const open = squares.filter((s) => !s.scratched_at)
  const saved = squares.reduce((t, s) => t + (s.scratched_at ? s.amount : 0), 0)
  const minGoal = Math.max(100, saved + open.length)
  const valid = goal >= minGoal && goal <= MAX_GOAL
  const changed = goal !== chart.goal || (name.trim() !== '' && name.trim() !== chart.name)
  const prices = valid && open.length ? priceSquares(goal - saved, open.length) : []

  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      const state = await api<AppState>('POST', '/chart/edit', { goal, name: name.trim() })
      onUpdated(state)
      setMsg({ text: 'Goal updated. Your partner will see it too.', ok: true })
    } catch (e) {
      setMsg({ text: errorText(e), ok: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section ref={sectionRef} id="goal" className="panel" aria-label="Your goal" style={{ scrollMarginTop: 16 }}>
      <strong style={{ fontFamily: 'var(--display)', fontSize: 20 }}>Your goal</strong>

      <div className="stack-8">
        <label className="label" htmlFor="edit-name">
          What you&rsquo;re saving for
        </label>
        <input id="edit-name" className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="stack-8">
        <label className="label" htmlFor="edit-goal">
          Savings goal
        </label>
        <div className="money-input">
          <span aria-hidden="true">$</span>
          <input
            ref={inputRef}
            id="edit-goal"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={goalStr ? Number(goalStr).toLocaleString('en-US') : ''}
            onChange={(e) => setGoalStr(e.target.value.replace(/[^\d]/g, '').slice(0, 8))}
          />
        </div>
        {goalStr !== '' && goal < minGoal && saved > 0 && (
          <span className="error">
            You&rsquo;ve already saved {money(saved)}, so the goal needs to be at least {money(minGoal)}.
          </span>
        )}
        {goalStr !== '' && goal < minGoal && saved === 0 && <span className="error">Pick a goal of at least {money(minGoal)}.</span>}
        {goal > MAX_GOAL && <span className="error">Pick a goal up to {money(MAX_GOAL)}.</span>}
        {valid && goal !== chart.goal && open.length > 0 && (
          <span className="small">
            {saved > 0 ? `The ${money(saved)} you've already saved stays as is. ` : ''}
            The {open.length} open squares will become {money(prices[0])} to {money(prices[prices.length - 1])}, adding up to {money(goal)}.
          </span>
        )}
      </div>

      {msg && (
        <p className={msg.ok ? 'small' : 'error'} role="status" style={{ margin: 0, color: msg.ok ? 'var(--green)' : undefined }}>
          {msg.text}
        </p>
      )}

      <button type="button" className="btn small" disabled={!valid || !changed || busy || open.length === 0} onClick={() => void save()}>
        {busy ? 'Updating…' : 'Update goal'}
      </button>
    </section>
  )
}
