import { HIST_EVERY } from '../sim/types';
import { dateOf } from '../sim/tick';

export interface Series { label: string; color: string; data: number[]; fmt?: (v: number) => string; dashed?: boolean }

export function LineChart({ series, height = 96, endTick, zeroLine }: { series: Series[]; height?: number; endTick: number; zeroLine?: boolean }) {
  const W = 320, H = height, padL = 4, padR = 4, padT = 8, padB = 16;
  const all = series.flatMap((s) => s.data).filter((v) => Number.isFinite(v));
  const n = Math.max(...series.map((s) => s.data.length), 0);
  if (n < 2 || !all.length) {
    return <div className="faint" style={{ fontSize: 12, padding: '14px 0' }}>History builds up as time passes — press play.</div>;
  }
  let lo = Math.min(...all), hi = Math.max(...all);
  if (zeroLine) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (hi - lo < 1e-12) { hi += 1; lo -= 1; }
  const padv = (hi - lo) * 0.08; lo -= padv; hi += padv;
  const x = (i: number, len: number) => padL + (i / Math.max(1, len - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const lastTick = endTick - (endTick % HIST_EVERY);
  const firstTick = lastTick - (n - 1) * HIST_EVERY;
  const yr = (t: number) => dateOf(t).getUTCFullYear();
  const fmt = series[0].fmt ?? ((v: number) => v.toPrecision(3));
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((s) => s.label).join(', ')}>
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={padL} x2={W - padR} y1={padT + f * (H - padT - padB)} y2={padT + f * (H - padT - padB)} stroke="rgba(120,160,200,0.12)" />
        ))}
        {zeroLine && <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.3)" strokeDasharray="3 3" />}
        {series.map((s) => (
          <polyline key={s.label} fill="none" stroke={s.color} strokeWidth={1.8} strokeLinejoin="round" strokeDasharray={s.dashed ? '4 3' : undefined}
            points={s.data.map((v, i) => `${x(i, s.data.length).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} />
        ))}
        <text x={padL} y={H - 3} fontSize="10" fill="#6c869e">{yr(firstTick)}</text>
        <text x={W - padR} y={H - 3} fontSize="10" fill="#6c869e" textAnchor="end">{yr(lastTick)}</text>
        <text x={padL + 2} y={padT + 8} fontSize="10" fill="#6c869e">{fmt(hi - padv)}</text>
        <text x={padL + 2} y={H - padB - 3} fontSize="10" fill="#6c869e">{fmt(lo + padv)}</text>
      </svg>
      <div className="legend-row">
        {series.map((s) => (
          <span key={s.label}><i style={{ background: s.color }} />{s.label}{s.data.length ? ` ${(s.fmt ?? fmt)(s.data[s.data.length - 1])}` : ''}</span>
        ))}
      </div>
    </div>
  );
}
