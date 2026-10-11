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
  me: { user_id: string; email: string }
  member: Member | null
  couple: Couple | null
  members: Member[]
  chart: Chart | null
  squares: Square[]
  schedule: PaySchedule | null
  /** Square id the partner has open right now, if any. */
  partner_viewing: number | null
}
