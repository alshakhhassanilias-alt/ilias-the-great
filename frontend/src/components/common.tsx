import { hashStr } from '../lib/format'

export function Flag({ tag, color, size = 28, className = '' }: { tag: string; color: string; size?: number; className?: string }) {
  const h = hashStr(tag)
  const kind = h % 5
  const c2 = ['#f5f5f5', '#111827', '#d4a63f', '#b91c1c', '#1d4ed8'][(h >> 3) % 5]
  const w = size * 1.5
  return (
    <svg width={w} height={size} viewBox="0 0 30 20" className={`rounded-sm shadow ring-1 ring-black/40 shrink-0 ${className}`}>
      <rect width="30" height="20" fill={color} />
      {kind === 0 && <rect x="10" width="10" height="20" fill={c2} opacity=".9" />}
      {kind === 1 && <rect y="6.6" width="30" height="6.8" fill={c2} opacity=".9" />}
      {kind === 2 && <><rect x="8" width="4" height="20" fill={c2} /><rect y="8" width="30" height="4" fill={c2} /></>}
      {kind === 3 && <polygon points="0,0 12,10 0,20" fill={c2} />}
      {kind === 4 && <circle cx="15" cy="10" r="5" fill={c2} />}
      <rect width="30" height="20" fill="url(#none)" stroke="rgba(0,0,0,.25)" strokeWidth=".6" />
    </svg>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'good' | 'bad' | 'warn' }) {
  const col = tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-red-400' : tone === 'warn' ? 'text-amber-400' : 'text-slate-100'
  return (
    <div className="min-w-0">
      <div className="stat-label">{label}</div>
      <div className={`text-sm font-semibold truncate ${col}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 truncate">{sub}</div>}
    </div>
  )
}

export function Bar({ value, max = 100, color }: { value: number; max?: number; color?: string }) {
  return (
    <div className="h-1.5 bg-ink-700 rounded overflow-hidden">
      <div className="h-full rounded" style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, background: color || 'var(--accent)' }} />
    </div>
  )
}

export function Spark({ data, color = 'var(--accent)', h = 28, w = 120 }: { data: number[]; color?: string; h?: number; w?: number }) {
  if (data.length < 2) return <svg width={w} height={h} />
  const mn = Math.min(...data), mx = Math.max(...data)
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 2 - ((v - mn) / (mx - mn || 1)) * (h - 4)}`).join(' ')
  return <svg width={w} height={h}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" /></svg>
}

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[11px] uppercase tracking-[.18em] text-slate-400 font-semibold">{title}</div>
        {right}
      </div>
      {children}
    </div>
  )
}

export function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/)
  return (
    <div className="markdown text-sm">
      {blocks.map((b, i) => {
        const t = b.trim()
        if (t.startsWith('### ')) return <h3 key={i}>{t.slice(4)}</h3>
        if (t.startsWith('## ') || t.startsWith('# ')) return <h2 key={i}>{t.replace(/^#+\s/, '')}</h2>
        return <p key={i}>{t.replace(/\*\*(.+?)\*\*/g, '$1')}</p>
      })}
    </div>
  )
}
