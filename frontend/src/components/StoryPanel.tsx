import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../api'
import { useGame } from '../store'
import { askJSON, claudeDisabled, errorText, getSample, partialField, UNAVAILABLE } from '../lib/claude'

const SPANS: [string, number | null][] = [['Storyteller decides', null], ['1 month', 1], ['3 months', 3], ['6 months', 6], ['1 year', 12], ['2 years', 24]]

const IDEAS = [
  'Secretly fund a cult that worships our leader as a sun god',
  'Challenge the strongest neighbour\'s leader to a televised duel',
  'Replace the national anthem with a 9-hour opera and make attendance mandatory',
  'Bribe every newspaper in Europe to declare us the most beautiful nation',
  'Build a giant wall and make our rival pay for it',
  'Send diplomats to propose a union of every monarchy on Earth',
  'Launch a meme campaign so powerful it topples a government',
  'Discover oil under the capital and dig it all up',
]

type Live = { text: string; raw: string; headline: string; narrative: string } | null

export default function StoryPanel() {
  const { view, cid, refresh, toast } = useGame()
  const [chapters, setChapters] = useState<any[]>([])
  const [text, setText] = useState('')
  const [span, setSpan] = useState<number | null>(null)
  const [live, setLive] = useState<Live>(null)
  const [claude, setClaude] = useState<'checking' | 'yes' | 'no'>('checking')
  const [err, setErr] = useState('')
  const ctl = useRef<AbortController | null>(null)
  const feed = useRef<HTMLDivElement>(null)
  const load = () => api.stories(cid).then(setChapters).catch(() => {})
  useEffect(() => { load() }, [cid])
  useEffect(() => { getSample().then(s => setClaude(s && !claudeDisabled() ? 'yes' : 'no')) }, [])
  useEffect(() => { feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: 'smooth' }) }, [chapters.length, live?.narrative])

  async function play() {
    const t = text.trim()
    if (!t || live) return
    setErr('')
    setLive({ text: t, raw: '', headline: '', narrative: '' })
    try {
      let r
      if (claude === 'yes') {
        const p = await api.storyPrompt(cid, t)
        ctl.current = new AbortController()
        let result
        try {
          result = await askJSON(p.system, p.prompt, {
            signal: ctl.current.signal,
            onText: raw => setLive({ text: t, raw, headline: partialField(raw, 'headline'), narrative: partialField(raw, 'narrative') }),
          })
        } catch (e: any) {
          if (UNAVAILABLE.has(e?.code)) { setClaude('no'); r = await api.storyAuto(cid, t, span) }
          else throw e
        }
        if (result) {
          setLive(l => l && { ...l, headline: result.headline || l.headline, narrative: result.narrative || l.narrative, raw: '' })
          r = await api.storyApply(cid, t, result, span)
        }
      } else {
        r = await api.storyAuto(cid, t, span)
      }
      setText('')
      if (r?.rejected?.length) console.info('Changes the engine could not apply:', r.rejected)
      await Promise.all([load(), refresh()])
    } catch (e: any) {
      setErr(errorText(e))
      if (e?.code !== 'cancelled') toast(errorText(e), 'error')
    } finally {
      setLive(null)
      ctl.current = null
    }
  }

  const player = view?.player
  return (
    <div className="h-full flex flex-col" data-testid="story-panel">
      <div ref={feed} className="flex-1 overflow-y-auto p-3 space-y-4">
        {chapters.length === 0 && !live && (
          <div className="text-sm text-slate-400 space-y-2">
            <div className="h-title text-lg accent">Write history.</div>
            <p>Type anything you want {player?.name || 'your nation'} to do. Realistic, insane, petty, genius, a joke. The storyteller turns it into the next chapter of the world: how it happens, who reacts, and what it changes on the map.</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {IDEAS.map(i => <button key={i} className="chip hover:bg-ink-600 text-left" onClick={() => setText(i)}>{i}</button>)}
            </div>
          </div>
        )}
        {chapters.map(c => <Chapter key={c.id} c={c} />)}
        {live && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="panel p-3" data-testid="story-live">
            <div className="text-[11px] text-slate-500 italic mb-1">“{live.text}”</div>
            <div className="h-title text-lg accent leading-tight">{live.headline || 'The world holds its breath…'}</div>
            <div className="font-serif text-[15px] leading-relaxed text-slate-200 whitespace-pre-wrap mt-2">
              {live.narrative || <span className="text-slate-500 italic">{claude === 'yes' ? 'The storyteller is writing…' : 'The chronicle is being written…'}</span>}
              <span className="inline-block w-1.5 h-4 bg-[color:var(--accent)] ml-0.5 animate-pulse align-middle" />
            </div>
            {ctl.current && <button className="btn btn-ghost text-xs mt-2" onClick={() => ctl.current?.abort()}>Stop</button>}
          </motion.div>
        )}
      </div>
      <div className="border-t border-ink-700 p-3 shrink-0">
        {err && <div className="text-xs text-red-300 mb-1.5">{err}</div>}
        <textarea data-testid="story-input" className="input w-full h-24 resize-none font-medium" disabled={!!live}
          placeholder={`What does ${player?.leader?.name || 'your government'} do? Write anything…`}
          value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) play() }} />
        <div className="flex items-center gap-2 mt-2">
          <select className="input py-1 text-xs" value={span === null ? '' : String(span)} onChange={e => setSpan(e.target.value === '' ? null : Number(e.target.value))} data-testid="story-span">
            {SPANS.map(([l, v]) => <option key={l} value={v === null ? '' : String(v)}>{l}</option>)}
          </select>
          <span className="text-[10px] text-slate-500 flex-1" title={claude === 'yes' ? 'Claude writes every chapter and plays every nation' : 'Claude is not available here, so the built-in storyteller is used'}>
            {claude === 'checking' ? '…' : claude === 'yes' ? 'Storyteller: Claude' : 'Offline storyteller'}
          </span>
          <button className="btn btn-primary h-title" disabled={!text.trim() || !!live} onClick={play} data-testid="story-play">{live ? 'Writing…' : 'Play turn'}</button>
        </div>
      </div>
    </div>
  )
}

function Chapter({ c }: { c: any }) {
  const [more, setMore] = useState(false)
  const d = c.data || {}
  const paras = String(c.body || '').split(/\n\s*\n/).filter(Boolean)
  return (
    <div className="panel p-3" data-testid="story-chapter">
      <div className="flex justify-between text-[11px] text-slate-500 mb-1">
        <span>{String(c.month).padStart(2, '0')}/{c.year}</span>
      </div>
      {d.orders && <div className="text-[11px] text-slate-400 italic mb-1.5 border-l-2 border-ink-600 pl-2">“{d.orders}”</div>}
      <div className="h-title text-lg accent leading-tight">{c.title}</div>
      <div className="font-serif text-[15px] leading-relaxed text-slate-200 mt-2 space-y-2.5">
        {paras.map((p, i) => <p key={i}>{p}</p>)}
      </div>
      {Array.isArray(d.reactions) && d.reactions.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {d.reactions.slice(0, more ? 12 : 4).map((r: any, i: number) => (
            <div key={i} className="text-[13px] bg-ink-800/70 rounded px-2 py-1.5">
              <span className="font-semibold text-slate-300">{r.leader || r.country}</span>{r.leader && r.country ? <span className="text-slate-500"> · {r.country}</span> : null}
              <div className="italic text-slate-300">“{r.quote}”</div>
            </div>
          ))}
          {d.reactions.length > 4 && !more && <button className="text-[11px] text-slate-500 hover:text-slate-300" onClick={() => setMore(true)}>{d.reactions.length - 4} more reactions</button>}
        </div>
      )}
      {Array.isArray(d.applied) && d.applied.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {d.applied.map((a: string, i: number) => <span key={i} className="chip text-[10px] text-emerald-300">{a}</span>)}
        </div>
      )}
    </div>
  )
}
