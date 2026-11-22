/** Claude inside the claude.ai artifact viewer (the `sample` capability): the page asks Claude on the viewer's own account. */
let pending: Promise<any | null> | null = null

export function getSample(): Promise<any | null> {
  if (!pending) {
    pending = (async () => {
      for (let i = 0; i < 30 && !(window as any).claude?.use; i++) await new Promise(r => setTimeout(r, 100))
      const c = (window as any).claude
      if (!c?.use) return null
      try { return await c.use('sample') } catch { return null }
    })()
  }
  return pending
}

/** Codes after which Claude is unusable in this view: fall back to the offline storyteller for the rest of the session. */
export const UNAVAILABLE = new Set(['unavailable', 'not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'])
let disabled = false
export const claudeDisabled = () => disabled

export async function askJSON<T = any>(system: string, prompt: string, opts: { onText?: (t: string) => void; signal?: AbortSignal; tier?: 'quick' | 'default' | 'complex' } = {}): Promise<T> {
  const s = disabled ? null : await getSample()
  if (!s) throw { code: 'unavailable', message: 'Claude is not available in this view.' }
  try {
    return await s.json(`${system}\n\n${prompt}`, { cache: false, modelTier: opts.tier || 'default', signal: opts.signal, onText: opts.onText ? (u: { text: string }) => opts.onText!(u.text) : undefined })
  } catch (e: any) {
    if (UNAVAILABLE.has(e?.code)) disabled = true
    throw e
  }
}

export function errorText(e: any): string {
  switch (e?.code) {
    case 'rate_limited': return e.reason === 'usage_limit' ? 'You have reached your Claude usage limit for now. Try again later.' : 'Claude is busy. Wait a moment and try again.'
    case 'refused': return 'Claude declined to write that one. Rephrase it and try again.'
    case 'invalid_json': return 'The storyteller lost the thread mid-chapter. Try again.'
    case 'session_expired': return 'Sign in to claude.ai again, then retry.'
    case 'prompt_too_large': return 'The world got too big to describe. Try a shorter order.'
    case 'cancelled': return 'Stopped.'
    default: return e?.message || String(e)
  }
}

/** Read a (possibly unfinished) JSON string field out of a streaming reply, for live display. */
export function partialField(raw: string, field: string): string {
  const m = raw.match(new RegExp(`"${field}"\\s*:\\s*"`))
  if (!m || m.index === undefined) return ''
  let i = m.index + m[0].length, out = ''
  while (i < raw.length) {
    const ch = raw[i]
    if (ch === '"') break
    if (ch === '\\') {
      const n = raw[i + 1]
      if (n === undefined) break
      if (n === 'n') out += '\n'
      else if (n === 't') out += '\t'
      else if (n === 'u') { const h = raw.slice(i + 2, i + 6); if (h.length < 4) break; out += String.fromCharCode(parseInt(h, 16)); i += 4 }
      else out += n
      i += 2
      continue
    }
    out += ch
    i++
  }
  return out
}
