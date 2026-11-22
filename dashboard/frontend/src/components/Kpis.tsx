import type { Overview } from "../types";
import { fmtAge, fmtMoney, fmtPct, fmtTime, pnlClass, toNum } from "../format";

interface Kpi {
  label: string;
  value: string;
  cls?: string;
  sub?: string;
}

export default function Kpis({ overview, error }: { overview: Overview | null; error: string | null }) {
  const o = overview;
  const dd = toNum(o?.current_drawdown);
  const eq = toNum(o?.total_equity);
  const gross = toNum(o?.gross_exposure);
  const lev = eq && gross !== null && eq > 0 ? `${(gross / eq).toFixed(2)}× equity` : undefined;
  const kpis: Kpi[] = [
    { label: "Total equity", value: fmtMoney(o?.total_equity) },
    { label: "Available balance", value: fmtMoney(o?.available_balance), sub: o?.cash != null ? `cash ${fmtMoney(o.cash)}` : undefined },
    { label: "Unrealized P&L", value: fmtMoney(o?.unrealized_pnl, { sign: true }), cls: pnlClass(o?.unrealized_pnl) },
    { label: "Realized P&L", value: fmtMoney(o?.realized_pnl, { sign: true }), cls: pnlClass(o?.realized_pnl) },
    { label: "Daily P&L", value: fmtMoney(o?.daily_pnl, { sign: true }), cls: pnlClass(o?.daily_pnl) },
    { label: "Total return", value: fmtPct(o?.total_return, { sign: true }), cls: pnlClass(o?.total_return) },
    {
      label: "Current drawdown",
      value: dd === null ? fmtPct(null) : fmtPct(-Math.abs(dd)),
      cls: dd === null || dd === 0 ? "" : dd > 0.05 ? "neg" : "warn",
    },
    { label: "Gross exposure", value: fmtMoney(o?.gross_exposure), sub: lev },
  ];
  return (
    <section className="kpi-section" aria-label="Account overview">
      {o?.halted && (
        <div className="halt-banner" role="alert" data-testid="halt-banner">
          TRADING HALTED: {o.halt_reason || "reason not recorded"} — human authorization required
          {o.kill_switch && <span className="halt-ks"> · KILL SWITCH ENGAGED</span>}
        </div>
      )}
      {error && !o && <div className="alert alert-red">Overview unavailable: {error}</div>}
      {o && !o.has_data && (
        <div className="alert alert-amber">No account state recorded yet for this mode — the engine has not written any data.</div>
      )}
      <div className="kpis" data-testid="kpis">
        {kpis.map((k) => (
          <div className="kpi" key={k.label}>
            <div className="kpi-label">{k.label}</div>
            <div className={`kpi-value num ${k.cls ?? ""}`}>{k.value}</div>
            {k.sub && <div className="kpi-sub num">{k.sub}</div>}
          </div>
        ))}
      </div>
      <div className="kpi-meta muted small">
        Snapshot {fmtTime(o?.timestamp)} · engine heartbeat age {fmtAge(o?.engine_heartbeat_age_s)}
        {error && o ? <span className="neg"> · last refresh failed: {error}</span> : null}
      </div>
    </section>
  );
}
