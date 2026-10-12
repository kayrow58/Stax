// Shapes shared by the app (src/) and the Netlify functions (netlify/).

export type Member = {
  user_id: string
  display_name: string
  joined_at: string
}

export type Couple = { id: string; invite_code: string }

export type Chart = {
  id: string
  name: string
  goal: number
  step: number
  square_count: number
  months: number
  created_at: string
  completed_at: string | null
}

export type Square = {
  id: number
  position: number
  amount: number
  scratched_at: string | null
  scratched_by: string | null
}

export type PayKind = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'

export type PaySchedule = {
  kind: PayKind
  anchor_date: string | null
  remind_hour: number
  timezone: string
  last_notified_on: string | null
}

/** Everything the app needs, returned by GET /api/state. */
export type AppState = {
  me: { user_id: string; email: string; is_admin: boolean }
  member: Member | null
  couple: Couple | null
  members: Member[]
  chart: Chart | null
  squares: Square[]
  schedule: PaySchedule | null
  /** Square id the partner has open right now, if any. */
  partner_viewing: number | null
}

/** Admin dashboard data, returned by GET /api/admin/overview (admins only). */
export type AdminOverview = {
  generated_at: string
  timezone: string
  totals: {
    people: number
    couples: number
    paired_couples: number
    active_charts: number
    completed_charts: number
    squares_scratched: number
    dollars_saved: number
    notifications_on: number
  }
  active: { today: number; last_7_days: number; last_30_days: number }
  reminders: { sent: number; followed_by_scratch: number }
  daily: { date: string; active_people: number; opens: number; scratches: number }[]
  features: { event: string; label: string; count: number; people: number }[]
  people: {
    user_id: string
    email: string
    name: string | null
    partner: string | null
    first_seen: string
    last_seen: string
    days_active_30: number
    opens_30: number
    scratches_total: number
    saved_on_current_chart: number
    notifications: boolean
    installed: boolean | null
    platform: string | null
    reminders_sent: number
    reminders_converted: number
  }[]
  couples: {
    id: string
    names: string[]
    partners: number
    chart_name: string | null
    goal: number
    saved: number
    squares_done: number
    square_count: number
    completed: boolean
    last_scratch: string | null
    both_active_7d: boolean
  }[]
  recent: { at: string; who: string; what: string; detail: string | null }[]
}
