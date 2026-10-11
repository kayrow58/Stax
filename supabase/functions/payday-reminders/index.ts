// Scratch & Save — payday reminders.
// Runs every hour (see README, step 7). For anyone whose payday is today and
// whose reminder hour has arrived in their own time zone, it sends a push
// notification to each of their devices, plus an optional email backup.
//
// Secrets to set in Supabase → Edge Functions → Secrets:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com)
//   CRON_SECRET     — any long random string; the hourly job sends it
//   APP_URL         — your site, e.g. https://scratch-and-save.vercel.app
//   RESEND_API_KEY, EMAIL_FROM — optional, for the email backup
//
// In the function's settings, turn OFF "Enforce JWT verification" (the
// CRON_SECRET check below protects it instead).

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

type PayKind = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'
type Schedule = {
  user_id: string
  kind: PayKind
  anchor_date: string | null
  remind_hour: number
  timezone: string
  email_backup: boolean
  last_notified_on: string | null
}

// ---------- Payday rules (same as src/lib/payday.ts) ----------
const toDate = (s: string) => new Date(s + 'T00:00:00Z')
const iso = (d: Date) => d.toISOString().slice(0, 10)
const mod = (a: number, b: number) => ((a % b) + b) % b
const daysBetween = (a: string, b: string) => Math.round((toDate(a).getTime() - toDate(b).getTime()) / 86400000)
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
function isPayday(kind: PayKind, anchor: string | null, today: string): boolean {
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
function localNow(timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date())
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
    return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) }
  } catch {
    const d = new Date()
    return { date: iso(d), hour: d.getUTCHours() }
  }
}

// ---------- Setup ----------
function serviceKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (keys) {
    try {
      const parsed = JSON.parse(keys)
      const first = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]
      if (typeof first === 'string') return first
    } catch {
      return keys
    }
  }
  const own = Deno.env.get('APP_SECRET_KEY')
  if (own) return own
  throw new Error('No Supabase secret key available to the function.')
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) return json({ error: 'unauthorized' }, 401)

  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!vapidPublic || !vapidPrivate) return json({ error: 'VAPID keys are not set' }, 500)
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:hello@example.com', vapidPublic, vapidPrivate)

  const appUrl = (Deno.env.get('APP_URL') || '').replace(/\/$/, '')
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const emailFrom = Deno.env.get('EMAIL_FROM')
  const force = new URL(req.url).searchParams.get('test_user') // send now to one user, for testing

  const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), { auth: { persistSession: false } })
  const { data: schedules, error } = await db.from('pay_schedules').select('*')
  if (error) return json({ error: error.message }, 500)

  const results: Record<string, string> = {}
  for (const s of (schedules ?? []) as Schedule[]) {
    const now = localNow(s.timezone)
    const due =
      force === s.user_id ||
      (!force && isPayday(s.kind, s.anchor_date, now.date) && now.hour >= s.remind_hour && s.last_notified_on !== now.date)
    if (!due) continue

    const title = 'Payday! Ready to scratch one?'
    const body = 'Pick any square on your chart.'
    let sent = 0

    const { data: subs } = await db.from('push_subscriptions').select('*').eq('user_id', s.user_id)
    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title, body, url: appUrl ? appUrl + '/' : '/' }),
          { TTL: 60 * 60 * 12 },
        )
        sent++
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('id', sub.id) // phone unsubscribed
        else console.error('push failed', code, e)
      }
    }

    if (s.email_backup && resendKey && emailFrom) {
      const { data: u } = await db.auth.admin.getUserById(s.user_id)
      const to = u?.user?.email
      if (to) {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            from: emailFrom,
            to,
            subject: title,
            html: `<p style="font-size:16px">It's payday. Pick any square on your chart and scratch it off.</p>${
              appUrl ? `<p><a href="${appUrl}/" style="font-size:16px;font-weight:bold">Open Scratch &amp; Save</a></p>` : ''
            }`,
          }),
        })
        if (r.ok) sent++
        else console.error('email failed', r.status, await r.text())
      }
    }

    if (!force) await db.from('pay_schedules').update({ last_notified_on: now.date }).eq('user_id', s.user_id)
    results[s.user_id] = `sent ${sent}`
  }

  return json({ ok: true, notified: results })
})
