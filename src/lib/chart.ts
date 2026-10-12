// Chart pricing, shared by the app (preview) and the server (netlify/lib/app.ts).

/** Every chart has this many squares. Changing the goal only changes their prices. */
export const SQUARES = 100
/** Each square is at least $1. */
export const MIN_GOAL = SQUARES
export const MAX_GOAL = 10_000_000

/**
 * Whole-dollar prices for `n` squares that add up to exactly `total`,
 * growing steadily from small to large (like the classic $3 → $300 chart).
 * $15,150 gives exactly $3, $6, $9 … $300; $15,000 gives $2 … $297.
 */
export function priceSquares(total: number, n: number): number[] {
  if (n <= 0) return []
  const tri = (n * (n + 1)) / 2
  // When the goal is too small for every square to grow by at least $1,
  // give each square $1 and spread the rest the same way.
  const base = total >= tri ? 0 : 1
  const spread = total - base * n
  const out: number[] = []
  let prev = 0
  for (let i = 1; i <= n; i++) {
    const cum = Math.floor((spread * ((i * (i + 1)) / 2)) / tri)
    out.push(base + cum - prev)
    prev = cum
  }
  return out.sort((a, b) => a - b)
}

/** What a chart for this goal will look like (for the setup preview). */
export function planChart(goal: number) {
  const g = Math.floor(goal) || 0
  const amounts = priceSquares(Math.max(MIN_GOAL, g), SQUARES)
  return { n: SQUARES, min: amounts[0], max: amounts[amounts.length - 1], total: g }
}

export const PAYDAYS_PER_YEAR = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 } as const

export const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

export const MILESTONES = [25, 50, 75, 100]

/** The milestone (25/50/75/100) crossed going from `before` to `after`, if any. */
export function crossedMilestone(goal: number, before: number, after: number): number | null {
  return MILESTONES.find((m) => before < (goal * m) / 100 && after >= (goal * m) / 100) ?? null
}
