import type { Health, Risk } from "../types";
import type { Loadable } from "../useDashboard";
import { DASH, fmtAge, fmtInt, fmtNum, fmtPct, fmtTime, toNum } from "../format";
import { SeverityBadge, StatusBadge, Tag } from "./Badges";

function DdBar({ label, value, limit }: { label: string; value: unknown; limit: unknown }) {
  const v = toNum(value);
  const l = toNum(limit);
  const ratio = v !== null && l !== null && l > 0 ? Math.abs(v) / l : null;
  const tone = ratio === null ? "grey" : ratio >= 0.8 ? "red" : ratio >= 0.5 ? "amber" : "green";
  return (
    <div className="ddbar">
      <div className="ddbar-head">
        <span>{label}</span>
        <span className="num">
          {fmtPct(v === null ? null : Math.abs(v))} <span className="muted">/ limit {fmtPct(l)}</span>
          {ratio !== null && <span className={`tone-${tone}`}> · {(ratio * 100).toFixed(0)}% used</span>}
        </span>
      </div>
      <div
        className="bar"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={ratio === null ? undefined : Math.round(Math.min(1, ratio) * 100)}
      >
        <span className={`bar-fill bg-${tone}`} style={{ width: `${Math.min(1, ratio ?? 0) * 100}%` }} />
        <span className="bar-mark" style={{ left: "50%" }} aria-hidden="true" />
        <span className="bar-mark" style={{ left: "80%" }} aria-hidden="true" />
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className={`metric-value num ${tone ? `tone-${tone}` : ""}`}>{value}</span>
    </div>
  );
}

function flatten(obj: unknown, prefix = "", out: [string, string][] = []): [string, string][] {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.push([prefix, Array.isArray(obj) ? obj.join(", ") : obj === null || obj === undefined ? DASH : String(obj)]);
  }
  return out;
}

export default function RiskPanel({ risk, health }: { risk: Loadable<Risk>; health: Loadable<Health> }) {
  const r = risk.data;
  const lat = toNum(r?.api_latency_ms);
  const age = toNum(r?.data_age_seconds);
  const errs = toNum(r?.consecutive_errors);
  const blocks = Object.entries(r?.transient_blocks ?? {});
  const breaches = Object.entries(r?.breach_count ?? {}).filter(([, v]) => toNum(v) !== 0);
  const reasons = r?.health_reasons ?? [];
  const events = r?.events ?? [];
  const hb = health.data?.heartbeat;
  const db = health.data?.database;
  const limits = r?.limits ? flatten(r.limits) : [];

  const breakers: { label: string; tone: "red" | "amber" | "grey" }[] = [];
  if (r?.kill_switch) breakers.push({ label: "KILL SWITCH ENGAGED", tone: "red" });
  if (r?.halted) breakers.push({ label: `HALTED: ${r.halt_reason ?? "reason not recorded"}`, tone: "red" });
  if (r?.requires_authorization) breakers.push({ label: "HUMAN AUTHORIZATION REQUIRED", tone: "red" });
  for (const [k, v] of blocks) breakers.push({ label: `${k}${v !== null && v !== undefined && v !== "" ? `: ${String(v)}` : ""}`, tone: "amber" });

  return (
    <section className="panel" aria-label="Risk monitoring" data-testid="risk-panel">
      <div className="panel-head">
        <h2>Risk monitor</h2>
        {r && (r.halted ? <Tag tone="red">HALTED</Tag> : blocks.length ? <Tag tone="amber">ENTRIES BLOCKED</Tag> : <Tag tone="green">ARMED</Tag>)}
      </div>
      {risk.error && <div className="alert alert-red small">Risk refresh failed: {risk.error}</div>}
      {!r ? (
        <div className="empty">{risk.error ? "Risk state unavailable" : "Loading…"}</div>
      ) : (
        <>
          <DdBar label="Daily drawdown" value={r.daily_drawdown} limit={r.daily_drawdown_limit} />
          <DdBar label="Total drawdown" value={r.total_drawdown} limit={r.total_drawdown_limit} />
          <div className="metrics">
            <Metric label="API latency" value={lat === null ? DASH : `${fmtNum(lat, 0)} ms`} tone={lat === null ? undefined : lat < 500 ? "green" : lat < 2000 ? "amber" : "red"} />
            <Metric label="Market data age" value={fmtAge(age)} tone={age === null ? undefined : age < 60 ? "green" : age < 300 ? "amber" : "red"} />
            <Metric label="Consecutive errors" value={fmtInt(errs)} tone={errs === null ? undefined : errs === 0 ? "green" : errs < 3 ? "amber" : "red"} />
            <div className="metric">
              <span className="metric-label">Exchange / engine</span>
              <span className="metric-value">
                <StatusBadge status={r.exchange_connectivity} />
              </span>
            </div>
            <Metric label="Heartbeat age" value={fmtAge(hb?.age_seconds)} tone={toNum(hb?.age_seconds) === null ? undefined : (toNum(hb?.age_seconds) ?? 0) < 30 ? "green" : (toNum(hb?.age_seconds) ?? 0) < 60 ? "amber" : "red"} />
            <Metric label="Database" value={db ? (db.ok ? "OK" : "FAIL") : DASH} tone={db ? (db.ok ? "green" : "red") : undefined} />
          </div>
          {db && !db.ok && db.detail && <div className="alert alert-red small">Database integrity: {db.detail}</div>}

          <h3>Active circuit breakers</h3>
          {breakers.length === 0 ? (
            <div className="empty small">No active circuit breakers</div>
          ) : (
            <ul className="chips">
              {breakers.map((b) => (
                <li key={b.label}>
                  <Tag tone={b.tone}>{b.label}</Tag>
                </li>
              ))}
            </ul>
          )}
          {breaches.length > 0 && (
            <div className="small muted breaches">
              Breach counts:{" "}
              {breaches.map(([k, v]) => (
                <span key={k} className="num">
                  {k} ×{String(v)}{" "}
                </span>
              ))}
            </div>
          )}
          {reasons.length > 0 && (
            <>
              <h3>Health warnings</h3>
              <ul className="reasons">
                {reasons.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </>
          )}

          <h3>Recent risk events</h3>
          {events.length === 0 ? (
            <div className="empty small">No risk events recorded</div>
          ) : (
            <ul className="events">
              {events.slice(0, 50).map((e, i) => (
                <li key={i}>
                  <span className="ev-time num">{fmtTime(e.timestamp)}</span>
                  <SeverityBadge severity={e.severity} />
                  <span className="ev-type">{e.event_type ?? DASH}</span>
                  <span className="ev-msg">{e.message ?? ""}</span>
                </li>
              ))}
            </ul>
          )}
          {limits.length > 0 && (
            <details className="limits">
              <summary>Configured risk limits ({limits.length})</summary>
              <dl className="kv">
                {limits.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd className="num">{v}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </>
      )}
    </section>
  );
}
