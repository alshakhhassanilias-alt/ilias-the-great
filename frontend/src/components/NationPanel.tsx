import { useEffect, useState } from 'react'
import { api } from '../api'
import { useGame } from '../store'
import { money, num, pop } from '../lib/format'
import { Bar, Flag, Section, Spark, Stat } from './common'
import { provinceName } from '../lib/geo'

const POLICY_OPTIONS: Record<string, string[]> = {
  integration: ['assimilate', 'autonomy', 'suppress', 'federal'], economy: ['market', 'mixed', 'planned', 'autarky', 'post_scarcity'],
  mobilization: ['none', 'partial', 'total'], colonial: ['direct', 'autonomy', 'representation'],
  digital_rights: ['none', 'limited', 'equal'], ai_rights: ['none', 'limited', 'equal', 'banned'], upload: ['banned', 'voluntary', 'encouraged', 'mass'],
  enhancement: ['banned', 'regulated', 'free', 'mandatory'],
}
const POLICY_REQ: Record<string, string> = { digital_rights: 'upload', upload: 'upload', ai_rights: 'ai_minds', enhancement: 'enhancement' }

export default function NationPanel() {
  const { view, cid, refresh, toast, selected } = useGame()
  const p = view?.player
  const [budget, setBudget] = useState<Record<string, number>>({})
  useEffect(() => { if (p) setBudget({ ...p.budget }) }, [p?.budget?.military, p?.budget?.research, p?.budget?.infra, p?.budget?.welfare, view?.meta.year])
  if (!view) return null
  if (selected && selected !== view.meta.player) return <CountryInspector tag={selected} />
  if (!p) return <FallenPanel />
  const hist = view.history[p.tag] || []
  const total = Object.values(budget).reduce((a, b) => a + b, 0)
  async function applyBudget() {
    const acts = Object.entries(budget).filter(([k, v]) => Math.abs(v - (p!.budget[k] || 0)) > 1e-4).map(([k, v]) => ({ type: 'set_budget', category: k, value: v }))
    if (!acts.length) return
    const r = await api.execute(cid, 'Adjust the national budget', acts)
    toast(r.summary || 'Budget updated', 'success')
    refresh()
  }
  async function setPolicy(policy: string, value: string) {
    const r = await api.execute(cid, `Set ${policy.replace('_', ' ')} policy to ${value}`, [{ type: 'set_policy', policy, value }])
    toast(r.summary, r.ok ? 'success' : 'error')
    refresh()
  }
  return (
    <div className="p-3 overflow-y-auto h-full text-sm" data-testid="nation-panel">
      <div className="flex items-start gap-3 mb-3">
        <Flag tag={p.tag} color={p.color} size={36} />
        <div className="min-w-0">
          <div className="h-title text-lg leading-tight">{p.name}</div>
          <div className="text-xs text-slate-400">{p.gov}</div>
          <div className="text-xs accent">{p.ideology}</div>
        </div>
      </div>
      <div className="panel p-2.5 mb-3 bg-ink-850/60">
        <div className="flex justify-between">
          <div>
            <div className="font-semibold">{p.leader.name}</div>
            <div className="text-xs text-slate-400">{p.leader.title}{p.leader.digital ? ' · digital mind' : ''} · in power since {p.leader.since} · born {p.leader.born}</div>
          </div>
        </div>
        <div className="grid grid-cols-5 gap-1 mt-2">
          {Object.entries(p.leader.traits).map(([k, v]) => (
            <div key={k} title={k}><div className="stat-label text-center">{({ agg: 'Aggr', cau: 'Caut', hon: 'Hon', amb: 'Amb', prag: 'Prag' } as any)[k]}</div><Bar value={v * 100} /></div>
          ))}
        </div>
        {p.dynasty && <div className="text-[11px] text-slate-400 mt-1.5">House of {p.dynasty.name} · founded {p.dynasty.founded} · {p.dynasty.rulers} ruler(s)</div>}
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Stat label="GDP" value={money(p.gdp)} sub={`$${num(p.gpc)} per capita`} />
        <Stat label="Population" value={pop(p.pop)} sub={p.pops.dig > 0.001 ? `${pop(p.pops.dig)} digital` : p.pops.ai > 0.001 ? `${pop(p.pops.ai)} AI persons` : 'biological'} />
        <Stat label="Stability" value={`${Math.round(p.stability)}%`} tone={p.stability < 35 ? 'bad' : p.stability < 55 ? 'warn' : 'good'} />
        <Stat label="Legitimacy" value={`${Math.round(p.legitimacy)}%`} />
        <Stat label="Treasury" value={money(p.treasury)} />
        <Stat label="Debt" value={money(p.debt)} tone={p.debt > p.gdp ? 'bad' : undefined} />
        <Stat label="Army" value={`${num(p.army)}k`} />
        <Stat label="Navy / Air" value={`${num(p.navy)} / ${num(p.air)}`} />
        <Stat label={p.space ? 'Space fleet' : 'Nuclear'} value={p.space ? num(p.space) : num(p.nukes)} />
      </div>
      {hist.length > 2 && (
        <Section title="Trajectory">
          <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400">
            <div>GDP<Spark data={hist.map(h => h[1])} w={140} /></div>
            <div>Stability<Spark data={hist.map(h => h[4])} w={140} color="#34d399" /></div>
            <div>Population<Spark data={hist.map(h => h[2] + h[5])} w={140} color="#60a5fa" /></div>
            <div>Provinces<Spark data={hist.map(h => h[6])} w={140} color="#f472b6" /></div>
          </div>
        </Section>
      )}
      <Section title="Budget (% of GDP)" right={<button className="btn btn-primary text-[11px] py-0.5" data-testid="apply-budget" onClick={applyBudget}>Apply</button>}>
        {['military', 'research', 'infra', 'welfare'].map(k => (
          <div key={k} className="flex items-center gap-2 mb-1">
            <div className="w-20 text-xs capitalize text-slate-300">{k === 'infra' ? 'Infrastructure' : k}</div>
            <input type="range" min={0} max={0.4} step={0.0025} value={budget[k] ?? 0} onChange={e => setBudget(b => ({ ...b, [k]: Number(e.target.value) }))} className="flex-1 accent-amber-500" data-testid={`budget-${k}`} />
            <div className="w-12 text-right text-xs tabular-nums">{((budget[k] ?? 0) * 100).toFixed(1)}%</div>
          </div>
        ))}
        <div className={`text-[11px] ${total > 0.2 ? 'text-amber-400' : 'text-slate-500'}`}>Programmed spending {(total * 100).toFixed(1)}% of GDP; sustainable ≈12%.</div>
      </Section>
      <Section title="Research">
        <div className="text-xs mb-1">{p.research.name || 'No active research'} <span className="text-slate-500">· {num(p.research.rate, 2)} RP/yr</span></div>
        {p.research.cost ? <Bar value={p.research.progress} max={p.research.cost} /> : null}
        {p.focus && <div className="text-[11px] text-slate-400 mt-1">Focus: {p.focus}</div>}
      </Section>
      <Section title="Policies">
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(POLICY_OPTIONS).filter(([k]) => !POLICY_REQ[k] || p.unlocks.includes(POLICY_REQ[k])).map(([k, opts]) => (
            <label key={k} className="text-[11px] text-slate-400">
              <span className="capitalize">{k.replace('_', ' ')}</span>
              <select className="input w-full py-1 text-xs mt-0.5" value={p.policies[k] ?? ''} onChange={e => setPolicy(k, e.target.value)} data-testid={`policy-${k}`}>
                <option value="" disabled>—</option>
                {opts.map(o => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
              </select>
            </label>
          ))}
        </div>
      </Section>
      {p.projects.length > 0 && (
        <Section title="Projects underway">
          {p.projects.map(pr => (
            <div key={pr.id} className="mb-2">
              <div className="flex justify-between text-xs"><span>{pr.name}</span><span className="text-slate-500">{Math.round(pr.progress * 100)}%</span></div>
              <Bar value={pr.progress * 100} />
              <div className="text-[10px] text-slate-500">{money(pr.cost)} · {pr.years.toFixed(1)} yrs · since {pr.started}</div>
            </div>
          ))}
        </Section>
      )}
      {p.laws.length > 0 && (
        <Section title="Laws & reforms">
          <ul className="space-y-1">{p.laws.slice(-8).reverse().map((l, i) => <li key={i} className="text-xs"><span className="text-slate-500">{l.year}</span> {l.name}</li>)}</ul>
        </Section>
      )}
      {(p.heritage?.length > 0 || p.origin) && (
        <Section title="Origins">
          <p className="text-xs text-slate-300 leading-relaxed">{p.origin}</p>
          {p.heritage?.map((h, i) => <div key={i} className="text-[11px] accent mt-1">Heir of {h.name}{h.fell ? ` (fell ${h.fell})` : ''}</div>)}
        </Section>
      )}
      <Section title="National memory">
        <ul className="space-y-1">{p.memories.slice(0, 10).map((m, i) => (
          <li key={i} className="text-xs leading-snug"><span className={m.w < 0 ? 'text-red-400' : 'text-emerald-400'}>{m.y}</span> {m.text}</li>
        ))}</ul>
      </Section>
    </div>
  )
}

function FallenPanel() {
  const { view, cid, refresh } = useGame()
  if (!view) return null
  const alive = Object.values(view.countries).filter(c => c.alive).sort((a, b) => b.power - a.power).slice(0, 30)
  return (
    <div className="p-3 overflow-y-auto h-full">
      <div className="h-title text-lg text-red-400 mb-2">Your state has fallen</div>
      <p className="text-sm text-slate-300 mb-3">History continues. Choose a nation through which to follow the story.</p>
      {alive.map(c => (
        <button key={c.tag} className="w-full flex items-center gap-2 p-1.5 rounded hover:bg-ink-700 text-left text-sm" onClick={async () => { await api.switchCountry(cid, c.tag); refresh() }}>
          <Flag tag={c.tag} color={c.color} size={16} /> {c.name}
        </button>
      ))}
    </div>
  )
}

export function CountryInspector({ tag }: { tag: string }) {
  const { view, cid, setSelected, setTab, setCommand } = useGame()
  const [d, setD] = useState<any>(null)
  useEffect(() => { setD(null); api.country(cid, tag).then(setD).catch(() => setD(null)) }, [cid, tag, view?.meta.year, view?.meta.month])
  const c = view?.countries[tag]
  if (!c) return <div className="p-3 text-sm text-slate-400">Unknown state.</div>
  return (
    <div className="p-3 overflow-y-auto h-full text-sm" data-testid="country-inspector">
      <div className="flex items-center justify-between mb-2">
        <button className="text-xs text-slate-400 hover:text-slate-100" onClick={() => setSelected(null)}>← Back to my nation</button>
      </div>
      <div className="flex items-start gap-3 mb-3">
        <Flag tag={c.tag} color={c.color} size={34} />
        <div>
          <div className="h-title text-lg leading-tight">{c.name}</div>
          <div className="text-xs text-slate-400">{c.gov} · {c.ideology}</div>
          {c.overlord && <div className="text-xs text-amber-300">Subject of {view?.countries[c.overlord]?.name}</div>}
        </div>
      </div>
      <div className="panel p-2 mb-3 bg-ink-850/60">
        <div className="font-semibold">{c.leader.name}</div>
        <div className="text-xs text-slate-400">{c.leader.title} since {c.leader.since}</div>
        <div className="grid grid-cols-5 gap-1 mt-2">{Object.entries(c.leader.traits).map(([k, v]) => <div key={k}><div className="stat-label text-center">{k}</div><Bar value={v * 100} /></div>)}</div>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Stat label="GDP" value={money(c.gdp)} /><Stat label="Population" value={pop(c.pop)} /><Stat label="Stability" value={`${Math.round(c.stability)}%`} />
        <Stat label="Power" value={c.power.toFixed(1)} />
        {d && <Stat label="Their view of us" value={`${d.opinion_of_player > 0 ? '+' : ''}${d.opinion_of_player}`} tone={d.opinion_of_player < -20 ? 'bad' : d.opinion_of_player > 20 ? 'good' : undefined} />}
        {d && <Stat label="Trust" value={d.trust} />}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        <button className="btn btn-primary text-xs" onClick={() => setTab('diplomacy')} data-testid="open-diplomacy">Open talks</button>
        <button className="btn btn-ghost text-xs" onClick={() => { setCommand(`Propose an alliance with ${c.name}`); setTab('command') }}>Alliance…</button>
        <button className="btn btn-ghost text-xs" onClick={() => { setCommand(`Improve relations with ${c.name}`); setTab('command') }}>Improve relations</button>
        <button className="btn btn-danger text-xs" onClick={() => { setCommand(`Declare war on ${c.name}`); setTab('command') }}>Declare war…</button>
      </div>
      {d && (
        <>
          {d.origin && <Section title="Origins"><p className="text-xs text-slate-300">{d.origin}</p></Section>}
          {d.allies?.length > 0 && <Section title="Allies"><div className="flex flex-wrap gap-1">{d.allies.map((a: string) => <span key={a} className="chip">{view?.countries[a]?.name || a}</span>)}</div></Section>}
          {d.wars?.length > 0 && <Section title="At war"><div className="text-xs text-red-300">{d.wars.join(', ')}</div></Section>}
          {d.ambitions?.length > 0 && <Section title="Ambitions"><ul className="text-xs list-disc ml-4">{d.ambitions.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul></Section>}
          {d.intel && <Section title="Intelligence report"><div className="text-xs text-slate-300">Army ≈{num(d.intel.army)}k · researching {d.intel.research || '—'} · claims {d.intel.claims_on_us} of our provinces · secret treaties: {d.intel.secret_treaties.join(', ') || 'none found'}</div></Section>}
          <Section title="Their memory of the world">
            <ul className="space-y-1">{d.memories.slice(0, 10).map((m: any, i: number) => <li key={i} className="text-xs"><span className={m.w < 0 ? 'text-red-400' : 'text-emerald-400'}>{m.y}</span> {m.text}</li>)}</ul>
          </Section>
          <Section title="Recent history">
            <ul className="space-y-1">{d.events.slice(0, 12).map((e: any) => <li key={e.id} className="text-xs"><span className="text-slate-500">{e.year}</span> {e.title}</li>)}</ul>
          </Section>
          <div className="text-[10px] text-slate-500">{d.provinces} provinces · capital {c.capital ? provinceName(c.capital, view?.extra_geo) : '—'} {c.founded ? `· founded ${c.founded}` : ''}</div>
        </>
      )}
    </div>
  )
}
