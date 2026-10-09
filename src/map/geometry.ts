/**
 * Client-side map geometry: Path2D per province, runtime union outlines of each owner's territory
 * (so borders redraw correctly when provinces change hands), label anchors and hit-testing.
 * Geographic data (world.json) stays separate from simulation logic.
 */
import type { Geo } from '../sim/geo';
import type { GameState } from '../sim/types';

type Pt = [number, number];
type MPoly = Pt[][][];

export interface EdgePath { n: number; path: Path2D }
export interface LabelInfo { anchor: Pt; w: number; h: number; area: number }

function toMPoly(poly: number[][][]): MPoly {
  return poly.map((rings) => rings.map((flat) => {
    const r: Pt[] = [];
    for (let i = 0; i < flat.length; i += 2) r.push([flat[i] / 10, flat[i + 1] / 10]);
    return r;
  }));
}
function pathOf(mp: MPoly): Path2D {
  const path = new Path2D();
  for (const poly of mp) for (const ring of poly) {
    ring.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
    path.closePath();
  }
  return path;
}

export class MapGeometry {
  readonly provPaths: Path2D[];
  /** boundary runs per province (precomputed at build time): national borders are the runs whose two sides have different owners */
  readonly edgePaths: EdgePath[][];
  private hit: CanvasRenderingContext2D;
  bounds: [number, number, number, number] = [0, 0, 1000, 450];

  constructor(public geo: Geo) {
    this.provPaths = geo.provinces.map((p) => pathOf(toMPoly(p.poly)));
    this.edgePaths = geo.provinces.map((p) => p.edges.map((e) => {
      const path = new Path2D();
      for (let i = 0; i < e.pts.length; i += 2) {
        if (i === 0) path.moveTo(e.pts[0] / 10, e.pts[1] / 10); else path.lineTo(e.pts[i] / 10, e.pts[i + 1] / 10);
      }
      return { n: e.n, path };
    }));
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    this.hit = c.getContext('2d')!;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of geo.provinces) { x0 = Math.min(x0, p.bbox[0]); y0 = Math.min(y0, p.bbox[1]); x1 = Math.max(x1, p.bbox[2]); y1 = Math.max(y1, p.bbox[3]); }
    this.bounds = [x0, y0, x1, y1];
  }

  /** Province under a world-space point (with tolerance for tiny islands). */
  pick(wx: number, wy: number, tol: number): number | null {
    const provs = this.geo.provinces;
    for (let i = 0; i < provs.length; i++) {
      const b = provs[i].bbox;
      if (wx < b[0] || wx > b[2] || wy < b[1] || wy > b[3]) continue;
      if (this.hit.isPointInPath(this.provPaths[i], wx, wy, 'evenodd')) return i;
    }
    let best = -1, bd = tol;
    for (let i = 0; i < provs.length; i++) {
      const b = provs[i].bbox;
      if (wx < b[0] - tol || wx > b[2] + tol || wy < b[1] - tol || wy > b[3] + tol) continue;
      if (provs[i].area > 25) continue;
      const d = Math.hypot(provs[i].seed[0] - wx, provs[i].seed[1] - wy);
      if (d < bd) { bd = d; best = i; }
    }
    return best >= 0 ? best : null;
  }

  /** Label placement: the largest connected landmass an owner holds. */
  labelInfo(state: GameState, owner: number): LabelInfo | null {
    const c = state.countries[owner];
    if (!c.alive || !c.provinces.length) return null;
    const provs = this.geo.provinces;
    const mine = new Set(c.provinces);
    let start = c.provinces[0];
    for (const p of c.provinces) if (provs[p].area > provs[start].area) start = p;
    const seen = new Set<number>([start]);
    const stack = [start];
    while (stack.length) {
      const p = stack.pop()!;
      for (const q of this.geo.adj[p]) if (mine.has(q) && !seen.has(q)) { seen.add(q); stack.push(q); }
    }
    let area = 0, cx = 0, cy = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of seen) {
      const gp = provs[p];
      area += gp.area; cx += gp.seed[0] * gp.area; cy += gp.seed[1] * gp.area;
      x0 = Math.min(x0, gp.bbox[0]); y0 = Math.min(y0, gp.bbox[1]); x1 = Math.max(x1, gp.bbox[2]); y1 = Math.max(y1, gp.bbox[3]);
    }
    cx /= area; cy /= area;
    let best = start, bd = Infinity;
    for (const p of seen) { const d = Math.hypot(provs[p].seed[0] - cx, provs[p].seed[1] - cy); if (d < bd) { bd = d; best = p; } }
    return { anchor: [provs[best].seed[0], provs[best].seed[1]], w: x1 - x0, h: y1 - y0, area };
  }

  /** Bounding box of a country's main landmass (within reach of its capital), world coordinates. */
  focusBox(state: GameState, owner: number): [number, number, number, number] {
    const c = state.countries[owner];
    const geo = this.geo;
    const cap = geo.provinces[c.capital] ?? geo.provinces[c.provinces[0]];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of c.provinces) {
      const gp = geo.provinces[p];
      if (cap && Math.hypot(gp.seed[0] - cap.seed[0], gp.seed[1] - cap.seed[1]) > 190 && c.provinces.length > 1 && p !== c.capital) continue;
      x0 = Math.min(x0, gp.bbox[0]); y0 = Math.min(y0, gp.bbox[1]); x1 = Math.max(x1, gp.bbox[2]); y1 = Math.max(y1, gp.bbox[3]);
    }
    if (!isFinite(x0)) return [0, 0, 100, 100];
    return [x0, y0, x1, y1];
  }
}
