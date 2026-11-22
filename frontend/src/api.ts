import type { CampaignView, Plan, Scenario, ScenarioCountry } from './types'

async function req<T>(method: string, url: string, body?: any): Promise<T> {
  const r = await fetch(url, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined })
  if (!r.ok) {
    let msg = r.statusText
    try { msg = (await r.json()).detail || msg } catch { /* ignore */ }
    throw new Error(msg)
  }
  return r.json()
}
const c = (id: string) => `/api/campaigns/${id}`

export const api = {
  health: () => req<any>('GET', '/api/health'),
  scenarios: () => req<Scenario[]>('GET', '/api/scenarios'),
  scenarioCountries: (sid: string, year?: number) => req<ScenarioCountry[]>('GET', `/api/scenarios/${sid}/countries${year !== undefined ? `?year=${year}` : ''}`),
  campaigns: () => req<any[]>('GET', '/api/campaigns'),
  create: (body: any) => req<{ id: string }>('POST', '/api/campaigns', body),
  view: (id: string) => req<CampaignView>('GET', c(id)),
  remove: (id: string) => req('DELETE', c(id)),
  advance: (id: string, months: number) => req<any>('POST', `${c(id)}/advance`, { months }),
  interpret: (id: string, text: string) => req<Plan>('POST', `${c(id)}/orders/interpret`, { text }),
  execute: (id: string, text: string, actions?: any[]) => req<any>('POST', `${c(id)}/orders/execute`, { text, actions }),
  decide: (id: string, did: string, option: string) => req<any>('POST', `${c(id)}/decisions/${did}`, { option }),
  switchCountry: (id: string, tag: string) => req<any>('POST', `${c(id)}/switch`, { tag }),
  briefing: (id: string) => req<any>('GET', `${c(id)}/briefing`),
  events: (id: string, params: Record<string, any>) => req<any[]>('GET', `${c(id)}/events?` + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))),
  summaries: (id: string) => req<any[]>('GET', `${c(id)}/summaries`),
  writeHistory: (id: string, request: string) => req<any>('POST', `${c(id)}/history`, { request }),
  documents: (id: string) => req<any[]>('GET', `${c(id)}/documents`),
  newspaper: (id: string, year?: number, month?: number, country?: string) => req<any>('GET', `${c(id)}/newspaper?` + new URLSearchParams(Object.entries({ year, month, country }).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))),
  advisor: (id: string) => req<any>('GET', `${c(id)}/advisor`),
  ask: (id: string, question: string) => req<any>('POST', `${c(id)}/advisor/ask`, { question }),
  country: (id: string, tag: string) => req<any>('GET', `${c(id)}/countries/${tag}`),
  conversation: (id: string, tag: string) => req<any[]>('GET', `${c(id)}/diplomacy/${tag}`),
  talk: (id: string, tag: string, message: string, secret: boolean) => req<any>('POST', `${c(id)}/diplomacy/${tag}`, { message, secret }),
  tech: (id: string) => req<any>('GET', `${c(id)}/tech`),
  setResearch: (id: string, tech?: string, auto?: boolean) => req<any>('POST', `${c(id)}/tech`, { tech, auto }),
  mission: (id: string, mid: string, action: string) => req<any>('POST', `${c(id)}/missions/${mid}/${action}`),
  rankings: (id: string) => req<any>('GET', `${c(id)}/rankings`),
  saves: (id: string) => req<any[]>('GET', `${c(id)}/saves`),
  save: (id: string, label: string) => req<any>('POST', `${c(id)}/saves`, { label }),
  loadSave: (id: string, sid: number) => req<any>('POST', `${c(id)}/saves/${sid}/load`),
  branch: (id: string, sid: number, name?: string) => req<{ id: string }>('POST', `${c(id)}/saves/${sid}/branch`, { name }),
  snapMap: (id: string, sid: number) => req<any>('GET', `${c(id)}/saves/${sid}/map`),
  duplicate: (id: string, name?: string) => req<{ id: string }>('POST', `${c(id)}/duplicate`, { name }),
  exportUrl: (id: string) => `${c(id)}/export`,
  import: (data: any) => req<{ id: string }>('POST', '/api/import', data),
  aiSettings: () => req<any>('GET', '/api/settings/ai'),
  setAiSettings: (body: any) => req<any>('POST', '/api/settings/ai', body),
  testAi: () => req<any>('POST', '/api/settings/ai/test'),
}
