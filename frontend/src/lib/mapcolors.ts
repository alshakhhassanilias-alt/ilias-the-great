import type { CampaignView, ProvTuple } from '../types'
import type { MapMode } from '../store'
import { hashStr, scale3 } from './format'

const FAMILY_COLORS: Record<string, string> = {
  democratic: '#4f8fe0', monarchic: '#a87fd8', authoritarian: '#7d7d7d', socialist: '#d9443b', religious: '#e0b74a',
  imperial: '#9b59b6', technocratic: '#33c1b1', corporate: '#e08a3c', traditional: '#8d6e4a', 'post-national': '#5fd3f3',
  artificial: '#00e5ff', transhumanist: '#c38bff', collective: '#ff6ad5',
}

export function familyColor(f: string): string { return FAMILY_COLORS[f] || '#8899aa' }

export interface ColorContext {
  view: CampaignView
  allies: Set<string>
  enemies: Set<string>
  subjects: Set<string>
  maxGpc: number
}

export function makeContext(view: CampaignView): ColorContext {
  const p = view.meta.player
  const allies = new Set<string>()
  const enemies = new Set<string>()
  const subjects = new Set<string>()
  for (const t of view.treaties) if ((t.type === 'alliance' || t.type === 'defensive_pact') && t.members.includes(p)) t.members.forEach(m => m !== p && allies.add(m))
  for (const o of view.orgs) if (['alliance', 'federation', 'coalition'].includes(o.kind) && o.members.includes(p)) o.members.forEach(m => m !== p && allies.add(m))
  for (const w of view.wars) {
    if (w.att.includes(p)) w.def.forEach(x => enemies.add(x))
    if (w.def.includes(p)) w.att.forEach(x => enemies.add(x))
  }
  for (const [t, c] of Object.entries(view.countries)) if (c.overlord === p) subjects.add(t)
  let maxGpc = 1000
  for (const v of Object.values(view.provinces || {})) if (v[0] && v[4] > maxGpc) maxGpc = v[4]
  return { view, allies, enemies, subjects, maxGpc }
}

export function provinceColor(mode: MapMode, pv: ProvTuple | undefined, ctx: ColorContext): string {
  if (!pv || !pv[0]) return '#1d2533'
  const [owner, , unrest, popM, gpc, integ, , core] = pv
  const c = ctx.view.countries[owner!]
  const p = ctx.view.meta.player
  switch (mode) {
    case 'political': {
      if (!c) return '#555'
      return c.color
    }
    case 'diplomatic': {
      if (owner === p) return '#3b82f6'
      if (ctx.subjects.has(owner!)) return '#60a5fa'
      if (ctx.allies.has(owner!)) return '#22c55e'
      if (ctx.enemies.has(owner!)) return '#ef4444'
      const op = ctx.view.relations?.[owner!]?.[0] ?? 0
      return scale3((op + 100) / 200, ['#7f1d1d', '#57534e', '#166534'])
    }
    case 'economy':
      return scale3(Math.log10(Math.max(300, gpc)) / Math.log10(Math.max(ctx.maxGpc, 2000)), ['#1e1b4b', '#155e75', '#16a34a', '#facc15', '#fff7cc'])
    case 'unrest':
      return scale3(unrest / 100, ['#14532d', '#ca8a04', '#b91c1c', '#450a0a'])
    case 'integration':
      return core ? '#2563eb' : scale3(integ / 100, ['#7f1d1d', '#a16207', '#0e7490'])
    case 'population':
      return scale3(Math.min(1, Math.log10(1 + popM * 10) / 3), ['#0f172a', '#334155', '#f59e0b', '#fef3c7'])
    case 'ideology': {
      const fam = ctx.view.ideologies[c?.ideology_id || '']?.family
      return familyColor(fam || '')
    }
    case 'war': {
      if (ctx.enemies.has(owner!)) return '#9f1239'
      if (owner === p || ctx.allies.has(owner!)) return '#1d4ed8'
      if (ctx.view.wars.some(w => w.att.includes(owner!) || w.def.includes(owner!))) return '#a16207'
      return '#334155'
    }
  }
  return '#444'
}

export function hatchColor(tag: string | null | undefined, ctx: ColorContext): string {
  if (!tag) return '#000'
  return ctx.view.countries[tag]?.color || '#' + (hashStr(tag) & 0xffffff).toString(16).padStart(6, '0')
}
