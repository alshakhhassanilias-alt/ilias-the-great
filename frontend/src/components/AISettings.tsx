import { useEffect, useState } from 'react'
import { api } from '../api'

export default function AISettings({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<any>(null)
  const [key, setKey] = useState('')
  const [test, setTest] = useState<any>(null)
  useEffect(() => { api.aiSettings().then(setCfg) }, [])
  if (!cfg) return null
  const upd = (k: string, v: any) => setCfg((c: any) => ({ ...c, [k]: v }))
  async function save() {
    const r = await api.setAiSettings({ provider: cfg.provider, model: cfg.model, base_url: cfg.base_url, effort: cfg.effort, features: cfg.features, ...(key ? { api_key: key } : {}) })
    setCfg(r); setKey('')
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <div className="panel w-[min(560px,94vw)] p-6 bg-ink-900" onClick={e => e.stopPropagation()} data-testid="ai-modal">
        <div className="h-title text-xl accent mb-1">AI storytelling</div>
        <p className="text-xs text-slate-400 mb-4">The game is fully playable offline: the deterministic engine simulates the world and composes all text from the historical record. An AI model can optionally interpret orders, voice leaders, write newspapers and histories, and propose missions. Every AI proposal is validated before it can change the world.</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="col-span-2">Provider
            <select className="input w-full mt-1" value={cfg.provider} onChange={e => upd('provider', e.target.value)} data-testid="ai-provider">
              <option value="offline">Offline (deterministic, free)</option>
              <option value="anthropic">Anthropic Claude API</option>
              <option value="ollama">Local model via Ollama</option>
              <option value="openai">OpenAI-compatible endpoint</option>
            </select>
          </label>
          {cfg.provider !== 'offline' && (
            <>
              <label>Model<input className="input w-full mt-1" value={cfg.model || ''} onChange={e => upd('model', e.target.value)} /></label>
              <label>Base URL<input className="input w-full mt-1" placeholder={cfg.provider === 'ollama' ? 'http://localhost:11434' : 'default'} value={cfg.base_url || ''} onChange={e => upd('base_url', e.target.value)} /></label>
              {cfg.provider !== 'ollama' && <label className="col-span-2">API key {cfg.has_key && <span className="text-emerald-400 text-xs">(configured)</span>}<input type="password" className="input w-full mt-1" placeholder={cfg.has_key ? '•••••••• (leave blank to keep)' : 'paste key'} value={key} onChange={e => setKey(e.target.value)} /></label>}
              {cfg.provider === 'anthropic' && <label>Effort<select className="input w-full mt-1" value={cfg.effort} onChange={e => upd('effort', e.target.value)}>{['low', 'medium', 'high'].map(x => <option key={x}>{x}</option>)}</select></label>}
              <div className="col-span-2">
                <div className="text-xs text-slate-400 mb-1">Use the model for:</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(cfg.features).map(([k, v]) => (
                    <label key={k} className="text-xs flex items-center gap-1 chip"><input type="checkbox" checked={!!v} onChange={e => upd('features', { ...cfg.features, [k]: e.target.checked })} />{k}</label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        {cfg.stats && <div className="text-[11px] text-slate-500 mt-3">Calls {cfg.stats.calls} · failures {cfg.stats.failures}{cfg.stats.last_error ? ` · last error: ${cfg.stats.last_error}` : ''}</div>}
        {test && <div className={`text-xs mt-2 ${test.ok ? 'text-emerald-300' : 'text-red-300'}`}>{test.message}{test.latency ? ` (${test.latency}s)` : ''}</div>}
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn btn-ghost" onClick={async () => { await save(); setTest(await api.testAi()) }}>Save & test</button>
          <button className="btn btn-primary" onClick={async () => { await save(); onClose() }} data-testid="ai-save">Save</button>
        </div>
      </div>
    </div>
  )
}
