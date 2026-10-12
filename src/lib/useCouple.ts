import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorText } from './api'
import type { AppState, PaySchedule, Square } from './types'

export type CoupleData = Omit<AppState, 'me' | 'partner_viewing'> & {
  loading: boolean
  error: string | null
  /** 401 from the server: the sign-in is no longer valid. */
  signedOut: boolean
  isAdmin: boolean
}

const EMPTY: CoupleData = {
  loading: true,
  error: null,
  signedOut: false,
  isAdmin: false,
  member: null,
  couple: null,
  members: [],
  chart: null,
  squares: [],
  schedule: null,
}

export type RemoteScratch = { square: Square; n: number }

const POLL_MS = 3000
const PRESENCE_HEARTBEAT_MS = 10_000

/**
 * Loads everything for the signed-in person and keeps it in step with their
 * partner by checking for changes every few seconds while the app is open.
 */
export function useCouple() {
  const [data, setData] = useState<CoupleData>(EMPTY)
  const [partnerViewing, setPartnerViewing] = useState<number | null>(null)
  const [remote, setRemote] = useState<RemoteScratch | null>(null)
  const squaresRef = useRef<Square[]>([])
  const pending = useRef(0)
  const viewingRef = useRef<number | null>(null)

  useEffect(() => {
    squaresRef.current = data.squares
  }, [data.squares])

  const apply = useCallback((s: AppState) => {
    // Spot squares my partner just scratched (they were open a moment ago).
    const before = squaresRef.current
    if (before.length) {
      for (const sq of s.squares) {
        const prev = before.find((b) => b.id === sq.id)
        if (prev && !prev.scratched_at && sq.scratched_at && sq.scratched_by && sq.scratched_by !== s.me.user_id) {
          setRemote((r) => ({ square: sq, n: (r?.n ?? 0) + 1 }))
        }
      }
    }
    squaresRef.current = s.squares
    setPartnerViewing(s.partner_viewing)
    setData({
      loading: false,
      error: null,
      signedOut: false,
      isAdmin: s.me.is_admin,
      member: s.member,
      couple: s.couple,
      members: s.members,
      chart: s.chart,
      squares: s.squares,
      schedule: s.schedule,
    })
  }, [])

  const load = useCallback(async () => {
    try {
      const s = await api<AppState>('GET', '/state')
      // Don't let a poll undo an optimistic change that's still being saved.
      if (pending.current === 0) apply(s)
    } catch (e) {
      const status = (e as { status?: number }).status
      setData((p) => ({ ...p, loading: false, error: errorText(e), signedOut: status === 401 }))
    }
  }, [apply])

  useEffect(() => {
    void load()
    let timer: number | undefined
    const tick = () => {
      window.clearTimeout(timer)
      if (document.visibilityState === 'visible') {
        timer = window.setTimeout(async () => {
          await load()
          tick()
        }, POLL_MS)
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
      tick()
    }
    tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  // Let my partner see which square I have open.
  const setViewing = useCallback((squareId: number | null) => {
    viewingRef.current = squareId
    void api('POST', '/presence', { viewing: squareId }).catch(() => undefined)
  }, [])
  useEffect(() => {
    const t = window.setInterval(() => {
      if (viewingRef.current != null) void api('POST', '/presence', { viewing: viewingRef.current }).catch(() => undefined)
    }, PRESENCE_HEARTBEAT_MS)
    return () => window.clearInterval(t)
  }, [])

  /** Run a change on the server while holding off polls, then refresh. */
  const mutate = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      pending.current++
      try {
        return await fn()
      } finally {
        pending.current--
        void load()
      }
    },
    [load],
  )

  const patchSquare = useCallback((id: number, patch: Partial<Square>) => {
    setData((p) => {
      const squares = p.squares.map((x) => (x.id === id ? { ...x, ...patch } : x))
      squaresRef.current = squares
      return { ...p, squares }
    })
  }, [])

  const setSchedule = useCallback((schedule: PaySchedule) => setData((p) => ({ ...p, schedule })), [])

  return { ...data, reload: load, apply, mutate, partnerViewing, remote, setViewing, patchSquare, setSchedule }
}
