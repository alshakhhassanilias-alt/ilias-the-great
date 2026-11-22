import { useEffect, useState } from 'react'
import { api } from '../api'
import { useGame } from '../store'
import { IMPORTANCE_COLORS, KIND_ICONS, MONTHS, yearStr } from '../lib/format'
import { Markdown } from './common'

export default function ChroniclePanel() {
  const { view, cid, toast } = useGame()
  const [mode, setMode] = useState<'events' | 'summaries' | 'write'>('events')
  const [events, setEvents] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [minImp, setMinImp] = useState(2)
  const [mine, setMine] = useState(false)
  const [order, setOrder] = useState<'desc' | 'asc'>('desc')
  const [sums, setSums] = useState<any[]>([])
  const [req, setReq] = useState('')
  const [doc, setDoc] = useState<any>(null)
  const [docs, setDocs] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const p = view?.meta.player
  useEffect(() => {
    if (mode === 'events') api.events(cid, { q, min_importance: minImp, actor: mine ? p : undefined, limit: 300, order }).then(setEvents)
    if (mode === 'summaries') api.summaries(cid).then(setSums)
    if (mode === 'write') api.documents(cid).then(setDocs)
  }, [cid, mode, q, minImp, mine, order, view?.meta.year, view?.meta.month, p])
  useEffect(() => {
    const h = (e: any) => { setMode('write'); setReq(e.detail); write(e.detail) }
    window.addEventListener('history-request', h)
    const pending = (window as any).__historyRequest
    if (pending) { (window as any).__historyRequest = null; setMode('write'); setReq(pending); write(pending) }
    return () => window.removeEventListener('history-request', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  async function write(r: string) {
    if (!r.trim()) return
    setBusy(true)
    try { setDoc(await api.writeHistory(cid, r)) } catch (e) { toast(String(e), 'error') } finally { setBusy(false) }
  }
  const name = view?.player?.name || 'our nation'
  return (
    <div className="p-3 h-full flex flex-col" data-testid="chronicle-panel">
      <div className="flex gap-1 mb-2">
        {(['events', 'summaries', 'write'] as const).map(m => (
          <button key={m} className={`btn text-xs py-1 ${mode === m ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMode(m)}>{m === 'events' ? 'Chronicle' : m === 'summaries' ? 'Ages & decades' : 'Write a history'}</button>
        ))}
      </div>
      {mode === 'events' && (
        <>
          <div className="flex gap-1.5 mb-2 flex-wrap">
            <input className="input flex-1 py-1 text-xs min-w-[120px]" placeholder="Search the historical record…" value={q} onChange={e => setQ(e.target.value)} data-testid="chronicle-search" />
            <select className="input py-1 text-xs" value={minImp} onChange={e => setMinImp(Number(e.target.value))}>
              <option value={1}>All</option><option value={2}>Notable</option><option value={3}>Important</option><option value={4}>Major</option><option value={5}>Epochal</option>
            </select>
            <button className={`btn text-xs py-1 ${mine ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMine(x => !x)}>Ours</button>
            <button className="btn btn-ghost text-xs py-1" onClick={() => setOrder(o => (o === 'desc' ? 'asc' : 'desc'))}>{order === 'desc' ? 'Newest' : 'Oldest'}</button>
          </div>
          <div className="overflow-y-auto flex-1 pr-1">
            {events.map(e => (
              <div key={e.id} className="flex gap-2 py-1.5 border-b border-ink-700/60" data-testid="chronicle-event">
                <div className="w-14 shrink-0 text-[11px] text-slate-500 tabular-nums">{e.month ? MONTHS[e.month - 1] : ''} {yearStr(e.year)}</div>
                <div className="w-4 shrink-0 text-center">{KIND_ICONS[e.kind] || '•'}</div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold" style={{ color: IMPORTANCE_COLORS[e.importance] }}>{e.title}{e.backstory ? <span className="chip ml-1">established history</span> : null}{e.tags.includes('alternate') || e.kind === 'divergence' ? <span className="chip ml-1 text-violet-300">alternate</span> : null}</div>
                  {e.body && e.importance >= 3 && <div className="text-[11px] text-slate-400 leading-snug">{e.body}</div>}
                </div>
              </div>
            ))}
            {events.length === 0 && <div className="text-xs text-slate-500">No matching events.</div>}
          </div>
        </>
      )}
      {mode === 'summaries' && (
        <div className="overflow-y-auto flex-1">
          {sums.length === 0 && <div className="text-xs text-slate-500">Summaries are compiled when decades and centuries end.</div>}
          {[...sums].reverse().map(s => (
            <div key={s.id} className="mb-3">
              <div className={`text-sm font-semibold ${s.level === 'century' ? 'accent h-title' : ''}`}>{s.title}</div>
              <div className="text-xs text-slate-300 leading-relaxed">{s.body}</div>
            </div>
          ))}
        </div>
      )}
      {mode === 'write' && (
        <div className="overflow-y-auto flex-1">
          <div className="text-xs text-slate-400 mb-1">Commission a history, textbook or explanation. Historians use only the campaign's recorded events.</div>
          <textarea className="input w-full h-16 resize-none" value={req} onChange={e => setReq(e.target.value)} placeholder={`Write the history of ${name} from ${view?.meta.start_year} to ${view?.meta.year}`} data-testid="history-input" />
          <div className="flex gap-1 flex-wrap my-1.5">
            {[`Write the history of ${name} from ${view?.meta.start_year} to ${view?.meta.year}`, 'Explain the collapse of the empire', 'Write a textbook about the Mars independence movement', 'Describe how humanity transitioned into digital consciousness'].map(s => (
              <button key={s} className="chip hover:bg-ink-600" onClick={() => setReq(s)}>{s.length > 46 ? s.slice(0, 46) + '…' : s}</button>
            ))}
          </div>
          <button className="btn btn-primary w-full" onClick={() => write(req || `Write the history of ${name}`)} disabled={busy} data-testid="history-write">{busy ? 'The historians are at work…' : 'Commission'}</button>
          {doc && (
            <div className="mt-3 panel p-3 bg-parchment-100 text-ink-900" data-testid="history-doc">
              <div className="font-serif text-xl font-bold mb-1">{doc.title}</div>
              <div className="text-[11px] italic mb-2 opacity-70">{doc.note} {doc.sources} recorded events consulted.</div>
              {doc.body ? <div className="font-serif"><Markdown text={doc.body} /></div> : doc.chapters.map((c: any, i: number) => (
                <div key={i} className="mb-3"><div className="font-serif font-bold">{c.title}</div><p className="font-serif text-sm leading-relaxed">{c.body}</p></div>
              ))}
            </div>
          )}
          {docs.length > 0 && <div className="text-[11px] uppercase tracking-[.18em] text-slate-500 mt-4 mb-1">Archive</div>}
          {docs.map(d => <button key={d.id} className="block text-left text-xs text-slate-300 hover:accent py-0.5" onClick={() => setDoc({ title: d.title, body: d.body, chapters: [], note: `Written in ${d.year}.`, sources: '' })}>{d.title}</button>)}
        </div>
      )}
    </div>
  )
}
