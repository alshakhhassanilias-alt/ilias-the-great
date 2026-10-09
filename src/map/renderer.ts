/** Canvas renderer for the world map: provinces, dynamic borders, labels, war fronts, map modes. */
import { MapGeometry } from './geometry';
import type { GameState } from '../sim/types';
import { getRelation, areAtWar, hasAlliance } from '../sim/relations';
import { strengthIndex } from '../sim/military';
import { clamp, shortName } from '../sim/util';
import type { MapMode } from '../state/store';

export interface View { k: number; x: number; y: number }

const OCEAN = '#08131f';
const lerpC = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
const rgb = (c: number[]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
function ramp(stops: number[][], t: number) {
  t = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  return rgb(lerpC(stops[i], stops[i + 1], t - i));
}
const WEALTH = [[24, 40, 84], [30, 96, 140], [40, 150, 150], [150, 190, 90], [236, 214, 96]];
const POWER = [[30, 40, 60], [86, 70, 110], [170, 70, 90], [232, 120, 60], [255, 200, 90]];
const STAB = [[170, 50, 50], [200, 130, 50], [190, 190, 80], [80, 160, 100], [50, 170, 140]];
const REL = [[180, 50, 50], [120, 70, 80], [70, 80, 100], [60, 130, 110], [60, 190, 130]];

export class MapRenderer {
  view: View = { k: 1, x: 0, y: 0 };
  w = 0;
  h = 0;
  dpr = 1;
  dirty = true;
  hoverOwner = -1;
  mode: MapMode = 'political';
  plain = false; // pure political colours (start screen)
  selected: number | null = null;
  selectedProv: number | null = null;
  time = 0;
  private ctx: CanvasRenderingContext2D;
  private anim: { from: View; to: View; t0: number; ms: number } | null = null;
  private stripe: CanvasPattern | null = null;
  fitK = 1;
  minK = 1;
  maxK = 80;

  constructor(private canvas: HTMLCanvasElement, public geom: MapGeometry, private getState: () => GameState | null) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    const pc = document.createElement('canvas');
    pc.width = pc.height = 8;
    const p = pc.getContext('2d')!;
    p.strokeStyle = 'rgba(255,90,80,0.75)'; p.lineWidth = 2;
    p.beginPath(); p.moveTo(-2, 10); p.lineTo(10, -2); p.moveTo(-2, 6); p.lineTo(6, -2); p.moveTo(2, 10); p.lineTo(10, 2); p.stroke();
    this.stripe = this.ctx.createPattern(pc, 'repeat');
  }

  resize(w: number, h: number, dpr: number) {
    const first = this.w === 0;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    const [x0, y0, x1, y1] = this.geom.bounds;
    this.fitK = Math.min(w / (x1 - x0 + 20), h / (y1 - y0 + 20));
    this.minK = this.fitK * 0.85;
    if (first) this.fitWorld();
    else this.constrain();
    this.dirty = true;
  }
  fitWorld() {
    const [x0, y0, x1, y1] = this.geom.bounds;
    const k = this.fitK;
    this.view = { k, x: this.w / 2 - ((x0 + x1) / 2) * k, y: this.h / 2 - ((y0 + y1) / 2) * k };
    this.dirty = true;
  }
  constrain() {
    const [x0, y0, x1, y1] = this.geom.bounds;
    const v = this.view;
    v.k = clamp(v.k, this.minK, this.maxK);
    const margin = 0.25;
    v.x = clamp(v.x, this.w * margin - x1 * v.k, this.w * (1 - margin) - x0 * v.k);
    v.y = clamp(v.y, this.h * margin - y1 * v.k, this.h * (1 - margin) - y0 * v.k);
  }
  screenToWorld(sx: number, sy: number): [number, number] { return [(sx - this.view.x) / this.view.k, (sy - this.view.y) / this.view.k]; }
  zoomAt(sx: number, sy: number, factor: number) {
    const v = this.view;
    const nk = clamp(v.k * factor, this.minK, this.maxK);
    const f = nk / v.k;
    v.x = sx - (sx - v.x) * f; v.y = sy - (sy - v.y) * f; v.k = nk;
    this.constrain();
    this.anim = null;
    this.dirty = true;
  }
  panBy(dx: number, dy: number) { this.view.x += dx; this.view.y += dy; this.constrain(); this.anim = null; this.dirty = true; }

  focusBox(box: [number, number, number, number], insetBottom = 0, insetRight = 0, animate = true) {
    const [x0, y0, x1, y1] = box;
    const availW = Math.max(100, this.w - insetRight), availH = Math.max(100, this.h - insetBottom);
    const bw = Math.max(x1 - x0, 6), bh = Math.max(y1 - y0, 6);
    const k = clamp(Math.min(availW / (bw * 1.7), availH / (bh * 1.7)), this.fitK, 22);
    const to: View = { k, x: availW / 2 - ((x0 + x1) / 2) * k, y: availH / 2 - ((y0 + y1) / 2) * k };
    if (animate) this.anim = { from: { ...this.view }, to, t0: performance.now(), ms: 550 };
    else this.view = to;
    this.dirty = true;
  }

  /** advance animations; returns true if still animating */
  tick(now: number): boolean {
    if (this.anim) {
      const a = this.anim;
      const t = clamp((now - a.t0) / a.ms, 0, 1);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      // interpolate in log-zoom space for a smooth fly-over
      const k = Math.exp(Math.log(a.from.k) + (Math.log(a.to.k) - Math.log(a.from.k)) * e);
      const cx0 = (this.w / 2 - a.from.x) / a.from.k, cy0 = (this.h / 2 - a.from.y) / a.from.k;
      const cx1 = (this.w / 2 - a.to.x) / a.to.k, cy1 = (this.h / 2 - a.to.y) / a.to.k;
      const cx = cx0 + (cx1 - cx0) * e, cy = cy0 + (cy1 - cy0) * e;
      this.view = { k, x: this.w / 2 - cx * k, y: this.h / 2 - cy * k };
      if (t >= 1) this.anim = null;
      this.dirty = true;
    }
    return !!this.anim;
  }

  private colorFor(state: GameState, c: number, selected: boolean): string {
    const C = state.countries[c];
    const P = state.player;
    let col: string;
    switch (this.mode) {
      case 'diplomacy': {
        if (c === P) col = 'hsl(45,85%,48%)';
        else col = ramp(REL, (getRelation(state, c, P) + 100) / 200);
        break;
      }
      case 'wealth': col = ramp(WEALTH, (Math.log10(Math.max(300, C.eco.gdp / Math.max(C.eco.pop, 1))) - 2.5) / 2.3); break;
      case 'power': col = ramp(POWER, (Math.log10(Math.max(2, strengthIndex(C))) - 0.3) / 3.6); break;
      case 'stability': col = ramp(STAB, C.eco.stability / 100); break;
      default: {
        if (c === P && !this.plain) col = 'hsl(172,62%,38%)';
        else if (!this.plain && areAtWar(state, c, P)) col = 'hsl(2,62%,40%)';
        else if (!this.plain && hasAlliance(state, c, P)) col = 'hsl(205,55%,44%)';
        else col = `hsl(${C.color},30%,${34 + (C.id % 3) * 2}%)`;
      }
    }
    return selected ? this.lighten(col) : col;
  }
  private lighten(col: string) {
    if (col.startsWith('hsl')) {
      const m = /hsl\((\d+),(\d+)%,(\d+)%\)/.exec(col);
      if (m) return `hsl(${m[1]},${Math.min(100, +m[2] + 8)}%,${Math.min(80, +m[3] + 9)}%)`;
    }
    return col;
  }

  draw() {
    const state = this.getState();
    const ctx = this.ctx;
    const { k, x, y } = this.view;
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = OCEAN;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!state) return;
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * x, dpr * y);
    const geo = this.geom.geo;
    const nP = geo.provinces.length;

    // graticule
    ctx.strokeStyle = 'rgba(120,160,200,0.05)';
    ctx.lineWidth = 1 / k;
    const [bx0, by0, bx1, by1] = this.geom.bounds;
    ctx.beginPath();
    for (let gx = Math.ceil(bx0 / 50) * 50; gx < bx1; gx += 50) { ctx.moveTo(gx, by0 - 10); ctx.lineTo(gx, by1 + 10); }
    for (let gy = Math.ceil(by0 / 50) * 50; gy < by1; gy += 50) { ctx.moveTo(bx0 - 10, gy); ctx.lineTo(bx1 + 10, gy); }
    ctx.stroke();

    // per-owner colours
    const colors: string[] = new Array(state.countries.length);
    for (const c of state.countries) if (c.alive) colors[c.id] = this.colorFor(state, c.id, c.id === this.selected || c.id === this.hoverOwner);

    // fills
    const vx0 = -x / k, vy0 = -y / k, vx1 = (this.w - x) / k, vy1 = (this.h - y) / k;
    for (let p = 0; p < nP; p++) {
      const b = geo.provinces[p].bbox;
      if (b[2] < vx0 || b[0] > vx1 || b[3] < vy0 || b[1] > vy1) continue;
      ctx.fillStyle = colors[state.owner[p]];
      ctx.fill(this.geom.provPaths[p], 'evenodd');
    }
    // internal province lines
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(8,18,31,0.38)';
    ctx.lineWidth = 0.9 / k;
    for (let p = 0; p < nP; p++) {
      const b = geo.provinces[p].bbox;
      if (b[2] < vx0 || b[0] > vx1 || b[3] < vy0 || b[1] > vy1) continue;
      ctx.stroke(this.geom.provPaths[p]);
    }

    // owner outlines (national borders) – at most one expensive union per frame
    let budget = 1;
    const outlines: ({ o: ReturnType<MapGeometry['outline']>; c: number })[] = [];
    for (const c of state.countries) {
      if (!c.alive) continue;
      const before = this.geom.computed;
      const o = this.geom.outline(state, c.id, budget > 0);
      if (this.geom.computed > before) budget--;
      outlines.push({ o, c: c.id });
      if (budget <= 0 && this.geom.computed === before) { /* stale outline kept this frame */ }
    }
    if (budget <= 0) this.dirty = true; // more unions may be pending: redraw next frame
    ctx.lineWidth = 1.5 / k;
    ctx.strokeStyle = 'rgba(2,8,16,0.92)';
    for (const { o } of outlines) if (o) ctx.stroke(o.path);
    ctx.lineWidth = 0.6 / k;
    ctx.strokeStyle = 'rgba(210,225,240,0.3)';
    for (const { o } of outlines) if (o) ctx.stroke(o.path);

    // player + selection + hover
    const P = state.player;
    const drawOutline = (c: number, style: string, wpx: number) => {
      const o = this.geom.outline(state, c, false);
      if (!o) return;
      ctx.strokeStyle = style; ctx.lineWidth = wpx / k; ctx.stroke(o.path);
    };
    if (!this.plain || this.selected === P) drawOutline(P, 'rgba(255,205,90,0.95)', 1.8);
    if (this.hoverOwner >= 0 && this.hoverOwner !== this.selected) drawOutline(this.hoverOwner, 'rgba(255,255,255,0.75)', 1.4);
    if (this.selected !== null && this.selected !== P) {
      ctx.save(); ctx.shadowColor = 'rgba(120,220,255,0.9)'; ctx.shadowBlur = 8;
      drawOutline(this.selected, 'rgba(150,230,255,1)', 2.2);
      ctx.restore();
    }
    if (this.selectedProv !== null) {
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1.6 / k; ctx.stroke(this.geom.provPaths[this.selectedProv]);
    }

    // war fronts
    this.drawFronts(ctx, state, k);

    // labels
    this.drawLabels(ctx, state, outlines, k);
    // capitals
    if (k > this.fitK * 3.2) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (const c of state.countries) {
        if (!c.alive) continue;
        const gp = geo.provinces[c.capital];
        if (!gp) continue;
        const [sx, sy] = gp.seed;
        if (sx < vx0 || sx > vx1 || sy < vy0 || sy > vy1) continue;
        ctx.beginPath(); ctx.arc(sx, sy, 1.6 / k * 1.4, 0, 6.3); ctx.fill();
      }
    }
  }

  private drawFronts(ctx: CanvasRenderingContext2D, state: GameState, k: number) {
    if (!state.wars.length) return;
    const geo = this.geom.geo;
    const t = performance.now() / 1000;
    ctx.lineCap = 'round';
    for (const w of state.wars) {
      for (const fr of w.fronts) {
        const target = geo.provinces[fr.prov];
        // overlay: stripes + progress fill in the attacker's colour
        ctx.save();
        ctx.globalAlpha = 0.25 + 0.5 * Math.min(1, fr.progress);
        ctx.fillStyle = this.stripe ?? 'rgba(255,80,60,.5)';
        ctx.fill(this.geom.provPaths[fr.prov], 'evenodd');
        ctx.restore();
        // arrow from the attacker's adjacent province
        const side = w.attackers.includes(fr.by) ? w.attackers : w.defenders;
        let src: number | null = null;
        for (const q of geo.adj[fr.prov]) if (state.owner[q] === fr.by) { src = q; break; }
        if (src === null) for (const q of geo.adj[fr.prov]) if (side.includes(state.owner[q])) { src = q; break; }
        if (src === null && fr.amphibious) {
          let bd = 1e9;
          for (const q of state.countries[fr.by].provinces) { const d = geo.dist(q, fr.prov); if (d < bd && geo.provinces[q].coast > 0.15) { bd = d; src = q; } }
        }
        if (src === null) continue;
        const [x0, y0] = geo.provinces[src].seed, [x1, y1] = target.seed;
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 - (fr.amphibious ? Math.hypot(x1 - x0, y1 - y0) * 0.15 : 0);
        const isMine = fr.by === state.player;
        ctx.strokeStyle = isMine ? 'rgba(255,215,90,0.95)' : 'rgba(255,90,70,0.95)';
        ctx.lineWidth = 1.7 / k;
        ctx.setLineDash([4 / k, 3 / k]);
        ctx.lineDashOffset = -t * 12 / k;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke();
        ctx.setLineDash([]);
        const ang = Math.atan2(y1 - my, x1 - mx);
        const ah = 4.5 / k;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - ah * Math.cos(ang - 0.45), y1 - ah * Math.sin(ang - 0.45));
        ctx.lineTo(x1 - ah * Math.cos(ang + 0.45), y1 - ah * Math.sin(ang + 0.45));
        ctx.closePath();
        ctx.fillStyle = ctx.strokeStyle; ctx.fill();
      }
    }
    this.dirty = true; // keep marching ants animating
  }

  private drawLabels(ctx: CanvasRenderingContext2D, state: GameState, outlines: { o: ReturnType<MapGeometry['outline']>; c: number }[], k: number) {
    const placed: [number, number, number, number][] = [];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const list = outlines.filter((x) => x.o).sort((a, b) => b.o!.area - a.o!.area);
    for (const { o, c } of list) {
      const C = state.countries[c];
      const name = shortName(C.name);
      const wpx = o!.labelW * k;
      const hpx = o!.labelH * k;
      let fs = Math.min(wpx / (name.length * 0.58), hpx * 0.5, 24);
      if (c === this.selected || c === state.player) fs = Math.max(fs, Math.min(13, wpx / (name.length * 0.5)));
      if (fs < 6.5) continue;
      const [ax, ay] = o!.labelAnchor;
      const sx = ax * k + this.view.x, sy = ay * k + this.view.y;
      if (sx < -50 || sy < -20 || sx > this.w + 50 || sy > this.h + 20) continue;
      const tw = name.length * fs * 0.58;
      const rect: [number, number, number, number] = [sx - tw / 2, sy - fs / 2, sx + tw / 2, sy + fs / 2];
      if (placed.some((r) => rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1])) continue;
      placed.push(rect);
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.font = `${c === state.player ? 700 : 600} ${fs.toFixed(1)}px "Segoe UI", system-ui, sans-serif`;
      ctx.lineWidth = Math.max(2, fs / 5);
      ctx.strokeStyle = 'rgba(5,12,22,0.8)';
      ctx.lineJoin = 'round';
      ctx.strokeText(name, sx, sy);
      ctx.fillStyle = c === state.player ? '#ffe39a' : 'rgba(240,246,252,0.92)';
      ctx.fillText(name, sx, sy);
      ctx.restore();
    }
  }
}
