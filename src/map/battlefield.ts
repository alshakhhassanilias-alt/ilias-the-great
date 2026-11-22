/**
 * Battlefield cells: a contested region is split (visually only) into small Voronoi cells, which fall to the
 * attacker one by one as the offensive's progress grows, starting from the attacker's side. The simulation still
 * transfers whole regions; this just shows the front creeping forward (or being pushed back) in between.
 */
import { Delaunay } from 'd3-delaunay';
import type { MapGeometry } from './geometry';
import type { GameState } from '../sim/types';
import { hash01 } from '../sim/rng';

export interface Cells {
  n: number;
  seeds: [number, number][];
  paths: Path2D[];
  /** shared edges between neighbouring cells: [i, j, x1, y1, x2, y2] */
  edges: [number, number, number, number, number, number][];
  size: number; // typical cell diameter (map units)
}

export class Battlefield {
  private cellCache = new Map<number, Cells>();
  private orderCache = new Map<string, Int32Array>();
  private hit: CanvasRenderingContext2D;

  constructor(private geom: MapGeometry) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    this.hit = c.getContext('2d')!;
  }

  cells(p: number): Cells {
    const hit = this.cellCache.get(p);
    if (hit) return hit;
    const gp = this.geom.geo.provinces[p];
    const [x0, y0, x1, y1] = gp.bbox;
    const target = Math.max(6, Math.min(44, Math.round(gp.area / 1.1)));
    const step = Math.sqrt(((x1 - x0) * (y1 - y0)) / (target * 1.6)) || 1;
    const path = this.geom.provPaths[p];
    const seeds: [number, number][] = [];
    for (let y = y0 + step / 2; y < y1; y += step) {
      for (let x = x0 + step / 2; x < x1; x += step) {
        const jx = x + (hash01('cx', p, seeds.length) - 0.5) * step * 0.8;
        const jy = y + (hash01('cy', p, seeds.length) - 0.5) * step * 0.8;
        if (this.hit.isPointInPath(path, jx, jy, 'evenodd')) seeds.push([jx, jy]);
      }
    }
    if (seeds.length < 3) seeds.splice(0, seeds.length, [gp.seed[0], gp.seed[1]]);
    const out: Cells = { n: seeds.length, seeds, paths: [], edges: [], size: step };
    if (seeds.length === 1) {
      out.paths = [path];
    } else {
      const del = Delaunay.from(seeds);
      const vor = del.voronoi([x0 - step, y0 - step, x1 + step, y1 + step]);
      const polys: [number, number][][] = [];
      for (let i = 0; i < seeds.length; i++) {
        const poly = (vor.cellPolygon(i) ?? []) as [number, number][];
        polys.push(poly);
        const pa = new Path2D();
        poly.forEach(([x, y], k) => (k === 0 ? pa.moveTo(x, y) : pa.lineTo(x, y)));
        pa.closePath();
        out.paths.push(pa);
      }
      // shared edges: neighbouring Voronoi cells share two exact vertices
      const key = (x: number, y: number) => `${x.toFixed(4)},${y.toFixed(4)}`;
      for (let i = 0; i < seeds.length; i++) {
        const vi = new Set(polys[i].map(([x, y]) => key(x, y)));
        for (const j of del.neighbors(i)) {
          if (j <= i) continue;
          const common = polys[j].filter(([x, y]) => vi.has(key(x, y)));
          if (common.length >= 2) out.edges.push([i, j, common[0][0], common[0][1], common[1][0], common[1][1]]);
        }
      }
    }
    this.cellCache.set(p, out);
    return out;
  }

  /**
   * Order in which a region's cells fall to an attacker: nearest to the attacking side's border first,
   * with a little noise so the front line is ragged rather than ruler-straight.
   */
  order(state: GameState, p: number, side: number[], from: number | null, version: number): Int32Array {
    const k = `${p}:${side.join(',')}:${version}`;
    const hit = this.orderCache.get(k);
    if (hit) return hit;
    const geo = this.geom.geo;
    const cells = this.cells(p);
    const owner = state.owner;
    const sideSet = new Set(side);
    const pts: number[] = [];
    for (const e of geo.provinces[p].edges) if (e.n >= 0 && sideSet.has(owner[e.n])) pts.push(...e.pts);
    for (const q of geo.adj[p]) if (sideSet.has(owner[q])) for (const e of geo.provinces[q].edges) if (e.n === p) pts.push(...e.pts);
    if (!pts.length) {
      // seaborne landing: from the coast nearest the source region
      const src = from !== null ? geo.provinces[from].seed : geo.provinces[p].seed;
      let best: number[] | null = null, bd = Infinity;
      for (const e of geo.provinces[p].edges) if (e.n < 0) for (let i = 0; i < e.pts.length; i += 2) {
        const d = (e.pts[i] / 10 - src[0]) ** 2 + (e.pts[i + 1] / 10 - src[1]) ** 2;
        if (d < bd) { bd = d; best = [e.pts[i], e.pts[i + 1]]; }
      }
      pts.push(...(best ?? [src[0] * 10, src[1] * 10]));
    }
    const dist = cells.seeds.map(([x, y], i) => {
      let d = Infinity;
      for (let j = 0; j < pts.length; j += 2) { const dd = (pts[j] / 10 - x) ** 2 + (pts[j + 1] / 10 - y) ** 2; if (dd < d) d = dd; }
      return Math.sqrt(d) + hash01('front', p, i) * cells.size * 0.9;
    });
    const ord = Int32Array.from(dist.map((_, i) => i).sort((a, b) => dist[a] - dist[b]));
    if (this.orderCache.size > 400) this.orderCache.clear();
    this.orderCache.set(k, ord);
    return ord;
  }
}
