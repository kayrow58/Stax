import type { KV } from './kv'
import type { AuthUser } from './auth'
import { localDateHour } from '../../src/lib/payday'
import type { AdminOverview, Chart, Member, Square } from '../../src/lib/types'

// ---------- What gets recorded ----------
// people/{id}      → one person: first/last seen, total counts per feature, active days, device
// daily/{date}     → per day: who did what, how many times
// activity/recent  → the last 300 things anyone did (newest first)

export const EVENT_LABELS: Record<string, string> = {
  open: 'Opened the app',
  reminder_open: 'Opened from a payday reminder',
  couple_create: 'Started a chart group',
  couple_join: 'Joined a partner',
  chart_create: 'Created a chart',
  goal_edit: 'Changed the goal',
  card_open: 'Opened a scratch card',
  card_back: 'Backed out of a card',
  scratch: 'Scratched a square',
  undo: 'Used Undo',
  filter: 'Used a filter chip',
  surprise: 'Used Surprise me',
  invite_share: 'Shared the invite link',
  invite_copy: 'Copied the invite code',
  settings_open: 'Opened Settings',
  schedule_save: 'Saved pay schedule',
  push_on: 'Turned on notifications',
  push_off: 'Turned off notifications',
  push_test: 'Sent a test notification',
  grid_toggle: 'Switched grid layout',
  sound_toggle: 'Switched sounds',
  reminder_sent: 'Was sent a payday reminder',
  reminder_converted: 'Scratched within 24h of a reminder',
  passkey_on: 'Turned on Face ID sign-in',
  passkey_off: 'Turned off Face ID sign-in',
  passkey_login: 'Signed in with Face ID',
  passkey_declined: 'Said “Not now” to Face ID',
}

/** Events the app itself may report (everything else is recorded by the server). */
export const CLIENT_EVENTS = new Set([
  'open',
  'reminder_open',
  'card_open',
  'card_back',
  'filter',
  'surprise',
  'invite_share',
  'invite_copy',
  'settings_open',
  'grid_toggle',
  'sound_toggle',
  'passkey_declined',
])

type Detail = Record<string, string | number | boolean>

type PersonDoc = {
  id: string
  email: string
  first_seen: string
  last_seen: string
  counts: Record<string, number>
  days: Record<string, number>
  platform?: string
  installed?: boolean
  push_devices?: number
  last_reminder_at?: string | null
  reminder_credited?: boolean
}
type DailyDoc = { users: Record<string, Record<string, number>> }
type Activity = { at: string; user_id: string; name: string; detail?: Detail }
type CoupleDoc = { id: string; members: Member[]; chart: (Chart & { squares: Square[] }) | null }

const K = {
  person: (id: string) => `people/${id}`,
  daily: (date: string) => `daily/${date}`,
  recent: 'activity/recent',
}

export const adminTimeZone = () => process.env.ADMIN_TIMEZONE || 'America/Chicago'

export function isAdmin(user: AuthUser): boolean {
  const list = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return !!user.email && list.includes(user.email.toLowerCase())
}

/** Create-or-update with retries if two requests race. */
async function upsert<T>(kv: KV, key: string, init: () => T, fn: (cur: T) => T) {
  for (let i = 0; i < 8; i++) {
    const cur = await kv.get<T>(key)
    if (!cur) {
      if (await kv.set(key, fn(init()), { onlyIfNew: true })) return
    } else if (await kv.set(key, fn(structuredClone(cur.data)), { onlyIfMatch: cur.etag })) return
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 100))
  }
}

export function cleanDetail(raw: unknown): Detail | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Detail = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 6)) {
    if (!/^[a-z_]{1,20}$/.test(k)) continue
    if (typeof v === 'string') out[k] = v.slice(0, 40)
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (typeof v === 'boolean') out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

/** Record one thing someone did. Never throws: analytics must not break the app. */
export async function track(kv: KV, user: AuthUser, name: string, detail?: Detail, now = new Date()) {
  try {
    const iso = now.toISOString()
    const date = localDateHour(adminTimeZone(), now).date
    const names = [name]

    await upsert<PersonDoc>(
      kv,
      K.person(user.id),
      () => ({ id: user.id, email: user.email, first_seen: iso, last_seen: iso, counts: {}, days: {} }),
      (p) => {
        p.email = user.email || p.email
        p.last_seen = iso
        p.days[date] = (p.days[date] ?? 0) + 1
        // Keep 90 days of activity history per person.
        const cutoff = localDateHour(adminTimeZone(), new Date(now.getTime() - 90 * 86400000)).date
        for (const d of Object.keys(p.days)) if (d < cutoff) delete p.days[d]
        if (name === 'open' && detail) {
          if (typeof detail.platform === 'string') p.platform = detail.platform
          if (typeof detail.installed === 'boolean') p.installed = detail.installed
        }
        if ((name === 'push_on' || name === 'push_off') && typeof detail?.devices === 'number') p.push_devices = detail.devices
        if (name === 'reminder_sent') {
          p.last_reminder_at = iso
          p.reminder_credited = false
        }
        if (
          name === 'scratch' &&
          p.last_reminder_at &&
          !p.reminder_credited &&
          now.getTime() - Date.parse(p.last_reminder_at) < 24 * 3600 * 1000
        ) {
          p.reminder_credited = true
          names.push('reminder_converted')
        }
        for (const n of names) p.counts[n] = (p.counts[n] ?? 0) + 1
        return p
      },
    )

    await upsert<DailyDoc>(
      kv,
      K.daily(date),
      () => ({ users: {} }),
      (d) => {
        const u = (d.users[user.id] ??= {})
        for (const n of names) u[n] = (u[n] ?? 0) + 1
        return d
      },
    )

    if (name !== 'open' || detail?.source === 'reminder') {
      await upsert<Activity[]>(
        kv,
        K.recent,
        () => [],
        (list) => [{ at: iso, user_id: user.id, name, ...(detail ? { detail } : {}) }, ...list].slice(0, 300),
      )
    }
  } catch (e) {
    console.error('analytics failed', e)
  }
}

// ---------- The dashboard ----------

export async function overview(kv: KV, now = new Date()): Promise<AdminOverview> {
  const tz = adminTimeZone()
  const dayStr = (daysAgo: number) => localDateHour(tz, new Date(now.getTime() - daysAgo * 86400000)).date
  const today = dayStr(0)
  const last30 = Array.from({ length: 30 }, (_, i) => dayStr(29 - i))
  const since7 = dayStr(6)
  const since30 = last30[0]

  const [personKeys, coupleKeys, dailyDocs, recent] = await Promise.all([
    kv.list('people/'),
    kv.list('couple/'),
    Promise.all(last30.map((d) => kv.get<DailyDoc>(K.daily(d)))),
    kv.get<Activity[]>(K.recent),
  ])
  const people = (await Promise.all(personKeys.map((k) => kv.get<PersonDoc>(k)))).flatMap((r) => (r ? [r.data] : []))
  const couples = (await Promise.all(coupleKeys.map((k) => kv.get<CoupleDoc>(k)))).flatMap((r) => (r ? [r.data] : []))

  // Names and partners come from the couples.
  const nameOf = new Map<string, string>()
  const partnerOf = new Map<string, string>()
  const coupleOf = new Map<string, CoupleDoc>()
  for (const c of couples) {
    for (const m of c.members) {
      nameOf.set(m.user_id, m.display_name)
      coupleOf.set(m.user_id, c)
      const other = c.members.find((x) => x.user_id !== m.user_id)
      if (other) partnerOf.set(m.user_id, other.display_name)
    }
  }

  // Per-day and per-feature numbers for the last 30 days.
  const daily = last30.map((date, i) => {
    const users = dailyDocs[i]?.data.users ?? {}
    const ids = Object.keys(users)
    const sum = (ev: string) => ids.reduce((t, id) => t + (users[id][ev] ?? 0), 0)
    return { date, active_people: ids.length, opens: sum('open'), scratches: sum('scratch') }
  })
  const featureCount: Record<string, number> = {}
  const featureUsers: Record<string, Set<string>> = {}
  const opens30: Record<string, number> = {}
  for (const doc of dailyDocs) {
    for (const [uid, evs] of Object.entries(doc?.data.users ?? {})) {
      for (const [ev, n] of Object.entries(evs)) {
        featureCount[ev] = (featureCount[ev] ?? 0) + n
        ;(featureUsers[ev] ??= new Set()).add(uid)
        if (ev === 'open') opens30[uid] = (opens30[uid] ?? 0) + n
      }
    }
  }
  const features = Object.keys(EVENT_LABELS)
    .filter((ev) => featureCount[ev])
    .map((ev) => ({ event: ev, label: EVENT_LABELS[ev], count: featureCount[ev], people: featureUsers[ev].size }))
    .sort((a, b) => b.count - a.count)

  const activeSince = (p: PersonDoc, since: string) => Object.keys(p.days).some((d) => d >= since)

  const peopleRows = people
    .map((p) => {
      const c = coupleOf.get(p.id)
      const mine = c?.chart?.squares.filter((s) => s.scratched_by === p.id) ?? []
      return {
        user_id: p.id,
        email: p.email,
        name: nameOf.get(p.id) ?? null,
        partner: partnerOf.get(p.id) ?? null,
        first_seen: p.first_seen,
        last_seen: p.last_seen,
        days_active_30: Object.keys(p.days).filter((d) => d >= since30).length,
        opens_30: opens30[p.id] ?? 0,
        scratches_total: p.counts.scratch ?? 0,
        saved_on_current_chart: mine.reduce((t, s) => t + s.amount, 0),
        notifications: (p.push_devices ?? 0) > 0,
        installed: p.installed ?? null,
        platform: p.platform ?? null,
        reminders_sent: p.counts.reminder_sent ?? 0,
        reminders_converted: p.counts.reminder_converted ?? 0,
      }
    })
    .sort((a, b) => b.last_seen.localeCompare(a.last_seen))

  const personById = new Map(people.map((p) => [p.id, p]))
  const coupleRows = couples
    .map((c) => {
      const squares = c.chart?.squares ?? []
      const done = squares.filter((s) => s.scratched_at)
      const saved = done.reduce((t, s) => t + s.amount, 0)
      const lastScratch = done.reduce<string | null>((m, s) => (!m || s.scratched_at! > m ? s.scratched_at : m), null)
      return {
        id: c.id,
        names: c.members.map((m) => m.display_name),
        partners: c.members.length,
        chart_name: c.chart?.name ?? null,
        goal: c.chart?.goal ?? 0,
        saved,
        squares_done: done.length,
        square_count: squares.length,
        completed: !!c.chart?.completed_at,
        last_scratch: lastScratch,
        both_active_7d:
          c.members.length === 2 && c.members.every((m) => {
            const p = personById.get(m.user_id)
            return p ? activeSince(p, since7) : false
          }),
      }
    })
    .sort((a, b) => (b.last_scratch ?? '').localeCompare(a.last_scratch ?? ''))

  const remindersSent = people.reduce((t, p) => t + (p.counts.reminder_sent ?? 0), 0)
  const remindersConverted = people.reduce((t, p) => t + (p.counts.reminder_converted ?? 0), 0)

  return {
    generated_at: now.toISOString(),
    timezone: tz,
    totals: {
      people: people.length,
      couples: couples.length,
      paired_couples: couples.filter((c) => c.members.length === 2).length,
      active_charts: couples.filter((c) => c.chart && !c.chart.completed_at).length,
      completed_charts: couples.filter((c) => c.chart?.completed_at).length,
      squares_scratched: coupleRows.reduce((t, c) => t + c.squares_done, 0),
      dollars_saved: coupleRows.reduce((t, c) => t + c.saved, 0),
      notifications_on: people.filter((p) => (p.push_devices ?? 0) > 0).length,
    },
    active: {
      today: people.filter((p) => p.days[today]).length,
      last_7_days: people.filter((p) => activeSince(p, since7)).length,
      last_30_days: people.filter((p) => activeSince(p, since30)).length,
    },
    reminders: { sent: remindersSent, followed_by_scratch: remindersConverted },
    daily,
    features,
    people: peopleRows,
    couples: coupleRows,
    recent: (recent?.data ?? []).slice(0, 60).map((a) => ({
      at: a.at,
      who: nameOf.get(a.user_id) ?? personById.get(a.user_id)?.email ?? 'Someone',
      what: EVENT_LABELS[a.name] ?? a.name,
      detail: a.detail ? describe(a.name, a.detail) : null,
    })),
  }
}

function describe(name: string, d: Detail): string | null {
  if (name === 'scratch' || name === 'undo') return typeof d.amount === 'number' ? `$${d.amount}` : null
  if (name === 'filter') return typeof d.value === 'string' ? d.value : null
  if (name === 'chart_create' || name === 'goal_edit') return typeof d.goal === 'number' ? `$${d.goal.toLocaleString('en-US')} goal` : null
  if (name === 'schedule_save') {
    const kinds: Record<string, string> = { weekly: 'weekly', biweekly: 'every 2 weeks', semimonthly: '1st and 15th', monthly: 'monthly' }
    return typeof d.kind === 'string' ? (kinds[d.kind] ?? d.kind) : null
  }
  return null
}
