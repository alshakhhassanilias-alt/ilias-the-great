import { STANDALONE, engineCall } from '../engine'
import { feature, mesh } from 'topojson-client'

export interface ProvFeature { id: string; geometry: any; type: 'Feature'; properties: any }
let cache: Promise<{ topo: any; features: ProvFeature[] }> | null = null

export function loadTopology() {
  if (!cache) {
    cache = fetch('provinces.topo.json').then(r => r.json()).then((topo: any) => {
      const fc = feature(topo, topo.objects.provinces) as any
      const features = (fc.features as ProvFeature[]).filter(f => f.geometry)
      return { topo, features }
    })
  }
  return cache
}

let names: Record<string, [string, string]> = {}
let namesP: Promise<Record<string, [string, string]>> | null = null
export function loadNames() {
  if (!namesP) {
    const load = STANDALONE ? engineCall('GET', '/api/geo/names').then(r => r.data) : fetch('/api/geo/names').then(r => r.json())
    namesP = load.then((n: any) => (names = n)).catch(() => names)
  }
  return namesP
}
export function provinceName(pid: string, extra?: Record<string, { name: string }>): string {
  return names[pid]?.[0] || extra?.[pid]?.name || pid
}

/** Borders between provinces of different owners plus coastlines. */
export function borderMesh(topo: any, owner: (id: string) => string | null | undefined) {
  return mesh(topo, topo.objects.provinces, (a: any, b: any) => a === b || owner(a.id) !== owner(b.id))
}
