import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { api } from '../api'
import { useGame } from '../store'
import { KIND_ICONS, MONTHS, yearStr } from '../lib/format'

export function EventPopup() {
  const { popups, dismissPopup, view } = useGame()
  const e = popups[0]
  return (
    <AnimatePresence>
      {e && (
        <motion.div key={e.id} className="fixed inset-0 z-50 grid place-items-center bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={dismissPopup}>
          <motion.div className="panel w-[min(560px,92vw)] p-6 bg-ink-900" initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} onClick={ev => ev.stopPropagation()} data-testid="event-popup">
            <div className="text-[11px] uppercase tracking-[.2em] text-slate-400">{MONTHS[(e.month || 1) - 1]} {yearStr(e.year)} · {e.kind.replace('_', ' ')}</div>
            <div className="h-title text-2xl accent mt-1 mb-3 flex gap-2"><span>{KIND_ICONS[e.kind] || '★'}</span><span>{e.title}</span></div>
            <p className="text-sm leading-relaxed text-slate-200">{e.body}</p>
            {e.actors.length > 0 && <div className="text-xs text-slate-500 mt-3">{e.actors.map(a => view?.countries[a]?.name || a).join(' · ')}</div>}
            <div className="flex justify-between items-center mt-5">
              <span className="text-xs text-slate-500">{popups.length > 1 ? `${popups.length - 1} more` : ''}</span>
              <button className="btn btn-primary" onClick={dismissPopup} data-testid="popup-ok">Continue</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function DecisionModal() {
  const { view, cid, refresh, toast, popups } = useGame()
  const [busy, setBusy] = useState(false)
  const d = view?.decisions?.[0]
  if (!d || popups.length) return null
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/55">
      <motion.div className="panel w-[min(620px,94vw)] p-6 bg-ink-900 border-2 accent-border" initial={{ scale: 0.95 }} animate={{ scale: 1 }} data-testid="decision-modal">
        <div className="text-[11px] uppercase tracking-[.2em] text-slate-400">Decision required · {MONTHS[d.month - 1]} {d.year}</div>
        <div className="h-title text-2xl accent mt-1 mb-2">{d.title}</div>
        <p className="text-sm text-slate-200 leading-relaxed mb-4">{d.body}</p>
        <div className="space-y-2">
          {d.options.map(o => (
            <button key={o.id} disabled={busy} className="w-full text-left panel px-4 py-3 bg-ink-850 hover:bg-ink-700 transition-colors" data-testid={`option-${o.id}`}
              onClick={async () => { setBusy(true); try { const r = await api.decide(cid, d.id, o.id); toast(r.message || o.label, 'success'); await refresh() } finally { setBusy(false) } }}>
              <div className="font-semibold text-sm">{o.label}</div>
              {o.desc && <div className="text-xs text-slate-400">{o.desc}</div>}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-slate-500 mt-3">If no choice is made by {Math.floor(d.deadline)}, events will decide for you.{view!.decisions.length > 1 ? ` ${view!.decisions.length - 1} further decision(s) pending.` : ''}</div>
      </motion.div>
    </div>
  )
}

export function Toasts() {
  const { toasts } = useGame()
  return (
    <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center pointer-events-none">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className={`panel px-4 py-2 text-sm max-w-xl ${t.kind === 'error' ? 'border-red-500 text-red-200' : t.kind === 'success' ? 'text-emerald-200' : ''}`}>{t.text}</motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function BusyOverlay() {
  const { busy } = useGame()
  return (
    <AnimatePresence>
      {busy && (
        <motion.div className="fixed inset-0 z-[60] grid place-items-center bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-testid="busy">
          <div className="panel px-6 py-4 flex items-center gap-3">
            <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
            <span className="h-title">{busy}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Ticker() {
  const { view, setTab } = useGame()
  const evs = (view?.recent_events || []).filter(e => e.importance >= 2 && !e.backstory).slice(0, 14)
  return (
    <div className="h-9 border-t border-ink-700 bg-ink-900/95 flex items-center gap-4 px-3 overflow-hidden text-xs whitespace-nowrap" data-testid="ticker">
      <button className="accent font-semibold shrink-0" onClick={() => setTab('chronicle')}>CHRONICLE ›</button>
      <div className="flex gap-6 overflow-hidden">
        {evs.map(e => <span key={e.id} className={e.importance >= 4 ? 'text-amber-200' : 'text-slate-400'}><span className="text-slate-500">{e.year}</span> {KIND_ICONS[e.kind] || '•'} {e.title}</span>)}
      </div>
    </div>
  )
}
