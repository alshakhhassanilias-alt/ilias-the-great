/**
 * Client-side map geometry: Path2D per province, runtime union outlines of each owner's territory
 * (so borders redraw correctly when provinces change hands), label anchors and hit-testing.
 * Geographic data (world.json) stays separate from simulation logic.
 */
import polygonClipping from 'polygon-clipping';
import type { Geo } from '../sim/geo';
import type { GameState } from '../sim/types';

type Pt = [number, number];
type MPoly = Pt[][][];

export interface Outline { path: Path2D; labelAnchor: Pt; labelW: number; labelH: number; bbox: [number, number, number, number]; area: number }

function toMPoly(poly: number[][][]): MPoly {
  return poly.map((rings) => rings.map((flat) => {
    const r: Pt[] = [];
    for (let i = 0; i < flat.length; i += 2) r.push([flat[i] / 10, flat[i + 1] / 10]);
    return r;
  }));
}
const ringArea = (r: Pt[]) => {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; a += x1 * y2 - x2 * y1; }
  return a / 2;
};
function polyArea(p: Pt[][]) { return Math.abs(ringArea(p[0])) - p.slice(1).reduce((t, r) => t + Math.abs(ringArea(r)), 0); }
function centroidOf(p: Pt[][]): Pt {
  const r = p[0];
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; const f = x1 * y2 - x2 * y1; a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f; }
  return Math.abs(a) < 1e-9 ? r[0] : [cx / (3 * a), cy / (3 * a)];
}
function pathOf(mp: MPoly): Path2D {
  const path = new Path2D();
  for (const poly of mp) for (const ring of poly) {
    ring.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
    path.closePath();
  }
  return path;
}
function bboxOfMP(mp: MPoly): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of mp) for (const [x, y] of p[0] ?? []) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}

export class MapGeometry {
  readonly provPaths: Path2D[];
  readonly mpolys: MPoly[];
  private outlineCache = new Map<number, { sig: string; outline: Outline }>();
  private hit: CanvasRenderingContext2D;
  bounds: [number, number, number, number] = [0, 0, 1000, 450];
  computed = 0;

  constructor(public geo: Geo) {
    this.mpolys = geo.provinces.map((p) => toMPoly(p.poly));
    this.provPaths = this.mpolys.map(pathOf);
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

  /** Outline (union of an owner's provinces). Returns null while not yet computed (budgeted per frame). */
  outline(state: GameState, owner: number, allowCompute: boolean): Outline | null {
    const provs = state.countries[owner].provinces;
    if (!provs.length) return null;
    const sig = provs.slice().sort((a, b) => a - b).join(',');
    const hit = this.outlineCache.get(owner);
    if (hit && hit.sig === sig) return hit.outline;
    if (!allowCompute) return hit?.outline ?? null;
    this.computed++;
    let mp: MPoly;
    if (provs.length === 1) mp = this.mpolys[provs[0]];
    else {
      try {
        const parts = provs.map((p) => this.mpolys[p] as never);
        mp = polygonClipping.union(parts[0], ...parts.slice(1)) as unknown as MPoly;
      } catch {
        mp = provs.flatMap((p) => this.mpolys[p]);
      }
      // drop sliver holes created by rounding
      mp = mp.map((poly) => [poly[0], ...poly.slice(1).filter((r) => Math.abs(ringArea(r)) > 0.6)]);
    }
    mp = mp.filter((p) => p[0]?.length);
    if (!mp.length) return null;
    let best = mp[0], ba = -1;
    for (const p of mp) { const a = polyArea(p); if (a > ba) { ba = a; best = p; } }
    const bb = bboxOfMP([best]);
    const outline: Outline = {
      path: pathOf(mp), labelAnchor: centroidOf(best), labelW: bb[2] - bb[0], labelH: bb[3] - bb[1], bbox: bboxOfMP(mp),
      area: mp.reduce((t, p) => t + polyArea(p), 0),
    };
    this.outlineCache.set(owner, { sig, outline });
    return outline;
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
