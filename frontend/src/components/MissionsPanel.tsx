import { useState } from 'react'
import { api } from '../api'
import { useGame } from '../store'
import { Bar } from './common'

const CAT_COLORS: Record<string, string> = { crisis: '#ef4444', military: '#f97316', administrative: '#eab308', political: '#a78bfa', diplomatic: '#38bdf8', economic: '#22c55e', scientific: '#2dd4bf', space: '#f472b6', cultural: '#fbbf24' }

export default function MissionsPanel() {
  const { view, cid, refresh, setCommand, setTab } = useGame()
  const [show, setShow] = useState<'active' | 'closed'>('active')
  if (!view) return null
  const ms = view.missions.filter(m => (show === 'active' ? m.status === 'active' : m.status !== 'active')).sort((a, b) => (show === 'active' ? Number(b.tracked) - Number(a.tracked) : (b.closed || 0) - (a.closed || 0)))
  return (
    <div className="p-3 overflow-y-auto h-full" data-testid="missions-panel">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-xs text-slate-400">Chapter: <span className="accent font-semibold">{view.meta.phase_label}</span> (since {view.meta.phase_since})</div>
          {view.hidden_missions > 0 && <div className="text-[11px] text-violet-300">{view.hidden_missions} hidden matter(s) — order an intelligence investigation to uncover them.</div>}
        </div>
        <div className="flex gap-1">
          <button className={`btn text-xs py-0.5 ${show === 'active' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShow('active')}>Active</button>
          <button className={`btn text-xs py-0.5 ${show === 'closed' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShow('closed')}>History</button>
        </div>
      </div>
      {ms.length === 0 && <div className="text-sm text-slate-500">No missions here. Missions emerge from the state of the world as time passes.</div>}
      {ms.map(m => (
        <div key={m.id} className="panel p-3 mb-2.5 bg-ink-850/70" data-testid="mission">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: CAT_COLORS[m.category] || '#94a3b8' }}>{m.category}{m.optional ? '' : ' · mandatory'}{m.source === 'ai' ? ' · AI' : ''}</div>
              <div className="font-semibold text-sm">{m.title}</div>
            </div>
            <div className="text-right text-[11px] text-slate-400 shrink-0">{m.deadline ? `by ${m.deadline}` : 'open-ended'}<br />{m.status !== 'active' && <span className={m.status === 'completed' ? 'text-emerald-400' : m.status === 'failed' ? 'text-red-400' : 'text-slate-500'}>{m.status}</span>}</div>
          </div>
          <p className="text-xs text-slate-300 mt-1 leading-relaxed">{m.desc}</p>
          {m.importance && <p className="text-[11px] text-slate-400 italic mt-1">{m.importance}</p>}
          <ul className="mt-1.5 space-y-0.5">
            {m.objectives.map((o, i) => <li key={i} className="text-xs flex gap-1.5"><span className={o.done ? 'text-emerald-400' : 'text-slate-500'}>{o.done ? '✔' : '○'}</span><span>{i > 0 && m.mode === 'any' ? 'or: ' : ''}{o.text}</span></li>)}
          </ul>
          {m.status === 'active' && <div className="mt-1.5"><Bar value={m.progress * 100} /></div>}
          <div className="flex justify-between items-center mt-1.5">
            <div className="text-[11px] text-emerald-300/80">{m.reward_text && `Reward: ${m.reward_text}`}{m.failure_text && <span className="text-red-300/80"> · Failure: {m.failure_text}</span>}</div>
            {m.status === 'active' && (
              <div className="flex gap-1">
                <button className="btn btn-ghost text-[11px] py-0.5" onClick={() => { (window as any).__advisorQ = `How should we accomplish the mission "${m.title}"?`; setTab('advisor') }}>Ask advisor</button>
                {m.optional && <button className="btn btn-ghost text-[11px] py-0.5" onClick={async () => { await api.mission(cid, m.id, 'dismiss'); refresh() }}>Ignore</button>}
              </div>
            )}
          </div>
          {m.note && <div className="text-[11px] text-slate-500 mt-1">{m.note}</div>}
        </div>
      ))}
      {show === 'active' && view.threads.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-[.18em] text-slate-500 mb-1.5">Storylines in motion</div>
          {view.threads.slice(0, 12).map(t => (
            <div key={t.id} className="mb-2 text-xs">
              <div className="flex justify-between"><span className="font-semibold">{t.title}</span><span className="text-slate-500">since {t.started}</span></div>
              <div className="text-slate-400">{t.summary}</div>
              <Bar value={t.tension} color={t.tension > 65 ? '#ef4444' : t.tension > 40 ? '#f59e0b' : '#64748b'} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
