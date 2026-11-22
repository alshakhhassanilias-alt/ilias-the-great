import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api } from './api'
import type { CampaignView, GameEvent } from './types'

export type MapMode = 'political' | 'diplomatic' | 'economy' | 'unrest' | 'war' | 'ideology' | 'population' | 'integration'
export interface Toast { id: number; text: string; kind?: 'info' | 'error' | 'success' }

interface GameCtx {
  cid: string; view: CampaignView | null; loading: boolean; busy: string | null
  refresh: () => Promise<void>; advance: (months: number) => Promise<void>
  selected: string | null; setSelected: (t: string | null) => void
  selProvince: string | null; setSelProvince: (p: string | null) => void
  mapMode: MapMode; setMapMode: (m: MapMode) => void
  tab: string; setTab: (t: string) => void
  popups: GameEvent[]; dismissPopup: () => void
  toast: (text: string, kind?: Toast['kind']) => void; toasts: Toast[]
  command: string; setCommand: (s: string) => void
  setBusy: (s: string | null) => void
  lastAdvance: any
}
const Ctx = createContext<GameCtx | null>(null)
export const useGame = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('no game context')
  return c
}

export function GameProvider({ cid, children }: { cid: string; children: React.ReactNode }) {
  const [view, setView] = useState<CampaignView | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [selProvince, setSelProvince] = useState<string | null>(null)
  const [mapMode, setMapMode] = useState<MapMode>('political')
  const [tab, setTab] = useState('story')
  const [popups, setPopups] = useState<GameEvent[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [command, setCommand] = useState('')
  const [lastAdvance, setLastAdvance] = useState<any>(null)
  const tid = useRef(1)

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = tid.current++
    setToasts(t => [...t, { id, text, kind }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000)
  }, [])
  const refresh = useCallback(async () => {
    const v = await api.view(cid)
    setView(v)
    setLoading(false)
  }, [cid])
  useEffect(() => { refresh().catch(e => { toast(String(e), 'error'); setLoading(false) }) }, [refresh, toast])
  const advance = useCallback(async (months: number) => {
    setBusy(months >= 120 ? `Simulating ${Math.round(months / 12)} years of history…` : 'Advancing time…')
    try {
      const r = await api.advance(cid, months)
      setLastAdvance(r)
      setPopups(p => [...p, ...r.popups])
      if (r.result?.stopped === 'decision') toast('Time paused: a decision requires your attention.', 'info')
      if (r.result?.stopped === 'fallen') toast('Your state has fallen.', 'error')
      await refresh()
    } catch (e) { toast(String(e), 'error') } finally { setBusy(null) }
  }, [cid, refresh, toast])

  return (
    <Ctx.Provider value={{ cid, view, loading, busy, refresh, advance, selected, setSelected, selProvince, setSelProvince, mapMode, setMapMode, tab, setTab,
      popups, dismissPopup: () => setPopups(p => p.slice(1)), toast, toasts, command, setCommand, setBusy, lastAdvance }}>
      {children}
    </Ctx.Provider>
  )
}
