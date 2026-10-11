import type { PayKind } from './types'

// Dates are 'YYYY-MM-DD' strings. Used by both the app and the reminder
// function (netlify/lib/app.ts), so the rules always match.

const toDate = (s: string) => new Date(s + 'T00:00:00Z')
const iso = (d: Date) => d.toISOString().slice(0, 10)
const mod = (a: number, b: number) => ((a % b) + b) % b
const daysBetween = (a: string, b: string) => Math.round((toDate(a).getTime() - toDate(b).getTime()) / 86400000)

/** Paydays that land on a weekend move to the Friday before. */
function weekendBack(d: Date) {
  const w = d.getUTCDay()
  if (w === 6) d.setUTCDate(d.getUTCDate() - 1)
  if (w === 0) d.setUTCDate(d.getUTCDate() - 2)
  return d
}

function monthDays(today: string, days: number[]) {
  const t = toDate(today)
  const out: string[] = []
  for (const offset of [0, 1]) {
    const y = t.getUTCFullYear()
    const m = t.getUTCMonth() + offset
    const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    for (const d of days) out.push(iso(weekendBack(new Date(Date.UTC(y, m, Math.min(d, dim))))))
  }
  return out
}

export function isPayday(kind: PayKind, anchor: string | null, today: string): boolean {
  switch (kind) {
    case 'weekly':
      return !!anchor && mod(daysBetween(today, anchor), 7) === 0
    case 'biweekly':
      return !!anchor && mod(daysBetween(today, anchor), 14) === 0
    case 'semimonthly':
      return monthDays(today, [1, 15]).includes(today)
    case 'monthly':
      return !!anchor && monthDays(today, [toDate(anchor).getUTCDate()]).includes(today)
  }
}

export function nextPayday(kind: PayKind, anchor: string | null, from: string): string | null {
  const d = toDate(from)
  for (let i = 0; i < 70; i++) {
    const s = iso(d)
    if (isPayday(kind, anchor, s)) return s
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return null
}

export function todayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  } catch {
    return iso(new Date())
  }
}

/** The date and hour (0–23) right now in a time zone. */
export function localDateHour(timeZone: string, now = new Date()): { date: string; hour: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now)
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
    return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) }
  } catch {
    return { date: iso(now), hour: now.getUTCHours() }
  }
}

export const localTimeZone =() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago'

export const prettyDate = (s: string) =>
  toDate(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

export const hourLabel = (h: number) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}`
