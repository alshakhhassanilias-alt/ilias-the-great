export function money(b: number): string {
  if (!isFinite(b)) return '—'
  const a = Math.abs(b)
  if (a >= 1e12) return `$${(b / 1e12).toPrecision(3)} Sx`
  if (a >= 1e9) return `$${(b / 1e9).toPrecision(3)} Qn`
  if (a >= 1e6) return `$${(b / 1e6).toPrecision(3)} Qd`
  if (a >= 1e3) return `$${(b / 1e3).toFixed(2)} T`
  if (a >= 1) return `$${b.toFixed(1)} B`
  return `$${(b * 1000).toFixed(0)} M`
}
export function pop(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} B`
  if (m >= 1) return `${m.toFixed(1)} M`
  if (m * 1000 >= 1) return `${(m * 1000).toFixed(1)} K`
  return `${Math.round(m * 1e6)}`
}
export function num(n: number, d = 0): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })
}
export function pct(x: number, d = 0): string { return `${(x * 100).toFixed(d)}%` }
export function yearStr(y: number): string { return y < 0 ? `${-y} BCE` : String(y) }
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function dateStr(y: number, m: number): string { return `${MONTHS[(m - 1 + 12) % 12]} ${yearStr(y)}` }
export function eraClass(year: number, era?: string): string {
  if (era && /Post-Biological|Stellar|Metric|Interstellar|Age of /.test(era) && year > 2150) return 'era-post'
  if (year < 1950) return 'era-classic'
  if (year < 2080) return 'era-modern'
  return 'era-future'
}
export function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
export function lerpColor(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16)
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t)
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t)
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t)
  return `rgb(${r},${g},${bl})`
}
export function scale3(t: number, stops: string[]): string {
  t = Math.max(0, Math.min(1, t))
  const n = stops.length - 1
  const i = Math.min(n - 1, Math.floor(t * n))
  return lerpColor(stops[i], stops[i + 1], t * n - i)
}
export const IMPORTANCE_COLORS = ['#64748b', '#64748b', '#94a3b8', '#e2e8f0', '#fbbf24', '#f87171']
export const KIND_ICONS: Record<string, string> = {
  war: '⚔', battle: '⚔', peace: '🕊', war_end: '🕊', science: '⚗', space: '🚀', collapse: '☠', independence: '⚑', revolt: '🔥',
  government: '⚖', election: '🗳', leader: '♔', succession: '♔', diplomacy: '✉', diplomacy_talk: '✉', society: '◈', ideology: '✦',
  law: '§', era: '⌛', chapter: '📜', mission: '◎', decision: '❖', project: '⚙', anniversary: '🎗', history: '📜', economy: '💰',
  boom: '💰', recession: '📉', disaster: '⚠', pandemic: '☣', catastrophe: '☢', restoration: '⚜', religion: '✙', campaign: '★', divergence: '⑂',
  unrest: '🔥', civil_war: '⚔', reunification: '⚜', order: '➤', historical: '📜', politics: '⚖', espionage: '🕵', organization: '◍', reform: '⚖', movement: '♫', strike: '✊', scandal: '!', assassination: '✝', discovery: '⚗',
}
