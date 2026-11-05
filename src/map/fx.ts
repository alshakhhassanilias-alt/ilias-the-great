/**
 * High-quality battle effects (desktop / "Beautiful" graphics): soft glowing shell bursts with sparks and
 * shock rings, billowing smoke that drifts with the wind, aircraft with contrails and blinking lights,
 * light pulses running down the offensive arrows, and a burst of colour when a region falls.
 * All drawn in world coordinates with sizes given in screen pixels (divided by the zoom), from a few
 * pre-rendered sprites, so it stays cheap.
 */

interface P { kind: 0 | 1 | 2 | 3 | 4; x: number; y: number; vx: number; vy: number; t0: number; life: number; s: number; c: string }
const FLASH = 0, SPARK = 1, SMOKE = 2, RING = 3, EMBER = 4;

function sprite(size: number, paint: (g: CanvasRenderingContext2D, r: number) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d')!, size / 2);
  return c;
}

export class Fx {
  private parts: P[] = [];
  private glow: HTMLCanvasElement | null = null;
  private smoke: HTMLCanvasElement | null = null;
  private tinted = new Map<string, HTMLCanvasElement>();
  get count() { return this.parts.length; }

  private sprites() {
    if (this.glow) return;
    this.glow = sprite(96, (g, r) => {
      const gr = g.createRadialGradient(r, r, 0, r, r, r);
      gr.addColorStop(0, 'rgba(255,255,236,1)');
      gr.addColorStop(0.16, 'rgba(255,232,160,0.95)');
      gr.addColorStop(0.42, 'rgba(255,150,50,0.45)');
      gr.addColorStop(1, 'rgba(255,80,10,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 2 * r, 2 * r);
    });
    this.smoke = sprite(96, (g, r) => {
      // a billowing puff: overlapping soft blobs
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 9; i++) {
        const a = rnd() * 6.283, d = rnd() * r * 0.38, rr = r * (0.38 + rnd() * 0.3);
        const x = r + Math.cos(a) * d, y = r + Math.sin(a) * d;
        const gr = g.createRadialGradient(x, y, 0, x, y, rr);
        gr.addColorStop(0, 'rgba(206,200,190,0.30)');
        gr.addColorStop(0.55, 'rgba(160,154,146,0.16)');
        gr.addColorStop(1, 'rgba(120,116,110,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 2 * r, 2 * r);
      }
    });
  }
  /** a glow sprite tinted with a nation's colour (for captures) */
  private tint(color: string) {
    let c = this.tinted.get(color);
    if (c) return c;
    c = sprite(64, (g, r) => {
      const gr = g.createRadialGradient(r, r, 0, r, r, r);
      gr.addColorStop(0, 'rgba(255,255,240,0.95)');
      gr.addColorStop(0.25, color);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 2 * r, 2 * r);
    });
    if (this.tinted.size > 40) this.tinted.clear();
    this.tinted.set(color, c);
    return c;
  }

  /** one artillery shell landing */
  shell(x: number, y: number, now: number, power = 1) {
    if (this.parts.length > 170) return;
    const r = Math.random;
    this.parts.push({ kind: FLASH, x, y, vx: 0, vy: 0, t0: now, life: 260 + 140 * r(), s: (22 + 14 * r()) * power, c: '' });
    this.parts.push({ kind: RING, x, y, vx: 0, vy: 0, t0: now, life: 480, s: (28 + 14 * r()) * power, c: 'rgba(255,236,200,' });
    const n = 3 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI * (0.15 + 0.7 * r()), v = 70 + 110 * r();
      this.parts.push({ kind: SPARK, x, y, vx: Math.cos(a) * v * (r() < 0.5 ? -1 : 1), vy: Math.sin(a) * v, t0: now, life: 380 + 260 * r(), s: 1, c: r() < 0.5 ? '#ffd27a' : '#ff9a4a' });
    }
    this.parts.push({ kind: SMOKE, x: x + (r() - 0.5) * 0.5, y, vx: 4 + 6 * r(), vy: -(6 + 8 * r()), t0: now + 60, life: 2000 + 1000 * r(), s: (16 + 10 * r()) * power, c: '' });
    if (r() < 0.4) this.parts.push({ kind: EMBER, x, y, vx: (r() - 0.5) * 12, vy: -(10 + 14 * r()), t0: now, life: 900 + 600 * r(), s: 1.4, c: '#ff8a3a' });
  }
  /** a region changes hands: a ring and a fountain of sparks in the conqueror's colour */
  capture(x: number, y: number, color: string, now: number) {
    this.parts.push({ kind: RING, x, y, vx: 0, vy: 0, t0: now, life: 900, s: 60, c: 'rgba(255,240,200,' });
    this.parts.push({ kind: RING, x, y, vx: 0, vy: 0, t0: now + 140, life: 900, s: 42, c: 'rgba(255,220,150,' });
    this.parts.push({ kind: FLASH, x, y, vx: 0, vy: 0, t0: now, life: 600, s: 34, c: color });
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * 6.283, v = 50 + 90 * Math.random();
      this.parts.push({ kind: SPARK, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, t0: now, life: 700 + 500 * Math.random(), s: 1.3, c: i % 3 === 0 ? '#fff4d0' : color });
    }
  }

  draw(ctx: CanvasRenderingContext2D, k: number, now: number) {
    this.sprites();
    this.parts = this.parts.filter((p) => now - p.t0 < p.life);
    const ik = 1 / k;
    // smoke under everything
    for (const p of this.parts) {
      if (p.kind !== SMOKE) continue;
      const age = now - p.t0;
      if (age < 0) continue;
      const a = age / p.life, sec = age / 1000;
      const size = p.s * (0.7 + 1.8 * a) * ik;
      ctx.globalAlpha = Math.min(1, age / 180) * (1 - a) * 0.7;
      ctx.drawImage(this.smoke!, p.x + p.vx * sec * ik - size, p.y + p.vy * sec * ik - size, size * 2, size * 2);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.parts) {
      const age = now - p.t0;
      if (age < 0 || p.kind === SMOKE) continue;
      const a = age / p.life, sec = age / 1000;
      if (p.kind === FLASH) {
        const size = p.s * (0.55 + 1.1 * Math.sqrt(a)) * ik;
        ctx.globalAlpha = Math.pow(1 - a, 1.6);
        ctx.drawImage(p.c ? this.tint(p.c) : this.glow!, p.x - size, p.y - size, size * 2, size * 2);
      } else if (p.kind === RING) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = `${p.c}${(0.55 * (1 - a)).toFixed(3)})`;
        ctx.lineWidth = (2.4 * (1 - a) + 0.4) * ik;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (0.15 + 0.85 * (1 - Math.pow(1 - a, 2))) * ik, 0, 6.283); ctx.stroke();
      } else if (p.kind === SPARK) {
        const g = 140; // px/s² of gravity
        const x = p.x + p.vx * sec * ik, y = p.y + (p.vy * sec + 0.5 * g * sec * sec) * ik;
        const sp = Math.max(0, sec - 0.035);
        const x0 = p.x + p.vx * sp * ik, y0 = p.y + (p.vy * sp + 0.5 * g * sp * sp) * ik;
        ctx.globalAlpha = 1 - a;
        ctx.strokeStyle = p.c; ctx.lineWidth = 1.7 * ik; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
      } else {
        const x = p.x + (p.vx * sec + Math.sin(sec * 6 + p.x) * 2) * ik, y = p.y + p.vy * sec * ik;
        ctx.globalAlpha = (1 - a) * (0.6 + 0.4 * Math.sin(sec * 20));
        ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.arc(x, y, p.s * ik, 0, 6.283); ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /** a combat aircraft with a fading contrail; `pos(dt)` gives its position dt seconds ago */
  plane(ctx: CanvasRenderingContext2D, pos: (back: number) => [number, number], ang: number, color: string, k: number, alpha: number, now: number) {
    const ik = 1 / k;
    // contrail: a fading ribbon behind the aircraft
    ctx.lineCap = 'round';
    let [px, py] = pos(0);
    for (let i = 1; i <= 10; i++) {
      const [qx, qy] = pos(i * 0.06);
      ctx.strokeStyle = `rgba(240,244,250,${(0.32 * alpha * (1 - i / 11)).toFixed(3)})`;
      ctx.lineWidth = (1.6 + i * 0.25) * ik;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(qx, qy); ctx.stroke();
      px = qx; py = qy;
    }
    const [x, y] = pos(0);
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang); ctx.scale(ik, ik);
    ctx.globalAlpha = 0.3 + 0.7 * alpha;
    // ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(3, 9, 8, 2.2, 0, 0, 6.283); ctx.fill();
    // airframe: swept wings, tailplanes, a shaded fuselage
    const gr = ctx.createLinearGradient(0, -8, 0, 8);
    gr.addColorStop(0, '#f2efe8'); gr.addColorStop(0.45, color); gr.addColorStop(1, '#1d1a16');
    ctx.fillStyle = gr; ctx.strokeStyle = 'rgba(12,8,4,0.95)'; ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(10, 0); ctx.lineTo(4, -1.4); ctx.lineTo(-1, -9); ctx.lineTo(-4, -9); ctx.lineTo(-2.5, -1.6); ctx.lineTo(-7.5, -1.4);
    ctx.lineTo(-10, -4.6); ctx.lineTo(-11.6, -4.6); ctx.lineTo(-10.4, 0); ctx.lineTo(-11.6, 4.6); ctx.lineTo(-10, 4.6); ctx.lineTo(-7.5, 1.4);
    ctx.lineTo(-2.5, 1.6); ctx.lineTo(-4, 9); ctx.lineTo(-1, 9); ctx.lineTo(4, 1.4); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(150,210,255,0.9)'; ctx.beginPath(); ctx.ellipse(5.5, 0, 1.8, 0.8, 0, 0, 6.283); ctx.fill();
    // navigation lights
    const blink = Math.sin(now / 140) > 0.3;
    if (blink) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,60,50,0.95)'; ctx.beginPath(); ctx.arc(-2.6, -8.6, 1.3, 0, 6.283); ctx.fill();
      ctx.fillStyle = 'rgba(80,255,120,0.95)'; ctx.beginPath(); ctx.arc(-2.6, 8.6, 1.3, 0, 6.283); ctx.fill();
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /** glowing chevrons running along an offensive arrow towards the front */
  arrowPulse(ctx: CanvasRenderingContext2D, a: { sx: number; sy: number; cx: number; cy: number; hx: number; hy: number; mine: boolean }, k: number, t: number) {
    const ik = 1 / k;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < 3; i++) {
      const u = ((t * 0.42 + i / 3) % 1) * 0.96;
      const v = 1 - u;
      const x = v * v * a.sx + 2 * v * u * a.cx + u * u * a.hx, y = v * v * a.sy + 2 * v * u * a.cy + u * u * a.hy;
      const tx = 2 * v * (a.cx - a.sx) + 2 * u * (a.hx - a.cx), ty = 2 * v * (a.cy - a.sy) + 2 * u * (a.hy - a.cy);
      const tl = Math.hypot(tx, ty) || 1, ux = tx / tl, uy = ty / tl;
      const w = 6 * ik, l = 5 * ik;
      ctx.globalAlpha = Math.sin(Math.PI * Math.min(1, u / 0.96)) * 0.95;
      ctx.strokeStyle = a.mine ? 'rgba(255,236,170,1)' : 'rgba(255,190,170,1)';
      ctx.lineWidth = 2.4 * ik;
      ctx.beginPath();
      ctx.moveTo(x - ux * l - uy * w, y - uy * l + ux * w);
      ctx.lineTo(x, y);
      ctx.lineTo(x - ux * l + uy * w, y - uy * l - ux * w);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}
