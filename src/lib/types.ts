export type Couple = { id: string; invite_code: string; created_at: string }

export type Member = {
  user_id: string
  couple_id: string
  display_name: string
  joined_at: string
}

export type Chart = {
  id: string
  couple_id: string
  name: string
  goal: number
  step: number
  square_count: number
  months: number
  is_active: boolean
  created_at: string
  completed_at: string | null
}

export type Square = {
  id: number
  chart_id: string
  position: number
  amount: number
  scratched_at: string | null
  scratched_by: string | null
}

export type PayKind = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'

export type PaySchedule = {
  user_id: string
  kind: PayKind
  anchor_date: string | null
  remind_hour: number
  timezone: string
  email_backup: boolean
  last_notified_on: string | null
}
