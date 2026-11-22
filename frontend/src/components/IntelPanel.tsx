import { useEffect, useState } from 'react'
import { api } from '../api'
import { useGame } from '../store'
import { money, pct, pop } from '../lib/format'
import { Flag, Section } from './common'

export default function IntelPanel() {
  const { view, cid, setSelected } = useGame()
  const [r, setR] = useState<any>(null)
  const [sub, setSub] = useState<'powers' | 'wars' | 'orgs' | 'ideas'>('powers')
  useEffect(() => { api.rankings(cid).then(setR) }, [cid, view?.meta.year, view?.meta.month])
  if (!view) return null
  const name = (t: string) => view.countries[t]?.name || t
  return (
    <div className="p-3 h-full flex flex-col" data-testid="intel-panel">
      <div className="grid grid-cols-4 gap-2 mb-2 text-xs">
        <div><div className="stat-label">World GDP</div><b>{money(view.world.gdp)}</b></div>
        <div><div className="stat-label">Humanity</div><b>{pop(view.world.pop)}</b></div>
        <div><div className="stat-label">Digital minds</div><b>{pop(view.world.dig)}</b></div>
        <div><div className="stat-label">Off-world</div><b>{pop(view.world.offworld)}</b></div>
      </div>
      <div className="flex gap-1 mb-2">
        {(['powers', 'wars', 'orgs', 'ideas'] as const).map(s => <button key={s} className={`btn text-xs py-0.5 ${sub === s ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setSub(s)}>{{ powers: 'Powers', wars: `Wars (${view.wars.length})`, orgs: 'Organisations', ideas: 'Ideologies' }[s]}</button>)}
      </div>
      <div className="overflow-y-auto flex-1">
        {sub === 'powers' && r && (
          <table className="w-full text-xs">
            <thead className="text-slate-500 text-[10px] uppercase"><tr><th className="text-left py-1">State</th><th className="text-right">Power</th><th className="text-right">GDP</th><th className="text-right">Share</th><th className="text-right">Pop</th><th className="text-right">Stab</th></tr></thead>
            <tbody>
              {r.rows.slice(0, 60).map((row: any, i: number) => (
                <tr key={row.tag} className={`border-t border-ink-700/60 hover:bg-ink-800 cursor-pointer ${row.tag === view.meta.player ? 'accent-bg' : ''}`} onClick={() => setSelected(row.tag)}>
                  <td className="py-1 flex items-center gap-1.5"><span className="text-slate-500 w-5">{i + 1}</span><Flag tag={row.tag} color={row.color} size={11} /><span className="truncate max-w-[130px]" title={`${row.gov} · ${row.ideology}`}>{row.name}</span>{row.overlord && <span className="text-[9px] text-amber-400">sub</span>}</td>
                  <td className="text-right tabular-nums">{row.power.toFixed(1)}</td><td className="text-right tabular-nums">{money(row.gdp)}</td>
                  <td className="text-right tabular-nums">{pct(row.gdp_share, 1)}</td><td className="text-right tabular-nums">{pop(row.pop)}</td><td className="text-right tabular-nums">{row.stability}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {sub === 'wars' && (view.wars.length === 0 ? <div className="text-xs text-slate-500">The world is at peace.</div> : view.wars.map(w => (
          <div key={w.id} className="panel p-2.5 mb-2 bg-ink-850">
            <div className="flex justify-between"><b className="text-sm">{w.name}</b><span className="text-[11px] text-slate-400">since {w.start}</span></div>
            <div className="text-xs mt-1"><span className="text-sky-300">{w.att.map(name).join(', ')}</span> <span className="text-slate-500">vs</span> <span className="text-red-300">{w.def.map(name).join(', ')}</span></div>
            <div className="text-xs mt-1 text-slate-400">War score {w.score > 0 ? '+' : ''}{w.score} (attackers) · goal: {w.goal} · casualties {Math.round(Object.values(w.cas).reduce((a, b) => a + b, 0)).toLocaleString()}k</div>
            <div className="h-2 bg-red-900/60 rounded mt-1 overflow-hidden"><div className="h-full bg-sky-600" style={{ width: `${50 + w.score / 2}%` }} /></div>
          </div>
        )))}
        {sub === 'orgs' && (
          <>
            <Section title="Organisations">
              {view.orgs.map(o => (
                <div key={o.id} className="mb-2">
                  <div className="text-sm font-semibold">{o.name} <span className="chip">{o.kind}</span> <span className="text-[11px] text-slate-500">since {o.founded}</span></div>
                  <div className="text-[11px] text-slate-400">{o.desc}</div>
                  <div className="text-[11px] text-slate-300">{o.members.slice(0, 20).map(name).join(', ')}{o.members.length > 20 ? ` +${o.members.length - 20}` : ''}</div>
                </div>
              ))}
            </Section>
            <Section title="Treaties">
              {view.treaties.slice(-40).reverse().map(t => <div key={t.id} className="text-xs py-0.5">{t.secret && <span className="text-violet-300">[secret] </span>}{t.name} <span className="text-slate-500">({t.type.replace('_', ' ')}, {t.since})</span></div>)}
            </Section>
          </>
        )}
        {sub === 'ideas' && (
          <>
            {Object.entries(view.ideologies).sort((a: any, b: any) => Number(b[1].custom) - Number(a[1].custom)).map(([id, ide]: any) => (
              <div key={id} className="mb-3">
                <div className="text-sm font-semibold">{ide.name} <span className="chip">{ide.family}</span>{ide.custom && <span className="chip text-violet-300 ml-1">emerged {ide.year}</span>}</div>
                <div className="text-xs text-slate-300">{ide.desc}</div>
                {ide.custom && <div className="text-[11px] text-slate-400">Origin: {ide.origin}. Supporters: {ide.supporters}. Opponents: {ide.opponents}.</div>}
                <div className="text-[11px] text-slate-500">Held by: {Object.values(view.countries).filter(c => c.alive && c.ideology_id === id).map(c => c.name).slice(0, 8).join(', ') || 'no state'}</div>
              </div>
            ))}
            {Object.values(view.faiths).length > 0 && <Section title="Faiths">{Object.values(view.faiths).map((f: any) => <div key={f.name} className="text-xs mb-1"><b>{f.name}</b> (founded {f.founded} by {name(f.founder)}) {f.desc}</div>)}</Section>}
          </>
        )}
      </div>
    </div>
  )
}
