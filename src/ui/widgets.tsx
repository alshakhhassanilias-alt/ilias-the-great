import type { ReactNode } from 'react';
import { clamp } from '../sim/util';

export function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <h3>{title}{hint ? <small>{hint}</small> : null}</h3>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone, tip }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'warn'; tip?: string }) {
  return (
    <div className="stat" title={tip}>
      <label>{label}</label>
      <b className={tone}>{value}</b>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

export function Meter({ value, color = 'var(--teal)', max = 1 }: { value: number; color?: string; max?: number }) {
  return (
    <div className="bar" role="meter" aria-valuenow={Math.round(value * 100) / 100}>
      <i style={{ width: `${clamp(value / max, 0, 1) * 100}%`, background: color }} />
    </div>
  );
}

export function MeterRow({ label, value, text, color, hint }: { label: string; value: number; text?: ReactNode; color?: string; hint?: string }) {
  return (
    <div className="row" title={hint}>
      <div className="grow">
        <div className="lab">{label}</div>
        <Meter value={value} color={color} />
      </div>
      <div className="val">{text ?? `${Math.round(value * 100)}%`}</div>
    </div>
  );
}

export function Slider({
  label, value, min, max, step, format, hint, onChange, tone,
}: {
  label: string; value: number; min: number; max: number; step: number; format: (v: number) => string;
  hint?: ReactNode; onChange: (v: number) => void; tone?: string;
}) {
  return (
    <div className="slider">
      <span className="lab">{label}</span>
      <span className="val" style={tone ? { color: tone } : undefined}>{format(value)}</span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(parseFloat(e.target.value))} />
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.v)} className={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Note({ children, tone }: { children: ReactNode; tone?: 'warn' | 'bad' }) {
  return <div className={`note ${tone ?? ''}`}>{children}</div>;
}

export function RelationBar({ value }: { value: number }) {
  return (
    <div className="relbar" role="meter" aria-valuenow={Math.round(value)} aria-label="Relations">
      <i style={{ left: `${(clamp(value, -100, 100) + 100) / 2}%` }} />
    </div>
  );
}
