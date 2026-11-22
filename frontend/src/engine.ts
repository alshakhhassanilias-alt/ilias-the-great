/** Client for the in-browser engine (standalone build): API calls go to a Web Worker running the Python simulation. */
export const STANDALONE = !!import.meta.env.VITE_STANDALONE

type Listener = (s: { text: string; ready: boolean; fatal?: boolean; persistent?: boolean }) => void
let worker: Worker | null = null
let seq = 1
const pending = new Map<number, (r: { status: number; data: any }) => void>()
const listeners = new Set<Listener>()
export let engineState = { text: 'Starting…', ready: false, fatal: false, persistent: false }

function emit() { listeners.forEach(l => l(engineState)) }
export function onEngine(l: Listener) { listeners.add(l); l(engineState); return () => { listeners.delete(l) } }

function boot() {
  if (worker) return worker
  worker = new Worker(new URL('engine-worker.js', document.baseURI).href)
  worker.onmessage = e => {
    const m = e.data
    if (m.type === 'status') { engineState = { ...engineState, text: m.text }; emit(); return }
    if (m.type === 'ready') { engineState = { ...engineState, text: 'Ready', ready: true, persistent: m.persistent }; emit(); return }
    if (m.type === 'fatal') { engineState = { ...engineState, text: m.text, fatal: true }; emit(); return }
    const cb = pending.get(m.id)
    if (cb) { pending.delete(m.id); cb(m) }
  }
  worker.onerror = e => { engineState = { ...engineState, text: e.message || 'The engine failed to start.', fatal: true }; emit() }
  return worker
}

export function engineCall(method: string, url: string, body?: any): Promise<{ status: number; data: any }> {
  const w = boot()
  const id = seq++
  return new Promise(resolve => {
    pending.set(id, resolve)
    w.postMessage({ id, method, url, body: body === undefined ? null : body })
  })
}

if (STANDALONE) boot()
