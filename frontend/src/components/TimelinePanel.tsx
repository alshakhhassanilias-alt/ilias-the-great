import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useGame } from '../store'
import { yearStr } from '../lib/format'

const KIND_COLOR: Record<string, string> = { fall: '#ef4444', tech: '#38bdf8', space: '#a78bfa', era: '#d4a63f', chapter: '#f59e0b', independence: '#22c55e', law: '#f472b6', organization: '#60a5fa', ideology: '#c084fc', campaign: '#fff', founding: '#fbbf24', society: '#e879f9', catastrophe: '#dc2626', religion: '#fde68a', crisis: '#fb923c' }

export default function TimelinePanel({ onViewSnapshot }: { onViewSnapshot: (m: any | null) => void }) {
  const { view, cid } = useGame()
  const [snaps, setSnaps] = useState<any[]>([])
  const [idx, setIdx] = useState<number | null>(null)
  useEffect(() => { api.saves(cid).then(setSnaps) }, [cid, view?.meta.year])
  useEffect(() => () => onViewSnapshot(null), [])
  const ms = useMemo(() => [...(view?.milestones || [])].sort((a, b) => a.y - b.y), [view])
  if (!view) return null
  const y0 = view.meta.start_year, y1 = Math.max(view.meta.year, y0 + 1)
  async function show(i: number | null) {
    setIdx(i)
    if (i === null) { onViewSnapshot(null); return }
    onViewSnapshot(await api.snapMap(cid, snaps[i].id))
  }
  return (
    <div className="p-3 h-full flex flex-col" data-testid="timeline-panel">
      <div className="text-xs text-slate-400 mb-1">Explore the map at any recorded moment of the campaign.</div>
      {snaps.length > 0 && (
        <div className="panel p-2 mb-3 bg-ink-850">
          <input type="range" min={0} max={snaps.length - 1} value={idx ?? snaps.length - 1} onChange={e => show(Number(e.target.value))} className="w-full accent-amber-500" data-testid="timeline-slider" />
          <div className="flex justify-between text-xs">
            <span>{idx !== null ? <>Viewing <b className="accent">{snaps[idx].label}</b> ({snaps[idx].year})</> : 'Present day'}</span>
            {idx !== null && <button className="btn btn-ghost text-[11px] py-0" onClick={() => show(null)}>Return to present</button>}
          </div>
        </div>
      )}
      <div className="relative h-10 mb-3 border-b border-ink-600">
        {ms.map((m, i) => (
          <div key={i} title={`${m.y}: ${m.title}`} className="absolute bottom-0 w-1 rounded-t" style={{ left: `${((m.y - y0) / (y1 - y0)) * 100}%`, height: 10 + (i % 4) * 6, background: KIND_COLOR[m.kind] || '#94a3b8' }} />
        ))}
        <div className="absolute -bottom-4 left-0 text-[10px] text-slate-500">{yearStr(y0)}</div>
        <div className="absolute -bottom-4 right-0 text-[10px] text-slate-500">{yearStr(y1)}</div>
      </div>
      <div className="overflow-y-auto flex-1 mt-2">
        {[...ms].reverse().map((m, i) => (
          <div key={i} className="flex gap-2 py-1 border-b border-ink-800">
            <div className="w-12 text-xs text-slate-500 tabular-nums">{yearStr(m.y)}</div>
            <div className="w-1.5 rounded" style={{ background: KIND_COLOR[m.kind] || '#94a3b8' }} />
            <div className="text-xs">{m.title}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
