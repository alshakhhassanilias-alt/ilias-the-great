import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../api'
import { useGame } from '../store'
import { Markdown } from './common'

export default function BriefingModal({ onClose }: { onClose: () => void }) {
  const { cid } = useGame()
  const [b, setB] = useState<any>(null)
  useEffect(() => { api.briefing(cid).then(setB) }, [cid])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <motion.div className="panel w-[min(860px,94vw)] max-h-[86vh] overflow-y-auto p-7 bg-ink-900" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} onClick={e => e.stopPropagation()} data-testid="briefing">
        {!b ? <div className="h-title text-slate-400">Compiling the dossier…</div> : (
          <>
            <div className="text-[11px] uppercase tracking-[.25em] text-slate-500">Classified · Historical briefing</div>
            <div className="h-title text-3xl accent mb-4">{b.title}</div>
            {b.narrative && <div className="mb-5 border-l-2 accent-border pl-4"><Markdown text={b.narrative} /></div>}
            {b.sections.map((s: any, i: number) => (
              <div key={i} className="mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="h-title text-lg">{s.title}</div>
                  <span className={`chip ${s.kind === 'alternate' ? 'text-violet-300' : s.kind === 'objectives' ? 'text-amber-300' : ''}`}>{s.kind === 'established' ? 'established history' : s.kind === 'alternate' ? 'alternate history' : 'current affairs'}</span>
                </div>
                <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{s.body}</p>
              </div>
            ))}
            <div className="text-right"><button className="btn btn-primary" onClick={onClose} data-testid="briefing-close">Take command</button></div>
          </>
        )}
      </motion.div>
    </div>
  )
}
