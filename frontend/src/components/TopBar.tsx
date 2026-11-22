import { useState } from 'react'
import { useGame } from '../store'
import { dateStr, money, pop } from '../lib/format'
import { Flag } from './common'

const STEPS = [
  { label: '+1 Month', m: 1 }, { label: '+1 Year', m: 12 }, { label: '+10 Years', m: 120 }, { label: '+100 Years', m: 1200 },
]

export default function TopBar({ onExit }: { onExit: () => void }) {
  const { view, advance, busy } = useGame()
  const [custom, setCustom] = useState('')
  if (!view) return null
  const p = view.player
  const m = view.meta
  return (
    <div className="flex items-center gap-4 px-3 h-14 border-b border-ink-700 bg-ink-900/95 relative z-30">
      <button onClick={onExit} className="h-title text-base accent tracking-widest hover:opacity-80 whitespace-nowrap leading-none" title="Main menu">INFINITE HISTORY</button>
      {p && (
        <div className="flex items-center gap-2 min-w-0">
          <Flag tag={p.tag} color={p.color} size={22} />
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate max-w-[220px]" data-testid="player-name">{p.name}</div>
            <div className="text-[11px] text-slate-400 truncate max-w-[220px]">{p.leader.title} {p.leader.name}</div>
          </div>
        </div>
      )}
      <div className="flex flex-col items-center px-3 border-x border-ink-700">
        <div className="h-title text-xl leading-none whitespace-nowrap" data-testid="date">{dateStr(m.year, m.month)}</div>
        <div className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5 max-w-[300px] truncate" title={`${m.era} · ${m.period}`} data-testid="era">{m.era} · {m.period}</div>
      </div>
      {p && (
        <div className="hidden 2xl:flex gap-4 text-xs whitespace-nowrap">
          <div><div className="stat-label">GDP</div><div className="font-semibold">{money(p.gdp)}</div></div>
          <div><div className="stat-label">Population</div><div className="font-semibold">{pop(p.pop)}{p.pops.dig > 0.01 ? <span className="text-violet-300"> +{pop(p.pops.dig)} digital</span> : null}</div></div>
          <div><div className="stat-label">Stability</div><div className={`font-semibold ${p.stability < 35 ? 'text-red-400' : p.stability < 55 ? 'text-amber-300' : 'text-emerald-400'}`}>{Math.round(p.stability)}%</div></div>
          <div><div className="stat-label">Treasury</div><div className="font-semibold">{money(p.treasury)}</div></div>
          <div><div className="stat-label">Phase</div><div className="font-semibold accent truncate max-w-[200px]">{m.phase_label}</div></div>
        </div>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        {STEPS.map(s => (
          <button key={s.m} data-testid={`advance-${s.m}`} disabled={!!busy} onClick={() => advance(s.m)} className={`btn ${s.m === 12 ? 'btn-primary' : 'btn-ghost'} text-xs whitespace-nowrap`}>{s.label}</button>
        ))}
        <input className="input w-20 py-1 text-xs" placeholder="years" value={custom} onChange={e => setCustom(e.target.value.replace(/[^0-9]/g, ''))}
          onKeyDown={e => { if (e.key === 'Enter' && custom) { advance(Number(custom) * 12); setCustom('') } }} data-testid="advance-custom" />
        <button className="btn btn-ghost text-xs" disabled={!custom || !!busy} onClick={() => { advance(Number(custom) * 12); setCustom('') }}>Go</button>
      </div>
    </div>
  )
}
