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

// ---------- Small / medium / large ----------

export type Tier = 'small' | 'medium' | 'large'
export const TIERS: Tier[] = ['small', 'medium', 'large']

/**
 * Splits a chart's squares into three equal groups by price
 * (33 small, 34 medium, 33 large on a 100-square chart).
 */
export function tierMap(squares: { id: number; amount: number }[]): Map<number, Tier> {
  const sorted = [...squares].sort((a, b) => a.amount - b.amount || a.id - b.id)
  const n = sorted.length
  const cut1 = Math.round(n / 3)
  const cut2 = Math.round((2 * n) / 3)
  const map = new Map<number, Tier>()
  sorted.forEach((s, i) => map.set(s.id, i < cut1 ? 'small' : i < cut2 ? 'medium' : 'large'))
  return map
}

/** Price range of each tier, e.g. small: $2–$99. */
export function tierRanges(squares: { id: number; amount: number }[]) {
  const map = tierMap(squares)
  const out: Record<Tier, { min: number; max: number; count: number }> = {
    small: { min: Infinity, max: 0, count: 0 },
    medium: { min: Infinity, max: 0, count: 0 },
    large: { min: Infinity, max: 0, count: 0 },
  }
  for (const s of squares) {
    const r = out[map.get(s.id)!]
    r.min = Math.min(r.min, s.amount)
    r.max = Math.max(r.max, s.amount)
    r.count++
  }
  return out
}

/**
 * A shuffled grid order where small, medium and large squares are evenly
 * mixed: every run of three squares holds one of each (in random order),
 * so no part of the board is all big or all small.
 * Takes n squares ranked smallest→largest (0…n-1) and returns them in grid order.
 */
export function balancedOrder(n: number, random: () => number = Math.random): number[] {
  const shuffle = <T,>(a: T[]) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }
  const cut1 = Math.round(n / 3)
  const cut2 = Math.round((2 * n) / 3)
  const groups = [
    shuffle(Array.from({ length: cut1 }, (_, i) => i)),
    shuffle(Array.from({ length: cut2 - cut1 }, (_, i) => cut1 + i)),
    shuffle(Array.from({ length: n - cut2 }, (_, i) => cut2 + i)),
  ]
  const order: number[] = []
  while (groups.some((g) => g.length)) {
    for (const g of shuffle(groups.filter((x) => x.length))) order.push(g.pop()!)
  }
  return order
}
