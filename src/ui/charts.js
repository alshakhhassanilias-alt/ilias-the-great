// Small, crisp canvas line/area charts for the telemetry strip.
export class LineChart {
  constructor(canvas, { series, yMin = 0, yPad = 0.1, area = false, bars = null }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.series = series; // [{key, color, width, fill, dash}]
    this.bars = bars;     // {key, color} drawn as bars on a secondary scale
    this.yMin = yMin;
    this.yPad = yPad;
    this.area = area;
    this.data = [];
  }

  setData(data) {
    this.data = data;
    this.draw();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
  }

  draw() {
    this.resize();
    const { ctx, canvas, data } = this;
    const W = canvas.width, H = canvas.height, dpr = this.dpr;
    ctx.clearRect(0, 0, W, H);
    if (data.length < 2) return;
    const padL = 26 * dpr, padB = 4 * dpr, padT = 6 * dpr, padR = 4 * dpr;
    let max = -Infinity, min = Infinity;
    for (const d of data) for (const s of this.series) { const v = d[s.key]; if (v > max) max = v; if (v < min) min = v; }
    if (this.yMin != null) min = Math.min(min, this.yMin);
    const span = Math.max(1e-6, max - min);
    max += span * this.yPad;
    if (this.yMin == null) min -= span * this.yPad;
    const x = (i) => padL + (i / (data.length - 1)) * (W - padL - padR);
    const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = dpr;
    ctx.fillStyle = 'rgba(141,152,173,0.75)';
    ctx.font = `${9.5 * dpr}px Inter, ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let g = 0; g <= 3; g++) {
      const v = min + ((max - min) * g) / 3;
      const yy = y(v);
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(W - padR, yy);
      ctx.stroke();
      ctx.fillText(formatNum(v, max - min), padL - 5 * dpr, Math.min(H - 6 * dpr, Math.max(6 * dpr, yy)));
    }

    // optional bars (secondary scale)
    if (this.bars) {
      let bmax = 1;
      for (const d of data) bmax = Math.max(bmax, d[this.bars.key] || 0);
      const bw = Math.max(1, ((W - padL - padR) / data.length) * 0.7);
      ctx.fillStyle = this.bars.color;
      data.forEach((d, i) => {
        const v = d[this.bars.key] || 0;
        if (!v) return;
        const h = (v / bmax) * (H - padT - padB) * 0.55;
        ctx.fillRect(x(i) - bw / 2, H - padB - h, bw, h);
      });
    }

    for (const s of this.series) {
      ctx.beginPath();
      data.forEach((d, i) => (i ? ctx.lineTo(x(i), y(d[s.key])) : ctx.moveTo(x(i), y(d[s.key]))));
      if (s.fill) {
        ctx.save();
        ctx.lineTo(x(data.length - 1), H - padB);
        ctx.lineTo(x(0), H - padB);
        ctx.closePath();
        const grd = ctx.createLinearGradient(0, padT, 0, H);
        grd.addColorStop(0, s.fill);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.fill();
        ctx.restore();
        ctx.beginPath();
        data.forEach((d, i) => (i ? ctx.lineTo(x(i), y(d[s.key])) : ctx.moveTo(x(i), y(d[s.key]))));
      }
      ctx.strokeStyle = s.color;
      ctx.lineWidth = (s.width || 1.6) * dpr;
      ctx.setLineDash(s.dash ? s.dash.map((v) => v * dpr) : []);
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.setLineDash([]);
      // end dot
      const last = data[data.length - 1];
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(x(data.length - 1), y(last[s.key]), 2.4 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function formatNum(v, span = 100) {
  if (span < 3) return v.toFixed(1);
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'k';
  if (Math.abs(v) >= 100) return Math.round(v).toString();
  if (Math.abs(v) >= 10) return v.toFixed(0);
  return v.toFixed(1).replace(/\.0$/, '');
}
