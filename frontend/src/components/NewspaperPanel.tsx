import { useEffect, useState } from 'react'
import { api } from '../api'
import { useGame } from '../store'
import { MONTHS, yearStr } from '../lib/format'

export default function NewspaperPanel() {
  const { view, cid } = useGame()
  const [paper, setPaper] = useState<any>(null)
  const [country, setCountry] = useState<string | undefined>(undefined)
  useEffect(() => { setPaper(null); api.newspaper(cid, undefined, undefined, country).then(setPaper) }, [cid, country, view?.meta.year, view?.meta.month])
  if (!view) return null
  const majors = Object.values(view.countries).filter(c => c.alive).sort((a, b) => b.power - a.power).slice(0, 12)
  return (
    <div className="p-3 h-full flex flex-col" data-testid="newspaper-panel">
      <div className="flex gap-2 mb-2 items-center">
        <span className="text-xs text-slate-400">Read the press of</span>
        <select className="input py-1 text-xs" value={country || ''} onChange={e => setCountry(e.target.value || undefined)}>
          <option value="">{view.player?.name || 'our nation'}</option>
          {majors.filter(c => c.tag !== view.meta.player).map(c => <option key={c.tag} value={c.tag}>{c.name}</option>)}
        </select>
      </div>
      <div className="overflow-y-auto flex-1">
        {!paper ? <div className="text-xs text-slate-500">The presses are running…</div> : (
          <div className={`paper-${paper.style} rounded-md p-4 shadow-panel`} data-testid={`paper-${paper.style}`}>
            <div className="text-center border-b-2 border-current pb-2 mb-3">
              <div className="masthead text-3xl leading-tight">{paper.masthead}</div>
              <div className="text-[11px] flex justify-between mt-1 opacity-70"><span>{MONTHS[paper.month - 1]} {yearStr(paper.year)}</span><span>{paper.style === 'feed' ? 'live' : paper.style === 'neural' ? 'consensus-verified' : 'Price: ' + paper.price}</span></div>
            </div>
            {paper.articles.length === 0 && <div className="text-sm opacity-70">Nothing of note has happened.</div>}
            {paper.articles[0] && (
              <div className="mb-3">
                <div className={`font-bold leading-tight mb-1 ${paper.style === 'broadsheet' || paper.style === 'broadside' ? 'text-2xl' : 'text-xl'}`}>{paper.articles[0].headline}</div>
                <p className="text-sm leading-relaxed">{paper.articles[0].body}</p>
                {paper.articles[0].reactions.map((r: any, i: number) => <p key={i} className="text-xs italic mt-1 opacity-80">“{r.quote}” — {r.speaker}</p>)}
              </div>
            )}
            <div className={paper.style === 'feed' || paper.style === 'neural' ? 'space-y-2' : 'columns-paper'}>
              {paper.articles.slice(1).map((a: any, i: number) => (
                <div key={i} className={`mb-3 break-inside-avoid ${paper.style === 'feed' ? 'border border-white/10 rounded p-2' : paper.style === 'neural' ? 'border border-violet-400/20 rounded p-2 bg-white/5' : ''}`}>
                  <div className="font-bold text-sm leading-snug">{a.headline}</div>
                  <div className="text-[10px] opacity-60">{MONTHS[(a.month || 1) - 1]} {a.year}</div>
                  <p className="text-xs leading-relaxed">{a.body}</p>
                  {a.reactions?.map((r: any, j: number) => <p key={j} className="text-[11px] italic opacity-75">“{r.quote}” — {r.speaker}</p>)}
                </div>
              ))}
            </div>
            {paper.editorial && <div className="border-t border-current/30 pt-2 mt-2"><div className="text-xs font-bold uppercase tracking-wider opacity-70">Editorial</div><p className="text-xs italic leading-relaxed">{paper.editorial}</p></div>}
            {paper.briefs.length > 0 && <div className="border-t border-current/30 pt-2 mt-2 text-[11px] opacity-80">{paper.briefs.map((b: string, i: number) => <div key={i}>· {b}</div>)}</div>}
            <div className="flex gap-2 mt-3 flex-wrap">{paper.ads.map((a: string, i: number) => <div key={i} className="text-[10px] border border-current/40 px-2 py-1 opacity-70">{a}</div>)}</div>
          </div>
        )}
      </div>
    </div>
  )
}
