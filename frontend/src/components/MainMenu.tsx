import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../api'
import type { Scenario, ScenarioCountry } from '../types'
import { pct, pop } from '../lib/format'
import { Flag } from './common'
import AISettings from './AISettings'
import { STANDALONE } from '../engine'

export default function MainMenu({ onOpen }: { onOpen: (id: string) => void }) {
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [sc, setSc] = useState<Scenario | null>(null)
  const [year, setYear] = useState(1200)
  const [countries, setCountries] = useState<ScenarioCountry[] | null>(null)
  const [country, setCountry] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [name, setName] = useState('')
  const [divergence, setDivergence] = useState('')
  const [pause, setPause] = useState(true)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')
  const [ai, setAi] = useState(false)
  const [armed, setArmed] = useState<string | null>(null)
  const [health, setHealth] = useState<any>(null)
  useEffect(() => {
    document.body.className = 'era-classic'
    api.campaigns().then(setCampaigns).catch(e => setErr(String(e)))
    api.scenarios().then(setScenarios)
    api.health().then(setHealth).catch(() => {})
  }, [])
  useEffect(() => {
    if (!sc) return
    setCountries(null); setCountry(null)
    api.scenarioCountries(sc.id, sc.kind === 'fictional' ? year : undefined).then(setCountries)
  }, [sc, sc?.kind === 'fictional' ? year : 0])
  async function create() {
    if (!sc) return
    setCreating(true); setErr('')
    try {
      const r = await api.create({ scenario: sc.id, country, name: name || undefined, year: sc.kind === 'fictional' ? year : undefined, divergence, settings: { pause_on_decision: pause }, seed: sc.kind === 'fictional' ? 1 : undefined })
      onOpen(r.id)
    } catch (e) { setErr(String(e)) } finally { setCreating(false) }
  }
  async function importFile(f: File) {
    try { const data = JSON.parse(await f.text()); const r = await api.import(data); onOpen(r.id) } catch (e) { setErr(`Import failed: ${e}`) }
  }
  const list = (countries || []).filter(c => c.name.toLowerCase().includes(filter.toLowerCase()))
  return (
    <div className="h-full overflow-y-auto" style={{ background: 'radial-gradient(ellipse at 30% 0%, #1b2436 0%, #07090d 60%)' }}>
      <div className="max-w-6xl mx-auto px-6 py-10">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
          <div className="h-title text-5xl md:text-6xl accent tracking-[.2em]">INFINITE HISTORY</div>
          <div className="text-slate-400 mt-3 font-serif italic text-lg">Every empire has a history. Yours has not been written yet.</div>
          <div className="mt-3 flex justify-center gap-2 text-xs">
            <span className="chip">AI: {health?.ai || '…'}{health?.ai !== 'offline' && health?.model ? ` · ${health.model}` : ''}</span>
            {!STANDALONE && <button className="chip hover:bg-ink-600" onClick={() => setAi(true)} data-testid="ai-settings">AI settings</button>}
          </div>
        </motion.div>
        {err && <div className="panel p-3 mb-4 text-red-300 text-sm">{err}</div>}
        <div className="grid lg:grid-cols-[1fr_1.4fr] gap-6">
          <div>
            <div className="h-title text-xl mb-3">Continue a campaign</div>
            {campaigns.length === 0 && <div className="text-sm text-slate-500 mb-4">No campaigns yet.</div>}
            <div className="space-y-2 mb-4" data-testid="campaign-list">
              {campaigns.map(c => (
                <div key={c.id} className="panel p-3 flex items-center gap-3 hover:bg-ink-800 cursor-pointer" onClick={() => onOpen(c.id)}>
                  <div className="w-2 self-stretch rounded" style={{ background: c.info?.color || '#666' }} />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{c.name}</div>
                    <div className="text-xs text-slate-400 truncate">{c.info?.country} · {c.year} · {c.info?.era} · {c.info?.phase}</div>
                    <div className="text-[11px] text-slate-500">{c.info?.scenario_name} (from {c.info?.start_year}) · saved {new Date(c.updated * 1000).toLocaleString()}</div>
                  </div>
                  <button className={`text-xs px-2 ${armed === c.id ? 'text-red-400 font-semibold' : 'text-slate-500 hover:text-red-400'}`} onClick={async e => { e.stopPropagation(); if (armed !== c.id) { setArmed(c.id); return } setArmed(null); await api.remove(c.id); setCampaigns(await api.campaigns()) }}>{armed === c.id ? 'Click again to delete' : 'Delete'}</button>
                </div>
              ))}
            </div>
            <label className="btn btn-ghost text-sm cursor-pointer inline-block">Import campaign file<input type="file" accept=".json" className="hidden" onChange={e => e.target.files?.[0] && importFile(e.target.files[0])} data-testid="import-input" /></label>
          </div>
          <div>
            <div className="h-title text-xl mb-3">Begin a new history</div>
            <div className="grid sm:grid-cols-2 gap-3 mb-4">
              {scenarios.map(s => (
                <button key={s.id} data-testid={`scenario-${s.id}`} onClick={() => setSc(s)} className={`panel p-4 text-left transition-all ${sc?.id === s.id ? 'accent-border border-2' : 'hover:bg-ink-800'}`}>
                  <div className="text-3xl h-title accent">{s.year ?? '∞'}</div>
                  <div className="font-semibold">{s.name}</div>
                  <div className="text-xs text-slate-400 mt-1">{s.desc}</div>
                </button>
              ))}
            </div>
            {sc && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="panel p-4">
                {sc.kind === 'fictional' && (
                  <div className="mb-3">
                    <label className="text-xs text-slate-400">Starting year (negative for BCE)</label>
                    <div className="flex gap-2 items-center mt-1">
                      <input type="number" className="input w-32" value={year} onChange={e => setYear(Number(e.target.value))} data-testid="fictional-year" />
                      {[-500, 800, 1500, 1850, 2200, 2600].map(y => <button key={y} className="chip hover:bg-ink-600" onClick={() => setYear(y)}>{y < 0 ? `${-y} BCE` : y}</button>)}
                    </div>
                  </div>
                )}
                <div className="flex justify-between items-center mb-2">
                  <div className="text-sm font-semibold">Choose your nation</div>
                  <input className="input py-1 text-xs w-44" placeholder="Search…" value={filter} onChange={e => setFilter(e.target.value)} data-testid="country-search" />
                </div>
                <div className="max-h-72 overflow-y-auto grid sm:grid-cols-2 gap-1 mb-3" data-testid="country-list">
                  {!countries && <div className="text-xs text-slate-500">Generating the world…</div>}
                  {list.map(c => (
                    <button key={c.tag} data-testid={`pick-${c.tag}`} onClick={() => setCountry(c.tag)} className={`flex items-center gap-2 p-1.5 rounded text-left ${country === c.tag ? 'accent-bg ring-1 ring-[color:var(--accent)]' : 'hover:bg-ink-800'}`}>
                      <Flag tag={c.tag} color={c.color} size={16} />
                      <div className="min-w-0">
                        <div className="text-sm truncate">{c.name}</div>
                        <div className="text-[10px] text-slate-500 truncate">{c.leader} · {pct(c.gdp_share, 1)} of world GDP · {pop(c.pop)}{c.subject_of ? ' · subject' : ''}</div>
                      </div>
                    </button>
                  ))}
                </div>
                <input className="input w-full mb-2" placeholder="Campaign name (optional)" value={name} onChange={e => setName(e.target.value)} />
                <textarea className="input w-full h-20 resize-none mb-2" placeholder={'Optional point of divergence, e.g. "Italy is allied with France. Spain is a monarchy."'} value={divergence} onChange={e => setDivergence(e.target.value)} data-testid="divergence" />
                <label className="text-xs text-slate-400 flex items-center gap-2 mb-3"><input type="checkbox" checked={pause} onChange={e => setPause(e.target.checked)} /> Pause time when a decision is required</label>
                <button className="btn btn-primary w-full py-2.5 text-base h-title" disabled={!country || creating} onClick={create} data-testid="start-campaign">{creating ? 'Writing the prologue…' : 'Enter history'}</button>
              </motion.div>
            )}
          </div>
        </div>
      </div>
      {ai && <AISettings onClose={() => { setAi(false); api.health().then(setHealth) }} />}
    </div>
  )
}
