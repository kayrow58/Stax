import webpush from 'web-push'
import type { KV } from './kv'
import type { AuthUser } from './auth'
import { planChart } from '../../src/lib/chart'
import { isPayday, localDateHour } from '../../src/lib/payday'
import type { AppState, Chart, Couple, Member, PayKind, PaySchedule, Square } from '../../src/lib/types'

// ---------- Stored documents ----------
// user/{id}              → which couple you're in
// couple/{id}            → members + the active chart and its squares (one document, updated atomically)
// invite/{CODE}          → couple id
// presence/{couple}/{id} → which square someone has open right now
// schedule/{id}          → pay schedule
// push/{id}              → that person's phones for notifications
// archive/{couple}/{id}  → old charts
// system/vapid           → notification keys, created automatically

type UserDoc = { couple_id: string | null }
type ChartDoc = Chart & { squares: Square[] }
type CoupleDoc = Couple & { created_at: string; members: Member[]; chart: ChartDoc | null }
type Presence = { viewing: number | null; at: number }
type PushSub = { endpoint: string; keys: { p256dh: string; auth: string }; created_at: string }
type VapidKeys = { publicKey: string; privateKey: string }

const K = {
  user: (id: string) => `user/${id}`,
  couple: (id: string) => `couple/${id}`,
  invite: (code: string) => `invite/${code}`,
  presence: (c: string, u: string) => `presence/${c}/${u}`,
  schedule: (id: string) => `schedule/${id}`,
  push: (id: string) => `push/${id}`,
  archive: (c: string, chart: string) => `archive/${c}/${chart}`,
  vapid: 'system/vapid',
}

const KINDS: PayKind[] = ['weekly', 'biweekly', 'semimonthly', 'monthly']
const UNDO_WINDOW_MS = 10 * 60_000
const PRESENCE_FRESH_MS = 20_000
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Read-modify-write that retries if someone else changed the document first. */
async function update<T>(kv: KV, key: string, fn: (cur: T) => T): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const cur = await kv.get<T>(key)
    if (!cur) return fail(404, 'Not found.')
    const next = fn(structuredClone(cur.data))
    if (await kv.set(key, next, { onlyIfMatch: cur.etag })) return next
    await sleep(25 + Math.random() * 120)
  }
  return fail(409, 'Busy right now. Please try again.')
}

const cleanName = (v: unknown, field = 'name', max = 40) => {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s || s.length > max) fail(400, `Please enter a ${field} (up to ${max} characters).`)
  return s
}

const normalizeCode = (v: unknown) =>
  (typeof v === 'string' ? v : '').toUpperCase().replace(/[^A-Z0-9]/g, '')

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

async function myCouple(kv: KV, userId: string) {
  const u = await kv.get<UserDoc>(K.user(userId))
  const cid = u?.data.couple_id
  if (!cid) return null
  const c = await kv.get<CoupleDoc>(K.couple(cid))
  if (!c || !c.data.members.some((m) => m.user_id === userId)) return null
  return c.data
}

async function requireCouple(kv: KV, userId: string) {
  return (await myCouple(kv, userId)) ?? fail(400, 'Set up your chart first.')
}

// ---------- State ----------

async function getState(kv: KV, user: AuthUser): Promise<AppState> {
  const [couple, sched] = await Promise.all([myCouple(kv, user.id), kv.get<PaySchedule>(K.schedule(user.id))])
  const base: AppState = {
    me: { user_id: user.id, email: user.email },
    member: null,
    couple: null,
    members: [],
    chart: null,
    squares: [],
    schedule: sched?.data ?? null,
    partner_viewing: null,
  }
  if (!couple) return base

  const partner = couple.members.find((m) => m.user_id !== user.id)
  let viewing: number | null = null
  if (partner) {
    const p = await kv.get<Presence>(K.presence(couple.id, partner.user_id))
    if (p && Date.now() - p.data.at < PRESENCE_FRESH_MS) viewing = p.data.viewing
  }
  let chart: Chart | null = null
  let squares: Square[] = []
  if (couple.chart) {
    const { squares: sq, ...rest } = couple.chart
    chart = rest
    squares = sq
  }
  return {
    ...base,
    member: couple.members.find((m) => m.user_id === user.id) ?? null,
    couple: { id: couple.id, invite_code: couple.invite_code },
    members: couple.members,
    chart,
    squares,
    partner_viewing: viewing,
  }
}

// ---------- Couples ----------

async function createCouple(kv: KV, user: AuthUser, body: { name?: unknown }) {
  const name = cleanName(body.name)
  if (await myCouple(kv, user.id)) return
  const id = crypto.randomUUID()
  let code = ''
  for (let i = 0; i < 20 && !code; i++) {
    const c = Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('')
    if (await kv.set(K.invite(c), { couple_id: id }, { onlyIfNew: true })) code = c
  }
  if (!code) fail(500, 'Could not create an invite code. Please try again.')
  const doc: CoupleDoc = {
    id,
    invite_code: code,
    created_at: new Date().toISOString(),
    members: [{ user_id: user.id, display_name: name, joined_at: new Date().toISOString() }],
    chart: null,
  }
  await kv.set(K.couple(id), doc, { onlyIfNew: true })
  await kv.set(K.user(user.id), { couple_id: id } satisfies UserDoc)
}

async function joinCouple(kv: KV, user: AuthUser, body: { code?: unknown; name?: unknown }) {
  const name = cleanName(body.name)
  const code = normalizeCode(body.code)
  const invite = code ? await kv.get<{ couple_id: string }>(K.invite(code)) : null
  if (!invite) return fail(404, 'That invite code didn’t match a chart. Double-check it with your partner.')
  const target = invite.data.couple_id

  const old = await myCouple(kv, user.id)
  if (old?.id === target) return
  if (old && old.members.length > 1) fail(409, 'You’re already sharing a chart with someone.')

  await update<CoupleDoc>(kv, K.couple(target), (doc) => {
    if (doc.members.some((m) => m.user_id === user.id)) return doc
    if (doc.members.length >= 2) fail(409, 'That chart already has two people on it.')
    doc.members.push({ user_id: user.id, display_name: name, joined_at: new Date().toISOString() })
    return doc
  })
  await kv.set(K.user(user.id), { couple_id: target } satisfies UserDoc)

  // Leaving a solo chart to join a partner: tidy up the old one.
  if (old) {
    if (old.chart) await kv.set(K.archive(old.id, old.chart.id), old.chart)
    await kv.delete(K.invite(old.invite_code))
    await kv.delete(K.couple(old.id))
  }
}

async function rename(kv: KV, user: AuthUser, body: { name?: unknown }) {
  const name = cleanName(body.name)
  const couple = await requireCouple(kv, user.id)
  await update<CoupleDoc>(kv, K.couple(couple.id), (doc) => {
    const m = doc.members.find((x) => x.user_id === user.id)
    if (m) m.display_name = name
    return doc
  })
}

// ---------- Charts & squares ----------

async function createChart(kv: KV, user: AuthUser, body: { name?: unknown; goal?: unknown; months?: unknown }) {
  const couple = await requireCouple(kv, user.id)
  const goal = Math.floor(Number(body.goal))
  const months = Math.floor(Number(body.months))
  if (!(goal >= 55 && goal <= 10_000_000)) fail(400, 'Pick a goal between $55 and $10,000,000.')
  if (!(months >= 1 && months <= 120)) fail(400, 'Pick a timeframe between 1 and 120 months.')
  const name = typeof body.name === 'string' && body.name.trim() ? cleanName(body.name, 'chart name', 60) : 'Our savings chart'

  const { n, step, total } = planChart(goal)
  const positions = shuffle(Array.from({ length: n }, (_, i) => i))
  const chart: ChartDoc = {
    id: crypto.randomUUID(),
    name,
    goal: total,
    step,
    square_count: n,
    months,
    created_at: new Date().toISOString(),
    completed_at: null,
    squares: Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      position: positions[i],
      amount: (i + 1) * step,
      scratched_at: null,
      scratched_by: null,
    })),
  }
  let previous: ChartDoc | null = null
  await update<CoupleDoc>(kv, K.couple(couple.id), (doc) => {
    previous = doc.chart
    doc.chart = chart
    return doc
  })
  const prev = previous as ChartDoc | null
  if (prev) await kv.set(K.archive(couple.id, prev.id), prev)
}

async function scratch(kv: KV, user: AuthUser, body: { id?: unknown }) {
  const couple = await requireCouple(kv, user.id)
  const id = Number(body.id)
  let result: Square | null = null
  await update<CoupleDoc>(kv, K.couple(couple.id), (doc) => {
    const sq = doc.chart?.squares.find((s) => s.id === id) ?? fail(404, 'That square isn’t on your chart.')
    if (sq.scratched_at) fail(409, 'That square was already scratched.')
    sq.scratched_at = new Date().toISOString()
    sq.scratched_by = user.id
    if (doc.chart!.squares.every((s) => s.scratched_at)) doc.chart!.completed_at = new Date().toISOString()
    result = { ...sq }
    return doc
  })
  return result
}

async function undo(kv: KV, user: AuthUser, body: { id?: unknown }) {
  const couple = await requireCouple(kv, user.id)
  const id = Number(body.id)
  await update<CoupleDoc>(kv, K.couple(couple.id), (doc) => {
    const sq = doc.chart?.squares.find((s) => s.id === id)
    const ok =
      sq && sq.scratched_by === user.id && sq.scratched_at && Date.now() - Date.parse(sq.scratched_at) < UNDO_WINDOW_MS
    if (!ok) fail(409, 'That scratch can’t be undone anymore.')
    sq!.scratched_at = null
    sq!.scratched_by = null
    doc.chart!.completed_at = null
    return doc
  })
}

async function presence(kv: KV, user: AuthUser, body: { viewing?: unknown }) {
  const couple = await myCouple(kv, user.id)
  if (!couple) return
  const viewing = typeof body.viewing === 'number' && Number.isFinite(body.viewing) ? body.viewing : null
  await kv.set(K.presence(couple.id, user.id), { viewing, at: Date.now() } satisfies Presence)
}

// ---------- Pay schedule ----------

function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

async function saveSchedule(kv: KV, user: AuthUser, body: Partial<PaySchedule>) {
  const kind = body.kind as PayKind
  if (!KINDS.includes(kind)) fail(400, 'Pick a pay schedule.')
  const anchor = kind === 'semimonthly' ? null : body.anchor_date
  if (anchor !== null && !(typeof anchor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(anchor))) fail(400, 'Pick a payday date.')
  const hour = Number(body.remind_hour)
  if (!(Number.isInteger(hour) && hour >= 0 && hour <= 23)) fail(400, 'Pick a reminder time.')
  const timezone = validTimeZone(body.timezone) ? body.timezone : 'America/Chicago'
  const existing = await kv.get<PaySchedule>(K.schedule(user.id))
  const doc: PaySchedule = {
    kind,
    anchor_date: anchor ?? null,
    remind_hour: hour,
    timezone,
    last_notified_on: existing?.data.last_notified_on ?? null,
  }
  await kv.set(K.schedule(user.id), doc)
  return doc
}

// ---------- Notifications ----------

async function vapidKeys(kv: KV): Promise<VapidKeys> {
  const got = await kv.get<VapidKeys>(K.vapid)
  if (got) return got.data
  await kv.set(K.vapid, webpush.generateVAPIDKeys(), { onlyIfNew: true })
  return (await kv.get<VapidKeys>(K.vapid))!.data
}

function vapidSubject() {
  const url = process.env.URL
  return url && url.startsWith('https://') ? url : 'mailto:stax@example.com'
}

async function savePush(kv: KV, user: AuthUser, body: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }) {
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : ''
  const p256dh = typeof body.keys?.p256dh === 'string' ? body.keys.p256dh : ''
  const auth = typeof body.keys?.auth === 'string' ? body.keys.auth : ''
  if (!endpoint.startsWith('https://') || !p256dh || !auth) fail(400, 'That notification subscription looks wrong.')
  const sub: PushSub = { endpoint, keys: { p256dh, auth }, created_at: new Date().toISOString() }
  const key = K.push(user.id)
  if (!(await kv.get(key))) await kv.set(key, [] as PushSub[], { onlyIfNew: true })
  await update<PushSub[]>(kv, key, (list) => [sub, ...list.filter((s) => s.endpoint !== endpoint)].slice(0, 10))
}

async function removePush(kv: KV, user: AuthUser, body: { endpoint?: unknown }) {
  const key = K.push(user.id)
  if (!(await kv.get(key))) return
  await update<PushSub[]>(kv, key, (list) => list.filter((s) => s.endpoint !== body.endpoint))
}

/** Send a notification to every phone a person has turned notifications on for. */
async function notify(kv: KV, userId: string, payload: { title: string; body: string; url: string }) {
  const subs = (await kv.get<PushSub[]>(K.push(userId)))?.data ?? []
  if (!subs.length) return 0
  const keys = await vapidKeys(kv)
  const dead: string[] = []
  let sent = 0
  for (const s of subs) {
    try {
      await webpush.sendNotification(s, JSON.stringify(payload), {
        TTL: 12 * 60 * 60,
        vapidDetails: { subject: vapidSubject(), publicKey: keys.publicKey, privateKey: keys.privateKey },
      })
      sent++
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) dead.push(s.endpoint)
      else console.error('push failed', code, (e as Error).message)
    }
  }
  if (dead.length) await update<PushSub[]>(kv, K.push(userId), (list) => list.filter((s) => !dead.includes(s.endpoint)))
  return sent
}

const PAYDAY = { title: 'Payday! Ready to scratch one?', body: 'Pick any square on your chart.' }

/** Runs hourly (netlify/functions/payday-reminders.mts). */
export async function runReminders(kv: KV, siteUrl: string, now = new Date()) {
  const report: Record<string, string> = {}
  for (const key of await kv.list('schedule/')) {
    const userId = key.slice('schedule/'.length)
    const s = await kv.get<PaySchedule>(key)
    if (!s) continue
    const local = localDateHour(s.data.timezone, now)
    const due =
      isPayday(s.data.kind, s.data.anchor_date, local.date) &&
      local.hour >= s.data.remind_hour &&
      s.data.last_notified_on !== local.date
    if (!due) continue
    const couple = await myCouple(kv, userId)
    const unfinished = couple?.chart?.squares.some((q) => !q.scratched_at)
    if (unfinished) report[userId] = `sent ${await notify(kv, userId, { ...PAYDAY, url: siteUrl + '/' })}`
    await update<PaySchedule>(kv, key, (d) => ({ ...d, last_notified_on: local.date }))
  }
  return report
}

// ---------- Router ----------

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data ?? null), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

export async function handle(req: Request, user: AuthUser | null, kv: KV): Promise<Response> {
  const url = new URL(req.url)
  const route = `${req.method} ${url.pathname.replace(/^\/api/, '').replace(/\/$/, '')}`
  try {
    if (!user) return json({ error: 'Please sign in again.' }, 401)
    let body: Record<string, unknown> = {}
    if (req.method !== 'GET') {
      // JSON-only requests can't be forged by other websites' plain forms.
      if (!(req.headers.get('content-type') ?? '').includes('application/json')) return json({ error: 'Bad request.' }, 415)
      body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
    }
    switch (route) {
      case 'GET /state':
        return json(await getState(kv, user))
      case 'POST /couple/create':
        await createCouple(kv, user, body)
        return json(await getState(kv, user))
      case 'POST /couple/join':
        await joinCouple(kv, user, body)
        return json(await getState(kv, user))
      case 'POST /profile':
        await rename(kv, user, body)
        return json({ ok: true })
      case 'POST /chart':
        await createChart(kv, user, body)
        return json(await getState(kv, user))
      case 'POST /scratch':
        return json(await scratch(kv, user, body))
      case 'POST /undo':
        await undo(kv, user, body)
        return json({ ok: true })
      case 'POST /presence':
        await presence(kv, user, body)
        return json({ ok: true })
      case 'PUT /schedule':
        return json(await saveSchedule(kv, user, body as Partial<PaySchedule>))
      case 'GET /push/key':
        return json({ publicKey: (await vapidKeys(kv)).publicKey })
      case 'POST /push':
        await savePush(kv, user, body)
        return json({ ok: true })
      case 'DELETE /push':
        await removePush(kv, user, body)
        return json({ ok: true })
      case 'POST /push/test': {
        const sent = await notify(kv, user.id, { title: 'Stax notifications are on', body: 'You’ll get a nudge like this on payday.', url: url.origin + '/' })
        return json({ sent })
      }
      default:
        return json({ error: 'Not found.' }, 404)
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    console.error(e)
    return json({ error: 'Something went wrong. Please try again.' }, 500)
  }
}
