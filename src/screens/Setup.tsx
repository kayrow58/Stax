import { useState } from 'react'
import { money, PAYDAYS_PER_YEAR, planChart } from '../lib/chart'
import { errorText, supabase } from '../lib/supabase'
import type { PayKind } from '../lib/types'

const MONTHS = [6, 12, 18, 24]
const FREQS: [PayKind, string][] = [
  ['weekly', 'Weekly'],
  ['biweekly', 'Every 2 weeks'],
  ['semimonthly', '1st and 15th'],
  ['monthly', 'Monthly'],
]

type Props = {
  /** True when this replaces an existing chart. */
  replacing: boolean
  defaultFreq: PayKind | null
  onCreated: (freq: PayKind) => void
  onCancel?: () => void
}

/** The chart generator: goal + timeframe → squares that add up exactly. */
export function Setup({ replacing, defaultFreq, onCreated, onCancel }: Props) {
  const [name, setName] = useState('')
  const [goalStr, setGoalStr] = useState('15150')
  const [months, setMonths] = useState(12)
  const [freq, setFreq] = useState<PayKind>(defaultFreq ?? 'biweekly')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const goal = Math.floor(Number(goalStr) || 0)
  const valid = goal >= 55 && goal <= 10_000_000
  const plan = planChart(goal)
  const paydays = Math.max(1, Math.round((PAYDAYS_PER_YEAR[freq] * months) / 12))
  const perPayday = plan.n / paydays
  const perLabel = perPayday < 1.05 ? 'about 1 square' : `about ${Math.round(perPayday * 10) / 10} squares`

  async function create() {
    if (!valid) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('create_chart', { p_name: name.trim(), p_goal: goal, p_months: months })
    setBusy(false)
    if (error) return setError(errorText(error))
    onCreated(freq)
  }

  return (
    <main className="screen">
      <div className="stack">
        <span className="eyebrow">{replacing ? 'New chart' : 'Step 1 of 3'}</span>
        <h1 className="title">Build your chart</h1>
        <p className="lede">Pick a goal and a timeframe. We&rsquo;ll size the squares so the chart adds up exactly.</p>
      </div>

      {replacing && (
        <div className="notice">Your current chart will be archived and you&rsquo;ll both start fresh on the new one.</div>
      )}

      <div className="stack-8">
        <label className="label" htmlFor="chart-name">
          What are you saving for? <span className="small">(optional)</span>
        </label>
        <input id="chart-name" className="input" maxLength={60} placeholder="Our savings chart" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="stack-8">
        <label className="label" htmlFor="goal">
          Savings goal
        </label>
        <div className="money-input">
          <span aria-hidden="true">$</span>
          <input
            id="goal"
            type="text"
            inputMode="numeric"
            value={goalStr}
            onChange={(e) => setGoalStr(e.target.value.replace(/[^\d]/g, '').slice(0, 8))}
          />
        </div>
        {!valid && <span className="error">Pick a goal between $55 and $10,000,000.</span>}
      </div>

      <div className="stack-8">
        <span className="label" id="tf">
          Timeframe
        </span>
        <div className="chips cols-4" role="group" aria-labelledby="tf">
          {MONTHS.map((m) => (
            <button key={m} type="button" className="chip" aria-pressed={months === m} onClick={() => setMonths(m)}>
              {m} mo
            </button>
          ))}
        </div>
      </div>

      <div className="stack-8">
        <span className="label" id="pf">
          How often do you get paid?
        </span>
        <div className="chips cols-2" role="group" aria-labelledby="pf">
          {FREQS.map(([k, l]) => (
            <button key={k} type="button" className="chip" aria-pressed={freq === k} onClick={() => setFreq(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {valid && (
        <section className="panel" aria-label="Your chart">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <strong style={{ fontFamily: 'var(--display)', fontSize: 22 }}>{plan.n} squares</strong>
            <span className="small" style={{ fontWeight: 500 }}>
              {money(plan.step)} to {money(plan.step * plan.n)}
            </span>
          </div>
          <div className="mini-grid" aria-hidden="true">
            {Array.from({ length: plan.n }, (_, i) => (
              <span key={i} style={{ background: `rgba(46,106,76,${(0.12 + (0.78 * (i + 1)) / plan.n).toFixed(2)})` }} />
            ))}
          </div>
          <div className="stack" style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.45 }}>
            <span>
              Total saved when it&rsquo;s done: <strong>{money(plan.total)}</strong>
            </span>
            <span>
              {paydays} paydays in {months} months, so {perLabel} (about {money(plan.total / paydays)}) each payday.
            </span>
            {plan.rounded && <span style={{ color: 'var(--amber-ink)' }}>Rounded so every square is a whole dollar.</span>}
          </div>
        </section>
      )}

      {error && <p className="error" role="alert">{error}</p>}

      <div className="stack-8 push-down">
        <button type="button" className="btn" disabled={!valid || busy} onClick={() => void create()}>
          {busy ? 'Creating…' : replacing ? 'Start the new chart' : 'Create our chart'}
        </button>
        <button type="button" className="link-btn" onClick={() => { setGoalStr('15150'); setMonths(12) }}>
          Use the classic $3 to $300 chart
        </button>
        {onCancel && (
          <button type="button" className="link-btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </main>
  )
}
