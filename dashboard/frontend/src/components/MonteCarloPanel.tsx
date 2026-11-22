import { useEffect, useMemo, useState } from "react";
import type { MonteCarloResponse } from "../types";
import type { Loadable } from "../useDashboard";
import { fmtNum, fmtPct, titleCase, toNum } from "../format";
import { C, Chart, ChartEmpty } from "./Chart";

const DEFAULT_SCENARIO = "block_bootstrap";

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function vline(x: number | null, color: string, label: string, row = 0) {
  if (x === null) return [];
  return [
    {
      shape: { type: "line", xref: "x", yref: "paper", x0: x, x1: x, y0: 0, y1: 1, line: { color, width: 1.2, dash: "dash" } },
      annotation: { x, xref: "x", y: 1 - row * 0.09, yref: "paper", text: label, showarrow: false, font: { size: 10, color }, yanchor: "top", xanchor: "left", bgcolor: "rgba(22,27,34,0.85)" },
    },
  ];
}

export default function MonteCarloPanel({ montecarlo }: { montecarlo: Loadable<MonteCarloResponse> }) {
  const mc = montecarlo.data;
  const scenarios = useMemo(() => {
    const s = new Set<string>([...Object.keys(mc?.summary ?? {}), ...Object.keys(mc?.distributions ?? {})]);
    return [...s];
  }, [mc]);
  const [scenario, setScenario] = useState<string>(DEFAULT_SCENARIO);
  useEffect(() => {
    if (scenarios.length && !scenarios.includes(scenario)) setScenario(scenarios.includes(DEFAULT_SCENARIO) ? DEFAULT_SCENARIO : scenarios[0]);
  }, [scenarios, scenario]);

  const dist = mc?.distributions?.[scenario];
  const terminal = useMemo(() => (dist?.terminal ?? []).filter((v) => Number.isFinite(v)), [dist]);
  const mdd = useMemo(() => (dist?.max_drawdown ?? []).filter((v) => Number.isFinite(v)).map((v) => v * 100), [dist]);
  const tSorted = useMemo(() => [...terminal].sort((a, b) => a - b), [terminal]);
  const dSorted = useMemo(() => [...mdd].sort((a, b) => a - b), [mdd]);
  const sel = mc?.summary?.[scenario];

  const hasAny = !!mc && scenarios.length > 0;
  const qualified = mc?.qualified;

  const termMarks = [...vline(quantile(tSorted, 0.05), C.red, "p05"), ...vline(quantile(tSorted, 0.5), C.text, "median", 1), ...vline(1, C.muted, "break-even", 2)];
  const ddMarks = [...vline(quantile(dSorted, 0.5), C.text, "median"), ...vline(quantile(dSorted, 0.95), C.red, "p95", 1)];

  return (
    <section className="panel" data-testid="montecarlo-panel" aria-label="Monte Carlo">
      <div className="panel-head">
        <h2>Monte Carlo risk simulation</h2>
        {mc?.portfolio && <span className="muted small">portfolio: {mc.portfolio}</span>}
      </div>
      {!mc ? (
        <div className="empty">{montecarlo.error ? `Monte Carlo results unavailable: ${montecarlo.error}` : "Loading Monte Carlo results…"}</div>
      ) : !hasAny ? (
        <div className="empty">No Monte Carlo results available. Run the research pipeline to generate simulations.</div>
      ) : (
        <>
          {qualified === false ? (
            <div className="alert alert-amber" data-testid="mc-not-qualified">
              <b>NOT QUALIFIED — simulated for risk characterisation only</b>
            </div>
          ) : qualified === true ? (
            <div className="alert alert-green">QUALIFIED — simulated from promoted strategies' out-of-sample returns</div>
          ) : null}
          <div className="mc-controls">
            <label className="field-inline">
              <span>Scenario</span>
              <select value={scenario} onChange={(e) => setScenario(e.target.value)} data-testid="mc-scenario">
                {scenarios.map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </select>
            </label>
            {sel?.description && <span className="muted small mc-desc">{sel.description}</span>}
          </div>
          <div className="grid-2">
            {terminal.length ? (
              <Chart
                title="Terminal equity distribution"
                xTitle="Terminal equity (× initial capital)"
                yTitle="Simulated paths"
                height={280}
                layout={{
                  hovermode: "closest",
                  bargap: 0.04,
                  shapes: termMarks.map((m) => m.shape),
                  annotations: termMarks.map((m) => m.annotation),
                }}
                data={[
                  {
                    type: "histogram",
                    name: "Terminal equity",
                    x: terminal,
                    nbinsx: 60,
                    marker: { color: "rgba(88,166,255,0.75)", line: { color: C.blue, width: 0.5 } },
                    hovertemplate: "%{x}<br>%{y} paths<extra></extra>",
                  },
                ]}
              />
            ) : (
              <ChartEmpty title="Terminal equity distribution" message="No distribution exported for this scenario" height={280} />
            )}
            {mdd.length ? (
              <Chart
                title="Max drawdown distribution"
                xTitle="Maximum drawdown (%)"
                yTitle="Simulated paths"
                height={280}
                xaxis={{ ticksuffix: "%" }}
                layout={{
                  hovermode: "closest",
                  bargap: 0.04,
                  shapes: ddMarks.map((m) => m.shape),
                  annotations: ddMarks.map((m) => m.annotation),
                }}
                data={[
                  {
                    type: "histogram",
                    name: "Max drawdown",
                    x: mdd,
                    nbinsx: 60,
                    marker: { color: "rgba(248,81,73,0.7)", line: { color: C.red, width: 0.5 } },
                    hovertemplate: "%{x}%<br>%{y} paths<extra></extra>",
                  },
                ]}
              />
            ) : (
              <ChartEmpty title="Max drawdown distribution" message="No distribution exported for this scenario" height={280} />
            )}
          </div>
          <h3>Scenario summary</h3>
          <div className="table-wrap">
            <table className="tbl" data-testid="mc-table">
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th className="a-right">Terminal p05</th>
                  <th className="a-right">Terminal median</th>
                  <th className="a-right">Terminal p95</th>
                  <th className="a-right">Max DD median</th>
                  <th className="a-right">Max DD p95</th>
                  <th className="a-right">P(loss)</th>
                  <th className="a-right">P(daily DD breach)</th>
                  <th className="a-right">P(total DD breach)</th>
                  <th className="a-right">P(ruin)</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(mc.summary ?? {}).length === 0 && (
                  <tr>
                    <td colSpan={10} className="empty-cell">
                      No scenario summaries
                    </td>
                  </tr>
                )}
                {Object.entries(mc.summary ?? {}).map(([name, s]) => (
                  <tr key={name} className={name === scenario ? "row-selected" : undefined} onClick={() => setScenario(name)}>
                    <td className="nowrap" title={s.description}>
                      {titleCase(name)}
                    </td>
                    <td className="a-right">{toNum(s.terminal_equity_p05) === null ? "—" : `${fmtNum(s.terminal_equity_p05, 3)}×`}</td>
                    <td className="a-right">{toNum(s.terminal_equity_median) === null ? "—" : `${fmtNum(s.terminal_equity_median, 3)}×`}</td>
                    <td className="a-right">{toNum(s.terminal_equity_p95) === null ? "—" : `${fmtNum(s.terminal_equity_p95, 3)}×`}</td>
                    <td className="a-right">{fmtPct(s.max_drawdown_median)}</td>
                    <td className="a-right">{fmtPct(s.max_drawdown_p95)}</td>
                    <td className="a-right">{fmtPct(s.prob_loss)}</td>
                    <td className="a-right">{fmtPct(s.prob_daily_dd_breach)}</td>
                    <td className="a-right">{fmtPct(s.prob_total_dd_breach)}</td>
                    <td className="a-right">{fmtPct(s.prob_ruin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="disclaimer">Simulations are not guarantees of future results.</p>
    </section>
  );
}
