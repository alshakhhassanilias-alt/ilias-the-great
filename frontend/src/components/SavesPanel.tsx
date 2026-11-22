import { useEffect, useState } from 'react'
import { api } from '../api'
import { useGame } from '../store'

export default function SavesPanel({ onOpen }: { onOpen: (id: string) => void }) {
  const { view, cid, toast, refresh } = useGame()
  const [snaps, setSnaps] = useState<any[]>([])
  const [label, setLabel] = useState('')
  const reload = () => api.saves(cid).then(setSnaps)
  useEffect(() => { reload() }, [cid, view?.meta.year])
  async function save() {
    await api.save(cid, label || `${view?.player?.name} ${view?.meta.year}`)
    setLabel('')
    toast('Game saved', 'success')
    reload()
  }
  return (
    <div className="p-3 h-full flex flex-col" data-testid="saves-panel">
      <div className="text-xs text-slate-400 mb-2">The campaign autosaves after every action. Manual saves and automatic decade snapshots let you return to, or branch from, any moment.</div>
      <div className="flex gap-2 mb-3">
        <input className="input flex-1" placeholder="Save name" value={label} onChange={e => setLabel(e.target.value)} data-testid="save-label" />
        <button className="btn btn-primary" onClick={save} data-testid="save-btn">Save</button>
      </div>
      <div className="flex gap-2 mb-3 flex-wrap">
        <a className="btn btn-ghost text-xs" href={api.exportUrl(cid)} download data-testid="export-btn">Export campaign file</a>
        <button className="btn btn-ghost text-xs" onClick={async () => { const r = await api.duplicate(cid); toast('Campaign duplicated', 'success'); onOpen(r.id) }}>Duplicate campaign</button>
      </div>
      <div className="overflow-y-auto flex-1">
        {[...snaps].reverse().map(s => (
          <div key={s.id} className="flex items-center gap-2 py-1.5 border-b border-ink-700/60">
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{s.label}</div>
              <div className="text-[11px] text-slate-500">{s.kind} · {s.year}-{String(s.month).padStart(2, '0')} · {new Date(s.created * 1000).toLocaleString()}</div>
            </div>
            <button className="btn btn-ghost text-[11px] py-0.5" title="Restore this save; later history is discarded" onClick={async () => {
              if (!confirm(`Load "${s.label}"? History after ${s.year} will be discarded. (Use Branch to keep it.)`)) return
              await api.loadSave(cid, s.id); toast(`Loaded ${s.label}`, 'success'); refresh(); reload()
            }}>Load</button>
            <button className="btn btn-ghost text-[11px] py-0.5" title="Create a new campaign branching from this moment" onClick={async () => { const r = await api.branch(cid, s.id); toast('Alternate timeline created', 'success'); onOpen(r.id) }}>Branch</button>
          </div>
        ))}
      </div>
    </div>
  )
}
