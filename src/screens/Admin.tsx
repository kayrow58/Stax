import { useCallback, useEffect, useState } from 'react'
import { api, errorText } from '../lib/api'
import { money } from '../lib/chart'
import type { AdminOverview } from '../lib/types'
import { BackIcon } from '../components/Icons'

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  const d = Math.floor(s / 86400)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

const shortDate = (d: string) =>
  new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–')

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  )
}

type DayKey = 'active_people' | 'scratches'

/** One-series bar chart with a tap/hover readout and a table view. */
function DailyChart({ days, field, title, unit }: { days: AdminOverview['daily']; field: DayKey; title: string; unit: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const max = Math.max(1, ...days.map((d) => d[field]))
  const shown = hover != null ? days[hover] : days[days.length - 1]
  const total = days.reduce((t, d) => t + d[field], 0)

  return (
    <section className="panel admin-panel" aria-label={title}>
      <div className="panel-head">
        <h2>{title}</h2>
        <button type="button" className="link-btn" style={{ minHeight: 32 }} onClick={() => setTable(!table)}>
          {table ? 'Chart' : 'Table'}
        </button>
      </div>
      {table ? (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Active people</th>
                <th scope="col">Opens</th>
                <th scope="col">Squares scratched</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.date}>
                  <td>{shortDate(d.date)}</td>
                  <td>{d.active_people}</td>
                  <td>{d.opens}</td>
                  <td>{d.scratches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <p className="readout" aria-live="polite">
            <strong>{shown[field]}</strong> {unit} on {shortDate(shown.date)}
            <span className="small"> · {total} over 30 days</span>
          </p>
          <div className="bars" onMouseLeave={() => setHover(null)}>
            {days.map((d, i) => (
              <button
                key={d.date}
                type="button"
                className={'bar-hit' + (hover === i ? ' on' : '')}
                aria-label={`${shortDate(d.date)}: ${d[field]} ${unit}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onClick={() => setHover(i)}
              >
                <span className="bar-mark" style={{ height: `${d[field] ? Math.max(4, (d[field] / max) * 100) : 0}%` }} />
              </button>
            ))}
          </div>
          <div className="bar-axis" aria-hidden="true">
            <span>{shortDate(days[0].date)}</span>
            <span>Today</span>
          </div>
        </>
      )}
    </section>
  )
}

export function Admin({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<AdminOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      setData(await api<AdminOverview>('GET', '/admin/overview'))
      setError(null)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const maxFeature = Math.max(1, ...(data?.features.map((f) => f.count) ?? [1]))

  return (
    <main className="screen admin">
      <div className="admin-top">
        <button type="button" className="icon-btn" aria-label="Back to settings" onClick={onBack}>
          <BackIcon />
        </button>
        <button type="button" className="btn small outline" style={{ width: 'auto' }} disabled={busy} onClick={() => void load()}>
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <div className="stack">
        <span className="eyebrow">Only you can see this</span>
        <h1 className="title">Admin dashboard</h1>
        {data && (
          <p className="small" style={{ margin: 0 }}>
            Updated {new Date(data.generated_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · days
            counted in {data.timezone.replace('_', ' ')}
          </p>
        )}
      </div>

      {error && <div className="notice" role="alert">{error}</div>}
      {!data && !error && (
        <div className="loading" style={{ minHeight: 200 }}>
          <div className="spinner" />
        </div>
      )}

      {data && (
        <>
          <section className="kpis" aria-label="Key numbers">
            <Kpi label="People" value={data.totals.people} sub={`${data.active.today} active today`} />
            <Kpi label="Active this week" value={data.active.last_7_days} sub={`${pct(data.active.last_7_days, data.totals.people)} of everyone`} />
            <Kpi label="Active this month" value={data.active.last_30_days} sub={`${pct(data.active.last_30_days, data.totals.people)} of everyone`} />
            <Kpi label="Couples paired" value={data.totals.paired_couples} sub={`of ${data.totals.couples} charts started`} />
            <Kpi label="Squares scratched" value={data.totals.squares_scratched} sub={`${data.totals.completed_charts} charts finished`} />
            <Kpi label="Saved (tracked)" value={money(data.totals.dollars_saved)} sub="on current charts" />
            <Kpi label="Notifications on" value={data.totals.notifications_on} sub={`${pct(data.totals.notifications_on, data.totals.people)} of people`} />
            <Kpi
              label="Reminder → scratch"
              value={pct(data.reminders.followed_by_scratch, data.reminders.sent)}
              sub={`${data.reminders.followed_by_scratch} of ${data.reminders.sent} reminders, within 24h`}
            />
          </section>

          <DailyChart days={data.daily} field="active_people" title="Active people per day" unit="active" />
          <DailyChart days={data.daily} field="scratches" title="Squares scratched per day" unit="scratched" />

          <section className="panel admin-panel" aria-label="Feature usage">
            <div className="panel-head">
              <h2>What people use</h2>
              <span className="small">last 30 days</span>
            </div>
            {data.features.length === 0 && <p className="small">Nothing yet.</p>}
            <ul className="feature-list">
              {data.features.map((f) => (
                <li key={f.event}>
                  <div className="feature-line">
                    <span>{f.label}</span>
                    <span className="small">
                      <strong className="num">{f.count}</strong> · {f.people} {f.people === 1 ? 'person' : 'people'}
                    </span>
                  </div>
                  <span className="feature-track" aria-hidden="true">
                    <span style={{ width: `${(f.count / maxFeature) * 100}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel admin-panel" aria-label="People">
            <div className="panel-head">
              <h2>People</h2>
              <span className="small">{data.people.length} total</span>
            </div>
            <ul className="row-list">
              {data.people.map((p) => (
                <li key={p.user_id}>
                  <div className="row-main">
                    <strong>{p.name ?? 'No name yet'}</strong>
                    <span className="small">{p.email}</span>
                  </div>
                  <div className="row-facts small">
                    <span>Last seen {ago(p.last_seen)}</span>
                    <span>{p.days_active_30} of 30 days active</span>
                    <span>{p.opens_30} {p.opens_30 === 1 ? 'open' : 'opens'}</span>
                    <span>{p.scratches_total} {p.scratches_total === 1 ? 'scratch' : 'scratches'}</span>
                    {p.partner ? <span>With {p.partner}</span> : <span className="tag warn">No partner yet</span>}
                    <span className={'tag' + (p.notifications ? ' good' : '')}>{p.notifications ? 'Notifications on' : 'Notifications off'}</span>
                    {p.platform && <span className="tag">{p.platform}{p.installed ? ' · installed' : ' · browser'}</span>}
                    {p.reminders_sent > 0 && (
                      <span>
                        Reminders: {p.reminders_converted} of {p.reminders_sent} led to a scratch
                      </span>
                    )}
                    <span>Joined {ago(p.first_seen)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel admin-panel" aria-label="Couples">
            <div className="panel-head">
              <h2>Couples</h2>
              <span className="small">{data.couples.length} total</span>
            </div>
            <ul className="row-list">
              {data.couples.map((c) => (
                <li key={c.id}>
                  <div className="row-main">
                    <strong>{c.names.join(' & ')}</strong>
                    <span className="small">{c.chart_name ?? 'No chart yet'}</span>
                  </div>
                  {c.square_count > 0 && (
                    <>
                      <span className="feature-track" aria-hidden="true">
                        <span style={{ width: `${(c.saved / Math.max(1, c.goal)) * 100}%` }} />
                      </span>
                      <div className="row-facts small">
                        <span>
                          {money(c.saved)} of {money(c.goal)} ({pct(c.saved, c.goal)})
                        </span>
                        <span>
                          {c.squares_done} of {c.square_count} squares
                        </span>
                        <span>Last scratch {ago(c.last_scratch)}</span>
                        {c.completed && <span className="tag good">Finished</span>}
                        {c.partners < 2 ? (
                          <span className="tag warn">Waiting for partner</span>
                        ) : (
                          <span className={'tag' + (c.both_active_7d ? ' good' : ' warn')}>
                            {c.both_active_7d ? 'Both active this week' : 'Not both active this week'}
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="panel admin-panel" aria-label="Recent activity">
            <div className="panel-head">
              <h2>Recent activity</h2>
            </div>
            {data.recent.length === 0 && <p className="small">Nothing yet.</p>}
            <ul className="activity">
              {data.recent.map((a, i) => (
                <li key={i}>
                  <span>
                    <strong>{a.who}</strong> {a.what.charAt(0).toLowerCase() + a.what.slice(1)}
                    {a.detail ? ` · ${a.detail}` : ''}
                  </span>
                  <span className="small">{ago(a.at)}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  )
}
