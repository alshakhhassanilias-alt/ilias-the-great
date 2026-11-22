import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { useGame } from '../store'
import { Flag } from './common'
import { askJSON, claudeDisabled, errorText, getSample, UNAVAILABLE } from '../lib/claude'

export default function ChatsPanel() {
  const { cid } = useGame()
  const [list, setList] = useState<any[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const reload = () => api.chats(cid).then(setList).catch(() => {})
  useEffect(() => { reload() }, [cid])
  if (open) return <ChatRoom gid={open} onBack={() => { setOpen(null); reload() }} />
  if (creating) return <NewChat onCancel={() => setCreating(false)} onCreated={id => { setCreating(false); reload(); setOpen(id) }} />
  return (
    <div className="p-3 h-full flex flex-col" data-testid="chats-panel">
      <div className="text-xs text-slate-400 mb-2">Open a group chat with any world leaders. Negotiate, scheme, threaten, flatter or just troll them. Every leader answers in character, and real deals agreed here change the world.</div>
      <button className="btn btn-primary mb-3" onClick={() => setCreating(true)} data-testid="new-chat">New group chat</button>
      <div className="overflow-y-auto flex-1 space-y-1.5">
        {list.length === 0 && <div className="text-xs text-slate-500">No chats yet.</div>}
        {list.map(c => (
          <button key={c.id} className="panel p-2.5 w-full text-left hover:bg-ink-800" onClick={() => setOpen(c.id)} data-testid="chat-item">
            <div className="font-semibold text-sm truncate">{c.name}</div>
            <div className="text-[11px] text-slate-500">{c.members.length} leader{c.members.length === 1 ? '' : 's'} · since {c.created?.[0]}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function NewChat({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const { view, cid, toast } = useGame()
  const [name, setName] = useState('')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string[]>([])
  const nations = useMemo(() => Object.values(view?.countries || {}).filter(c => c.alive && c.tag !== view?.meta.player).sort((a, b) => b.power - a.power), [view])
  const shown = nations.filter(c => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.leader?.name?.toLowerCase().includes(q.toLowerCase())).slice(0, 80)
  const toggle = (t: string) => setSel(s => s.includes(t) ? s.filter(x => x !== t) : s.length >= 12 ? s : [...s, t])
  async function create() {
    try { const c = await api.createChat(cid, name, sel); if (c.error) throw new Error(c.error); onCreated(c.id) } catch (e) { toast(String(e), 'error') }
  }
  return (
    <div className="p-3 h-full flex flex-col" data-testid="new-chat-panel">
      <input className="input mb-2" placeholder="Chat name (optional), e.g. The Axis of Chaos" value={name} onChange={e => setName(e.target.value)} data-testid="chat-name" />
      <div className="flex flex-wrap gap-1 mb-2 min-h-[1.5rem]">
        {sel.map(t => <button key={t} className="chip hover:bg-ink-600" onClick={() => toggle(t)}>{view?.countries[t]?.name} ×</button>)}
        {!sel.length && <span className="text-[11px] text-slate-500">Pick up to 12 nations.</span>}
      </div>
      <input className="input py-1 text-xs mb-2" placeholder="Search nations or leaders…" value={q} onChange={e => setQ(e.target.value)} data-testid="chat-search" />
      <div className="flex-1 overflow-y-auto space-y-0.5">
        {shown.map(c => (
          <button key={c.tag} className={`w-full flex items-center gap-2 p-1.5 rounded text-left ${sel.includes(c.tag) ? 'accent-bg' : 'hover:bg-ink-800'}`} onClick={() => toggle(c.tag)} data-testid={`chat-pick-${c.tag}`}>
            <Flag tag={c.tag} color={c.color} size={16} />
            <div className="min-w-0"><div className="text-sm truncate">{c.name}</div><div className="text-[10px] text-slate-500 truncate">{c.leader?.title} {c.leader?.name}</div></div>
          </button>
        ))}
      </div>
      <div className="flex gap-2 mt-2">
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary flex-1" disabled={!sel.length} onClick={create} data-testid="create-chat">Open chat</button>
      </div>
    </div>
  )
}

function ChatRoom({ gid, onBack }: { gid: string; onBack: () => void }) {
  const { view, cid, refresh, toast } = useGame()
  const [chat, setChat] = useState<any>(null)
  const [text, setText] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<number, string[]>>({})
  const [armed, setArmed] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const load = () => api.chat(cid, gid).then(setChat).catch(e => toast(String(e), 'error'))
  useEffect(() => { load() }, [gid])
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' }) }, [chat?.messages?.length, pending])
  const colors: Record<string, string> = useMemo(() => Object.fromEntries((chat?.member_info || []).map((m: any) => [m.tag, m.color])), [chat])

  async function send() {
    const t = text.trim()
    if (!t || pending) return
    setPending(t)
    setText('')
    try {
      let r
      const s = claudeDisabled() ? null : await getSample()
      if (s) {
        const p = await api.chatPrompt(cid, gid, t)
        try {
          const result = await askJSON(p.system, p.prompt)
          r = await api.chatApply(cid, gid, t, result)
        } catch (e: any) {
          if (UNAVAILABLE.has(e?.code)) r = await api.chatAuto(cid, gid, t)
          else throw e
        }
      } else {
        r = await api.chatAuto(cid, gid, t)
      }
      const next = await api.chat(cid, gid)
      if (r?.applied?.length) { setNotes(n => ({ ...n, [next.messages.length]: r.applied })); refresh() }
      setChat(next)
    } catch (e: any) {
      setText(t)
      toast(errorText(e), 'error')
    } finally { setPending(null) }
  }

  if (!chat) return <div className="p-3 text-sm text-slate-500">Opening channel…</div>
  const me = view?.player
  return (
    <div className="h-full flex flex-col" data-testid="chat-room">
      <div className="p-2.5 border-b border-ink-700 flex items-center gap-2 shrink-0">
        <button className="btn btn-ghost text-xs py-0.5" onClick={onBack}>←</button>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm truncate">{chat.name}</div>
          <div className="text-[10px] text-slate-500 truncate">{chat.member_info.map((m: any) => `${m.leader} (${m.name})`).join(', ')}</div>
        </div>
        <button className={`text-[11px] ${armed ? 'text-red-400' : 'text-slate-500 hover:text-red-400'}`} onClick={async () => { if (!armed) { setArmed(true); return } await api.deleteChat(cid, gid); onBack() }}>{armed ? 'Click to leave' : 'Leave'}</button>
      </div>
      <div ref={box} className="flex-1 overflow-y-auto p-3 space-y-2">
        {chat.messages.length === 0 && !pending && <div className="text-xs text-slate-500">Say something. They are all listening.</div>}
        {chat.messages.map((m: any, i: number) => {
          const mine = m.role === 'player'
          return (
            <div key={i}>
              <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 ${mine ? 'accent-bg' : 'bg-ink-800'}`} style={!mine ? { borderLeft: `3px solid ${colors[m.tag] || '#666'}` } : undefined}>
                  {!mine && <div className="text-[11px] font-semibold" style={{ color: colors[m.tag] || '#cbd5e1' }}>{m.leader || m.speaker}<span className="text-slate-500 font-normal"> · {m.country}</span></div>}
                  <div className="text-sm whitespace-pre-wrap">{m.text}</div>
                </div>
              </div>
              {notes[i + 1] && <div className="text-center my-1.5">{notes[i + 1].map((n, j) => <span key={j} className="chip text-[10px] text-emerald-300 mx-0.5">{n}</span>)}</div>}
            </div>
          )
        })}
        {pending && (
          <>
            <div className="flex justify-end"><div className="max-w-[85%] rounded-lg px-2.5 py-1.5 accent-bg text-sm whitespace-pre-wrap">{pending}</div></div>
            <div className="text-xs text-slate-500 italic">{chat.member_info.slice(0, 3).map((m: any) => m.leader).join(', ')} {chat.member_info.length > 1 ? 'are' : 'is'} typing…</div>
          </>
        )}
      </div>
      <div className="border-t border-ink-700 p-2.5 flex gap-2 shrink-0">
        <textarea className="input flex-1 h-14 resize-none text-sm" placeholder={`Message as ${me?.leader?.name || 'yourself'}…`} value={text} disabled={!!pending}
          onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} data-testid="chat-input" />
        <button className="btn btn-primary" disabled={!text.trim() || !!pending} onClick={send} data-testid="chat-send">Send</button>
      </div>
    </div>
  )
}
