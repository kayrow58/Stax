import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { errorText, supabase } from './supabase'
import type { Chart, Couple, Member, PaySchedule, Square } from './types'

export type CoupleData = {
  loading: boolean
  error: string | null
  member: Member | null
  couple: Couple | null
  members: Member[]
  chart: Chart | null
  squares: Square[]
  schedule: PaySchedule | null
}

const EMPTY: CoupleData = {
  loading: true,
  error: null,
  member: null,
  couple: null,
  members: [],
  chart: null,
  squares: [],
  schedule: null,
}

export type RemoteScratch = { square: Square; n: number }

/** Loads everything for the signed-in person and keeps it live with their partner. */
export function useCouple(userId: string) {
  const [data, setData] = useState<CoupleData>(EMPTY)
  const [partnerViewing, setPartnerViewing] = useState<number | null>(null)
  const [remote, setRemote] = useState<RemoteScratch | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const squaresRef = useRef<Square[]>([])
  useEffect(() => {
    squaresRef.current = data.squares
  }, [data.squares])

  const load = useCallback(async () => {
    const [{ data: member, error }, { data: schedule }] = await Promise.all([
      supabase.from('members').select('*').eq('user_id', userId).maybeSingle<Member>(),
      supabase.from('pay_schedules').select('*').eq('user_id', userId).maybeSingle<PaySchedule>(),
    ])
    if (error) {
      setData((p) => ({ ...p, loading: false, error: errorText(error) }))
      return
    }
    if (!member) {
      setData({ ...EMPTY, loading: false, schedule: schedule ?? null })
      return
    }
    const [couple, members, chart] = await Promise.all([
      supabase.from('couples').select('*').eq('id', member.couple_id).maybeSingle<Couple>(),
      supabase.from('members').select('*').eq('couple_id', member.couple_id).order('joined_at'),
      supabase.from('charts').select('*').eq('couple_id', member.couple_id).eq('is_active', true).maybeSingle<Chart>(),
    ])
    let squares: Square[] = []
    if (chart.data) {
      const sq = await supabase.from('squares').select('*').eq('chart_id', chart.data.id).order('position')
      squares = (sq.data as Square[]) ?? []
    }
    setData({
      loading: false,
      error: couple.error || members.error || chart.error ? errorText(couple.error || members.error || chart.error) : null,
      member,
      couple: couple.data ?? null,
      members: (members.data as Member[]) ?? [],
      chart: chart.data ?? null,
      squares,
      schedule: schedule ?? null,
    })
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  // Catch up whenever the app comes back to the foreground.
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && void load()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  const coupleId = data.couple?.id
  const chartId = data.chart?.id

  useEffect(() => {
    if (!coupleId) return
    const ch = supabase.channel(`couple-${coupleId}`, { config: { presence: { key: userId } } })
    if (chartId) {
      ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'squares', filter: `chart_id=eq.${chartId}` }, (payload) => {
        const row = payload.new as Square
        const wasOpen = !squaresRef.current.find((x) => x.id === row.id)?.scratched_at
        setData((p) => ({ ...p, squares: p.squares.map((x) => (x.id === row.id ? row : x)) }))
        if (row.scratched_at && row.scratched_by && row.scratched_by !== userId && wasOpen) {
          setRemote((r) => ({ square: row, n: (r?.n ?? 0) + 1 }))
        }
      })
    }
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter: `couple_id=eq.${coupleId}` }, () => void load())
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'charts', filter: `couple_id=eq.${coupleId}` }, () => void load())
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<{ viewing: number | null }>()
      let viewing: number | null = null
      for (const [key, metas] of Object.entries(state)) {
        if (key === userId) continue
        for (const m of metas) if (m.viewing != null) viewing = m.viewing
      }
      setPartnerViewing(viewing)
    })
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') void ch.track({ viewing: null })
    })
    channelRef.current = ch
    return () => {
      channelRef.current = null
      void supabase.removeChannel(ch)
    }
  }, [coupleId, chartId, userId, load])

  const setViewing = useCallback((squareId: number | null) => {
    void channelRef.current?.track({ viewing: squareId })
  }, [])

  const patchSquare = useCallback((id: number, patch: Partial<Square>) => {
    setData((p) => ({ ...p, squares: p.squares.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
  }, [])

  const setSchedule = useCallback((schedule: PaySchedule) => setData((p) => ({ ...p, schedule })), [])

  return { ...data, reload: load, partnerViewing, remote, setViewing, patchSquare, setSchedule }
}
