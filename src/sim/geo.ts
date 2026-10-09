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
        isCapital0: !!p.capital, territory: p.territory, w, poly: p.poly,
      });
      ids.push(id);
    }
    provs0.push(ids);
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
