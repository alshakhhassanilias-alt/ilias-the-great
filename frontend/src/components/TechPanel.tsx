import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useGame } from '../store'
import { num, yearStr } from '../lib/format'

const CAT_COLOR: Record<string, string> = { industry: '#f59e0b', military: '#ef4444', computing: '#38bdf8', energy: '#facc15', biology: '#34d399', space: '#a78bfa', society: '#f472b6' }

export default function TechPanel() {
  const { view, cid, toast, refresh } = useGame()
  const [data, setData] = useState<any>(null)
  const [showAll, setShowAll] = useState(false)
  const [sel, setSel] = useState<any>(null)
  useEffect(() => { api.tech(cid).then(setData) }, [cid, view?.meta.year, view?.meta.month])
  const rows = useMemo(() => {
    if (!data) return []
    const techs: any[] = data.techs
    const avTiers = techs.filter(t => t.status === 'available').map(t => t.tier)
    const lo = Math.max(0, Math.min(...avTiers, 99) - 2), hi = Math.max(...avTiers, 0) + 3
    const tiers = Array.from(new Set(techs.map(t => t.tier))).sort((a, b) => a - b).filter(t => showAll || (t >= lo && t <= hi))
    return tiers.map(tier => ({ tier, techs: techs.filter(t => t.tier === tier) }))
  }, [data, showAll])
  if (!data) return <div className="p-3 text-sm text-slate-400">Loading the state of knowledge…</div>
  async function research(id: string) {
    const r = await api.setResearch(cid, id)
    toast(r.message, 'success')
    api.tech(cid).then(setData)
    refresh()
  }
  const target = data.techs.find((t: any) => t.id === data.research.target)
  return (
    <div className="p-3 h-full flex flex-col" data-testid="tech-panel">
      <div className="flex justify-between items-center mb-2">
        <div className="text-xs">
          <div>Researching: <b className="accent">{target?.name || '—'}</b> · {num(data.rate, 2)} RP/yr</div>
          {data.research.queue?.length > 1 && <div className="text-slate-500">Queue: {data.research.queue.length} steps</div>}
        </div>
        <div className="flex gap-1">
          <label className="text-xs text-slate-400 flex items-center gap-1 mr-2"><input type="checkbox" checked={data.auto} onChange={async e => { await api.setResearch(cid, undefined, e.target.checked); api.tech(cid).then(setData) }} /> auto</label>
          <button className={`btn text-xs py-0.5 ${showAll ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowAll(s => !s)}>{showAll ? 'Frontier' : 'Full tree'}</button>
        </div>
      </div>
      <div className="flex gap-2 mb-2 flex-wrap">{Object.entries(CAT_COLOR).map(([k, c]) => <span key={k} className="text-[10px] flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: c }} />{k}</span>)}</div>
      <div className="overflow-y-auto flex-1 pr-1">
        {rows.map(r => (
          <div key={r.tier} className="flex gap-2 mb-1.5 items-stretch">
            <div className="w-8 shrink-0 text-[10px] text-slate-500 pt-1">T{r.tier}</div>
            <div className="flex flex-wrap gap-1 flex-1">
              {r.techs.map((t: any) => (
                <button key={t.id} onClick={() => setSel(t)} data-testid={`tech-${t.id}`}
                  className={`text-left px-2 py-1 rounded border text-[11px] leading-tight max-w-[170px] ${t.status === 'known' ? 'bg-ink-700/70 border-ink-600 text-slate-300' : t.status === 'available' ? 'bg-ink-850 border-current' : 'bg-ink-900 border-ink-700 text-slate-500'} ${t.id === data.research.target ? 'ring-1 ring-offset-0' : ''}`}
                  style={{ color: t.status === 'available' ? CAT_COLOR[t.cat] : undefined, boxShadow: t.id === data.research.target ? `0 0 0 1px var(--accent)` : undefined }}>
                  {t.status === 'known' ? '✔ ' : ''}{t.name}{t.generated ? ' ✦' : ''}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {sel && (
        <div className="panel p-2.5 mt-2 bg-ink-850 text-xs">
          <div className="flex justify-between"><b style={{ color: CAT_COLOR[sel.cat] }}>{sel.name}</b><button onClick={() => setSel(null)} className="text-slate-500">✕</button></div>
          <div className="text-slate-300 mt-1">{sel.desc}</div>
          <div className="text-slate-500 mt-1">Tier {sel.tier} · base cost {num(sel.cost, 1)} RP{sel.year ? ` · historical anchor ${yearStr(sel.year)}` : ' · speculative'}{sel.first ? ` · first achieved by ${view?.countries[sel.first.by]?.name || sel.first.by} in ${sel.first.year}` : ''}</div>
          <div className="text-slate-500">Requires: {sel.pre.map((p: string) => data.techs.find((t: any) => t.id === p)?.name || p).join(', ') || '—'}</div>
          <div className="text-slate-400">Effects: {Object.entries(sel.eff).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join('/') : typeof v === 'number' && v < 1 ? `+${Math.round(v * 100)}%` : v}`).join(', ')}</div>
          {sel.status !== 'known' && <button className="btn btn-primary text-xs mt-1.5" onClick={() => research(sel.id)} data-testid="research-btn">{sel.status === 'available' ? 'Research now' : 'Research toward this'}</button>}
        </div>
      )}
    </div>
  )
}
