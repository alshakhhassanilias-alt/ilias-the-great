import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../api'
import { useGame } from '../store'
import type { Plan } from '../types'
import { money } from '../lib/format'

const EXAMPLES: [number, string][] = [
  [0, 'Transform our nation into the world\'s largest industrial economy'],
  [0, 'Invest 10% of national GDP into scientific research'],
  [0, 'Propose an alliance with Italy'],
  [0, 'Create a new political ideology called the Concord of Reason, based on science, unity and liberty'],
  [0, 'Establish a federation between all European countries'],
  [0, 'Establish a thousand-year imperial dynasty'],
  [2000, 'Begin the colonization of Mars'],
  [2000, 'Introduce a law granting artificial consciousness equal citizenship'],
  [2050, 'Transfer all human consciousness into digital infrastructure'],
  [0, 'Deliberately dismantle my empire and allow successor states to emerge'],
  [0, 'Attempt to peacefully reunify the former empire'],
  [0, 'Write the history of our nation'],
]

const FEAS_COLORS: Record<string, string> = { feasible: 'text-emerald-400', likely: 'text-emerald-400', costly: 'text-amber-300', risky: 'text-amber-400', unlikely: 'text-orange-400', 'long-term': 'text-sky-300', symbolic: 'text-violet-300', impossible: 'text-red-400' }

export default function CommandPanel() {
  const { view, cid, command, setCommand, refresh, toast, setTab } = useGame()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<{ text: string; summary: string; ok: boolean }[]>([])
  useEffect(() => { if (command) setPlan(null) }, [command])
  async function interpret() {
    if (!command.trim()) return
    if (/^(write|compose).*(history|textbook|chronicle)|^explain\b|^describe how/i.test(command.trim())) {
      setTab('chronicle')
      ;(window as any).__historyRequest = command
      window.dispatchEvent(new CustomEvent('history-request', { detail: command }))
      return
    }
    setBusy(true)
    try { setPlan(await api.interpret(cid, command)) } catch (e) { toast(String(e), 'error') } finally { setBusy(false) }
  }
  async function execute() {
    if (!plan) return
    setBusy(true)
    try {
      const acts = plan.actions.filter(a => a.assessment.ok || a.assessment.alternative).map(({ assessment, summary, ...rest }) => rest)
      const r = await api.execute(cid, plan.text, acts)
      setLog(l => [{ text: plan.text, summary: r.summary || 'No action taken.', ok: r.ok }, ...l].slice(0, 30))
      toast(r.ok ? 'Orders issued' : 'Orders could not be carried out', r.ok ? 'success' : 'error')
      setPlan(null)
      setCommand('')
      await refresh()
    } catch (e) { toast(String(e), 'error') } finally { setBusy(false) }
  }
  const year = view?.meta.year || 1936
  return (
    <div className="p-3 flex flex-col h-full" data-testid="command-panel">
      <div className="text-xs text-slate-400 mb-1.5">Issue orders in plain language. The government will interpret them, assess feasibility and cost, then await your confirmation.</div>
      <textarea data-testid="command-input" className="input w-full h-24 resize-none font-medium" placeholder="e.g. Invest 30% of national GDP into scientific research"
        value={command} onChange={e => setCommand(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) interpret() }} />
      <div className="flex gap-2 mt-2">
        <button className="btn btn-primary flex-1" disabled={busy || !command.trim()} onClick={interpret} data-testid="interpret">{busy && !plan ? 'Interpreting…' : 'Interpret order'}</button>
      </div>
      <AnimatePresence>
        {plan && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="panel p-3 mt-3 bg-ink-850" data-testid="plan">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Proposed plan · {plan.interpreter === 'ai' ? 'AI interpreter' : 'offline interpreter'}</div>
            {plan.clarify && <div className="text-sm text-amber-300 mb-2">{plan.clarify}</div>}
            {plan.actions.map((a, i) => (
              <div key={i} className="mb-2 border-l-2 pl-2" style={{ borderColor: a.assessment.ok ? 'var(--accent)' : '#ef4444' }}>
                <div className="text-sm font-semibold">{a.summary}</div>
                <div className={`text-[11px] uppercase tracking-wide ${FEAS_COLORS[a.assessment.feasibility] || 'text-slate-400'}`}>{a.assessment.feasibility}{a.assessment.cost ? ` · ${money(a.assessment.cost)}` : ''}{a.assessment.years ? ` · ~${a.assessment.years} yrs` : ''}</div>
                {a.assessment.explanation && <div className="text-xs text-slate-300 mt-0.5">{a.assessment.explanation}</div>}
                {a.assessment.consequences?.map((c, j) => <div key={j} className="text-xs text-slate-400">• {c}</div>)}
                {!a.assessment.ok && a.assessment.alternative && <div className="text-xs text-sky-300 mt-0.5">Instead: {a.assessment.alternative.type.replace('_', ' ')} {a.assessment.alternative.tech || ''}</div>}
              </div>
            ))}
            {plan.notes.map((n, i) => <div key={i} className="text-xs text-slate-400 italic">{n}</div>)}
            <div className="flex gap-2 mt-2">
              <button className="btn btn-primary flex-1" onClick={execute} disabled={busy || !plan.actions.some(a => a.assessment.ok || a.assessment.alternative)} data-testid="execute">Confirm & execute</button>
              <button className="btn btn-ghost" onClick={() => setPlan(null)}>Cancel</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {!plan && (
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-[.18em] text-slate-500 mb-1.5">Ideas</div>
          <div className="flex flex-col gap-1">
            {EXAMPLES.filter(([y]) => year >= y).slice(0, 9).map(([, e]) => (
              <button key={e} className="text-left text-xs text-slate-300 hover:accent px-2 py-1 rounded hover:bg-ink-800" onClick={() => setCommand(e)}>“{e}”</button>
            ))}
          </div>
        </div>
      )}
      {log.length > 0 && (
        <div className="mt-4 overflow-y-auto">
          <div className="text-[11px] uppercase tracking-[.18em] text-slate-500 mb-1.5">Orders issued</div>
          {log.map((l, i) => (
            <div key={i} className="mb-2 text-xs"><div className="text-slate-200">“{l.text}”</div><div className={l.ok ? 'text-slate-400' : 'text-red-400'}>{l.summary}</div></div>
          ))}
        </div>
      )}
    </div>
  )
}
