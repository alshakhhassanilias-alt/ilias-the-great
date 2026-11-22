import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useGame } from '../store'
import { Flag } from './common'

export default function DiplomacyPanel() {
  const { view, cid, selected, setSelected, refresh, toast } = useGame()
  const [filter, setFilter] = useState('')
  const [msgs, setMsgs] = useState<any[]>([])
  const [text, setText] = useState('')
  const [secret, setSecret] = useState(false)
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const p = view?.meta.player
  const target = selected && selected !== p ? selected : null
  useEffect(() => { if (target) api.conversation(cid, target).then(setMsgs); else setMsgs([]) }, [cid, target])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])
  if (!view) return null
  const list = Object.values(view.countries).filter(c => c.alive && c.tag !== p && c.name.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => b.power - a.power).slice(0, 60)
  async function send() {
    if (!target || !text.trim()) return
    setBusy(true)
    const t = text
    setMsgs(m => [...m, { role: 'player', text: t, secret }])
    setText('')
    try {
      const r = await api.talk(cid, target, t, secret)
      setMsgs(m => [...m, { role: 'leader', text: r.reply, data: { outcome: r.outcome, leader: r.leader } }])
      if (r.outcome?.effects?.length) toast(r.outcome.effects.join('; '), 'success')
      refresh()
    } catch (e) { toast(String(e), 'error') } finally { setBusy(false) }
  }
  if (!target) {
    return (
      <div className="p-3 h-full flex flex-col" data-testid="diplomacy-panel">
        <div className="text-xs text-slate-400 mb-2">Select a state on the map or below to open direct talks with its leader. Leaders remember treaties, betrayals and threats.</div>
        <input className="input mb-2" placeholder="Search states…" value={filter} onChange={e => setFilter(e.target.value)} />
        <div className="overflow-y-auto flex-1">
          {list.map(c => {
            const rel = view.relations?.[c.tag]
            return (
              <button key={c.tag} className="w-full flex items-center gap-2 p-1.5 rounded hover:bg-ink-700 text-left" onClick={() => setSelected(c.tag)} data-testid={`dip-${c.tag}`}>
                <Flag tag={c.tag} color={c.color} size={14} />
                <span className="text-sm flex-1 truncate">{c.name}</span>
                {rel && <span className={`text-xs tabular-nums ${rel[0] < -20 ? 'text-red-400' : rel[0] > 20 ? 'text-emerald-400' : 'text-slate-400'}`}>{rel[0] > 0 ? '+' : ''}{Math.round(rel[0])}</span>}
              </button>
            )
          })}
        </div>
      </div>
    )
  }
  const c = view.countries[target]
  return (
    <div className="p-3 h-full flex flex-col" data-testid="diplomacy-panel">
      <div className="flex items-center gap-2 mb-2">
        <button className="text-xs text-slate-400 hover:text-white" onClick={() => setSelected(null)}>←</button>
        <Flag tag={c.tag} color={c.color} size={20} />
        <div>
          <div className="font-semibold text-sm">{c.leader.name}</div>
          <div className="text-[11px] text-slate-400">{c.leader.title} of {c.name} · opinion of us {Math.round(view.relations?.[target]?.[0] ?? 0)} · trust {Math.round(view.relations?.[target]?.[1] ?? 50)}</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {msgs.length === 0 && <div className="text-xs text-slate-500">No previous correspondence. Try proposing an alliance, a trade agreement, a non-aggression pact, peace, a joint war against a common enemy - or simply ask about their intentions.</div>}
        {msgs.map((m, i) => (
          <div key={i} className={`max-w-[88%] rounded-lg px-3 py-2 text-sm ${m.role === 'player' ? 'ml-auto bg-ink-700' : 'bg-ink-850 border border-ink-600'}`}>
            {m.secret && <div className="text-[10px] text-violet-300 uppercase">secret channel</div>}
            <div className="whitespace-pre-wrap">{m.text}</div>
            {m.data?.outcome?.effects?.length > 0 && <div className="text-[11px] accent mt-1">⟶ {m.data.outcome.effects.join('; ')}</div>}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="mt-2">
        <textarea className="input w-full h-16 resize-none" placeholder={`Message to ${c.leader.name}…`} value={text} onChange={e => setText(e.target.value)} data-testid="dip-input"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
        <div className="flex justify-between items-center mt-1">
          <label className="text-xs text-slate-400 flex items-center gap-1"><input type="checkbox" checked={secret} onChange={e => setSecret(e.target.checked)} /> Secret backchannel</label>
          <button className="btn btn-primary text-xs" onClick={send} disabled={busy || !text.trim()} data-testid="dip-send">{busy ? '…' : 'Send envoy'}</button>
        </div>
      </div>
    </div>
  )
}
