/** Same sizing rules the server uses (netlify/lib/app.ts), so the preview matches what gets saved. */
export function planChart(goal: number) {
  const g = Math.max(55, Math.floor(goal) || 0)
  const n = g >= 5050 ? 100 : Math.max(10, Math.floor((Math.sqrt(8 * g + 1) - 1) / 2))
  const tri = (n * (n + 1)) / 2
  const step = Math.max(1, Math.round(g / tri))
  return { n, step, total: step * tri, rounded: step * tri !== g }
}

export const PAYDAYS_PER_YEAR = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 } as const

export const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

export const MILESTONES = [25, 50, 75, 100]

/** The milestone (25/50/75/100) crossed going from `before` to `after`, if any. */
export function crossedMilestone(goal: number, before: number, after: number): number | null {
  return MILESTONES.find((m) => before < (goal * m) / 100 && after >= (goal * m) / 100) ?? null
}
