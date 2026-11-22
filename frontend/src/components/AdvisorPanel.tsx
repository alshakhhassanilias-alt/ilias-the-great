import { useEffect, useState } from 'react'
import { api } from '../api'
import { useGame } from '../store'
import { Markdown } from './common'

export default function AdvisorPanel() {
  const { view, cid, setCommand, setTab } = useGame()
  const [rep, setRep] = useState<any>(null)
  const [q, setQ] = useState('')
  const [qa, setQa] = useState<{ q: string; a: string }[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.advisor(cid).then(setRep) }, [cid, view?.meta.year, view?.meta.month])
  useEffect(() => {
    const pending = (window as any).__advisorQ
    if (pending) { (window as any).__advisorQ = null; ask(pending) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  async function ask(question: string) {
    if (!question.trim()) return
    setBusy(true)
    try {
      const r = await api.ask(cid, question)
      setQa(x => [{ q: question, a: r.answer }, ...x])
      setQ('')
    } finally { setBusy(false) }
  }
  if (!rep) return <div className="p-3 text-sm text-slate-400">Your strategist is preparing a report…</div>
  const use = (o: string) => { setCommand(o); setTab('command') }
  return (
    <div className="p-3 overflow-y-auto h-full" data-testid="advisor-panel">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-9 h-9 rounded-full accent-bg grid place-items-center h-title accent">{rep.advisor.name[0]}</div>
        <div><div className="font-semibold text-sm">{rep.advisor.name}</div><div className="text-[11px] text-slate-400">{rep.advisor.title}</div></div>
      </div>
      <p className="text-sm text-slate-300 mb-3">{rep.summary}</p>
      {rep.warnings.length > 0 && <div className="text-[11px] uppercase tracking-[.18em] text-red-400 mb-1">Warnings</div>}
      {rep.warnings.map((w: any, i: number) => (
        <div key={i} className="mb-2 border-l-2 pl-2" style={{ borderColor: w.severity >= 3 ? '#ef4444' : '#f59e0b' }}>
          <div className="text-sm font-semibold">{w.title}</div>
          <div className="text-xs text-slate-400">{w.text}</div>
          {w.order && <button className="text-[11px] accent hover:underline" onClick={() => use(w.order)}>→ “{w.order}”</button>}
        </div>
      ))}
      {rep.opportunities.length > 0 && <div className="text-[11px] uppercase tracking-[.18em] text-emerald-400 mb-1 mt-3">Opportunities</div>}
      {rep.opportunities.map((o: any, i: number) => (
        <div key={i} className="mb-2 border-l-2 border-emerald-500 pl-2">
          <div className="text-sm font-semibold">{o.title}</div>
          <div className="text-xs text-slate-400">{o.text}</div>
          {o.order && <button className="text-[11px] accent hover:underline" onClick={() => use(o.order)}>→ “{o.order}”</button>}
        </div>
      ))}
      <div className="mt-4">
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="Ask your strategist anything…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask(q)} data-testid="advisor-input" />
          <button className="btn btn-primary" onClick={() => ask(q)} disabled={busy}>{busy ? '…' : 'Ask'}</button>
        </div>
        {qa.map((x, i) => (
          <div key={i} className="mt-3">
            <div className="text-xs text-slate-400">You: {x.q}</div>
            <div className="text-sm mt-1 panel p-2 bg-ink-850"><Markdown text={x.a} /></div>
          </div>
        ))}
      </div>
    </div>
  )
}
