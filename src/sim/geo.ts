/**
 * Static world geometry (never part of the saved game state).
 * Built from src/data/generated/world.json (see scripts/build-map.ts).
 */
import { COUNTRY_BASE } from '../data/countryData';
import { hash01 } from './rng';

export interface RawProvince {
  poly: number[][][];
  seed: [number, number];
  area: number;
  bbox: [number, number, number, number];
  terrain: number;
  coast?: number;
  territory?: string;
  capital?: boolean;
  edges?: { n: number; pts: number[] }[];
}
export interface RawWorld {
  width: number;
  height: number;
  source: string;
  countries: { name: string; provinces: RawProvince[] }[];
  adjacency: [number, number][];
}

export interface GeoProvince {
  id: number;
  country0: number; // original (core) country
  seed: [number, number];
  area: number;
  bbox: [number, number, number, number];
  terrain: number;
  coast: number;
  isCapital0: boolean;
  territory?: string;
  edges: { n: number; pts: number[] }[]; // boundary runs: n = neighbouring province, or -1 for coast
  name: string; // region name, e.g. "North-East Poland"
  w: number; // relative weight (population / output share) within the original country
  poly: number[][][];
}

export interface Geo {
  width: number;
  height: number;
  source: string;
  provinces: GeoProvince[];
  adj: number[][];
  country0: number[]; // province -> original country
  provs0: number[][]; // country -> original provinces
  /** distance between province seeds in map pixels */
  dist(a: number, b: number): number;
}

export function buildGeo(raw: RawWorld): Geo {
  const provinces: GeoProvince[] = [];
  const provs0: number[][] = [];
  raw.countries.forEach((c, ci) => {
    if (COUNTRY_BASE[ci]?.name !== c.name) throw new Error(`world.json country order mismatch at ${ci}: ${c.name}`);
    const ids: number[] = [];
    const total = c.provinces.reduce((s, p) => s + p.area, 0) || 1;
    const avg = total / c.provinces.length;
    for (const p of c.provinces) {
      const id = provinces.length;
      let w = (0.55 + 0.45 * Math.min(2, p.area / avg)) * (0.75 + 0.5 * hash01(c.name, id));
      if (p.capital) w *= 2.2;
      if (p.territory) w *= 0.35;
      provinces.push({
        id, country0: ci, seed: p.seed, area: p.area, bbox: p.bbox, terrain: p.terrain, coast: p.coast ?? 0,
        isCapital0: !!p.capital, territory: p.territory, name: p.territory ?? '', w, poly: p.poly, edges: p.edges ?? [],
      });
      ids.push(id);
    }
    provs0.push(ids);
    nameRegions(c.name, ids.map((i) => provinces[i]));
  });
  const adj: number[][] = provinces.map(() => []);
  for (const [a, b] of raw.adjacency) { adj[a].push(b); adj[b].push(a); }
  return {
    width: raw.width,
    height: raw.height,
    source: raw.source,
    provinces,
    adj,
    country0: provinces.map((p) => p.country0),
    provs0,
    dist: (a, b) => {
      const pa = provinces[a].seed, pb = provinces[b].seed;
      return Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
    },
  };
}

const DIRS = ['East', 'South-East', 'South', 'South-West', 'West', 'North-West', 'North', 'North-East'];
/** Give each (non-territory) province a compass-based region name relative to its country's centre. */
function nameRegions(country: string, provs: GeoProvince[]) {
  const main = provs.filter((p) => !p.territory);
  if (main.length === 0) return;
  if (main.length === 1) { main[0].name = country; return; }
  const cx = main.reduce((t, p) => t + p.seed[0], 0) / main.length;
  const cy = main.reduce((t, p) => t + p.seed[1], 0) / main.length;
  const spread = Math.sqrt(main.reduce((t, p) => t + (p.seed[0] - cx) ** 2 + (p.seed[1] - cy) ** 2, 0) / main.length) || 1;
  const used = new Map<string, number>();
  const rank = [...main].sort((a, b) => b.w - a.w);
  for (const p of rank) {
    const dx = p.seed[0] - cx, dy = p.seed[1] - cy;
    const dist = Math.hypot(dx, dy) / spread;
    let base: string;
    if (p.isCapital0) base = `${country} Capital Region`;
    else if (dist < 0.45) base = `Central ${country}`;
    else {
      const ang = Math.atan2(-dy, dx); // screen y is down
      const i = (Math.round((ang / (Math.PI / 4)) + 8) % 8 + 8) % 8;
      base = `${DIRS[i]} ${country}`;
    }
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    p.name = n === 1 ? base : `${base} ${['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n - 1] ?? n}`;
  }
}
