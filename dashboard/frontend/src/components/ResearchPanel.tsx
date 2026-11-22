import { useMemo, type ReactNode } from "react";
import type { MetricMap, ResearchResponse } from "../types";
import type { Loadable } from "../useDashboard";
import { DASH, fmtInt, fmtNum, fmtPct, fmtTime, pnlClass, toNum } from "../format";
import { Tag, ValidationBadge } from "./Badges";
import { C, Chart, ChartEmpty, SERIES } from "./Chart";

const OOS = "OUT-OF-SAMPLE (walk-forward)";

interface Row {
  name: string;
  kind: "strategy" | "portfolio" | "benchmark";
  status: string | null;
  s: MetricMap;
  checks?: Record<string, { passed: boolean; value: unknown; threshold: unknown }>;
}

function ci(s: MetricMap): string {
  const lo = toNum(s.sharpe_ci_lower);
  const hi = toNum(s.sharpe_ci_upper);
  if (lo === null && hi === null) return DASH;
  return `[${fmtNum(lo)}, ${fmtNum(hi)}]`;
}

function styleFor(name: string, i: number): Record<string, unknown> {
  if (name.startsWith("buy_hold")) return { color: "#8b949e", width: 1.3, dash: "dot" };
  if (name.startsWith("portfolio:")) return { color: SERIES[i % SERIES.length], width: 2.6 };
  return { color: SERIES[i % SERIES.length], width: 1.4 };
}

function seriesTraces(index: string[], data: Record<string, (number | null)[]>, scale = 1): Record<string, unknown>[] {
  return Object.entries(data).map(([name, ys], i) => ({
    type: "scatter",
    mode: "lines",
    name: name.replace(/^portfolio:/, "portfolio · ").replace(/^buy_hold_/, "buy & hold "),
    x: index,
    y: scale === 1 ? ys : ys.map((v) => (v === null ? null : v * scale)),
    line: styleFor(name, i),
    connectgaps: false,
    hovertemplate: `%{y:.3f}<extra>${name}</extra>`,
  }));
}

export default function ResearchPanel({ research }: { research: Loadable<ResearchResponse> }) {
  const r = research.data;
  const rows = useMemo<Row[]>(() => {
    if (!r?.available) return [];
    const out: Row[] = [];
    for (const [name, v] of Object.entries(r.strategies ?? {}))
      out.push({ name, kind: "strategy", status: r.promotion?.[name]?.status ?? null, s: v.summary ?? {}, checks: r.promotion?.[name]?.checks });
    for (const [name, v] of Object.entries(r.combined ?? {})) out.push({ name: `portfolio · ${name}`, kind: "portfolio", status: null, s: v.summary ?? {} });
    for (const [name, v] of Object.entries(r.benchmarks?.stitched_oos ?? {})) out.push({ name, kind: "benchmark", status: null, s: v ?? {} });
    return out;
  }, [r]);

  if (!r) {
    return (
      <section className="panel" data-testid="research-panel" aria-label="Research">
        <div className="panel-head">
          <h2>Research · {OOS}</h2>
        </div>
        <div className="empty">{research.error ? `Research results unavailable: ${research.error}` : "Loading research results…"}</div>
      </section>
    );
  }
  if (!r.available) {
    return (
      <section className="panel" data-testid="research-panel" aria-label="Research">
        <div className="panel-head">
          <h2>Research · {OOS}</h2>
        </div>
        <div className="empty">
          No research results available. Run the walk-forward research pipeline to generate validated out-of-sample results.
        </div>
      </section>
    );
  }

  const deployable = r.deployable ?? [];
  const idx = r.series?.index ?? [];
  const curves = r.series?.curves ?? {};
  const rsh = r.series?.rolling_sharpe ?? {};
  const holdRes = Object.entries(r.holdout?.results ?? {});
  const holdBench = Object.entries(r.holdout?.benchmarks ?? {});

  const metricCells = (s: MetricMap): ReactNode[] => [
    <td key="ret" className={`a-right ${pnlClass(s.net_return)}`}>{fmtPct(s.net_return, { sign: true })}</td>,
    <td key="sh" className="a-right">{fmtNum(s.sharpe)}</td>,
    <td key="ci" className="a-right nowrap">{ci(s)}</td>,
    <td key="mdd" className="a-right">{fmtPct(s.max_drawdown)}</td>,
    <td key="tr" className="a-right">{fmtInt(s.total_trades)}</td>,
    <td key="pf" className="a-right">{fmtNum(s.profit_factor)}</td>,
    <td key="wr" className="a-right">{fmtPct(s.win_rate)}</td>,
    <td key="dsr" className="a-right">{fmtNum(s.dsr)}</td>,
    <td key="pbo" className="a-right">{fmtNum(s.pbo)}</td>,
  ];

  return (
    <section className="panel" data-testid="research-panel" aria-label="Research">
      <div className="panel-head">
        <h2>Research · {OOS}</h2>
        <span className="muted small">generated {fmtTime(r.generated_at)}</span>
      </div>
      {deployable.length === 0 ? (
        <div className="alert alert-amber deploy-banner" data-testid="deployable-banner">
          <b>NO VALIDATED DEPLOYABLE STRATEGY</b> — no strategy passed every out-of-sample promotion check and the frozen holdout.
        </div>
      ) : (
        <div className="alert alert-green deploy-banner" data-testid="deployable-banner">
          <b>DEPLOYABLE (promoted):</b> {deployable.join(", ")}
        </div>
      )}
      <div className="research-meta small num">
        <span>
          OOS {r.data?.oos_start?.slice(0, 10) ?? DASH} → {r.data?.oos_end?.slice(0, 10) ?? DASH} ({fmtNum(r.data?.oos_years, 2)} yrs)
        </span>
        <span>
          Holdout {r.data?.holdout_start?.slice(0, 10) ?? DASH} → {r.data?.holdout_end?.slice(0, 10) ?? DASH}
        </span>
        {toNum(r.n_total_trials) !== null && <span>{fmtInt(r.n_total_trials)} trials tested (deflated)</span>}
      </div>

      <div className="grid-2">
        {idx.length && Object.keys(curves).length ? (
          <Chart
            testId="research-equity-chart"
            title="Stitched OOS equity (walk-forward, net of costs)"
            xTitle="Date"
            yTitle="Equity (× initial)"
            height={320}
            data={seriesTraces(idx, curves)}
            note={<>{OOS}. Dotted grey lines are buy &amp; hold benchmarks. Past OOS performance does not guarantee future results.</>}
          />
        ) : (
          <ChartEmpty title="Stitched OOS equity" message="No OOS equity series exported" height={320} />
        )}
        {idx.length && Object.keys(rsh).length ? (
          <Chart
            testId="research-sharpe-chart"
            title="Rolling 90-day Sharpe (OOS, annualised)"
            xTitle="Date"
            yTitle="Sharpe ratio"
            height={320}
            data={seriesTraces(idx, rsh)}
            layout={{ shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: C.border, width: 1 } }] }}
            note={<>{OOS}. 90-day rolling window of daily returns (min 45 observations).</>}
          />
        ) : (
          <ChartEmpty title="Rolling 90-day Sharpe (OOS)" message="No rolling Sharpe series exported" height={320} />
        )}
      </div>

      <h3>Strategy comparison · {OOS}</h3>
      <div className="table-wrap">
        <table className="tbl" data-testid="research-table">
          <thead>
            <tr>
              <th>Strategy</th>
              <th>Status</th>
              <th className="a-right">Net return</th>
              <th className="a-right">Sharpe</th>
              <th className="a-right" title="95% confidence interval of the Sharpe ratio">Sharpe 95% CI</th>
              <th className="a-right">Max DD</th>
              <th className="a-right">Trades</th>
              <th className="a-right">Profit factor</th>
              <th className="a-right">Win rate</th>
              <th className="a-right" title="Deflated Sharpe ratio (probability)">DSR</th>
              <th className="a-right" title="Probability of backtest overfitting">PBO</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="empty-cell">
                  No strategies in research results
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.name} className={row.kind !== "strategy" ? `row-${row.kind}` : undefined}>
                <td className="nowrap">
                  <b>{row.name}</b>
                  {row.checks && (
                    <details className="checks">
                      <summary>checks</summary>
                      <ul>
                        {Object.entries(row.checks).map(([k, c]) => (
                          <li key={k} className={c.passed ? "pos" : "neg"}>
                            {c.passed ? "✓" : "✗"} {k}: {toNum(c.value) !== null ? fmtNum(c.value, 3) : String(c.value ?? DASH)} (threshold{" "}
                            {toNum(c.threshold) !== null ? fmtNum(c.threshold, 3) : String(c.threshold ?? DASH)})
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
                <td>
                  {row.kind === "strategy" ? (
                    <ValidationBadge status={row.status} />
                  ) : row.kind === "portfolio" ? (
                    <Tag tone="blue">PORTFOLIO</Tag>
                  ) : (
                    <Tag>BENCHMARK</Tag>
                  )}
                </td>
                {metricCells(row.s)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(holdRes.length > 0 || holdBench.length > 0) && (
        <>
          <h3>Final holdout · frozen decisions, evaluated once</h3>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Strategy / benchmark</th>
                  <th className="a-right">Net return</th>
                  <th className="a-right">Sharpe</th>
                  <th className="a-right">Max DD</th>
                  <th className="a-right">Trades</th>
                </tr>
              </thead>
              <tbody>
                {holdRes.map(([name, s]) => (
                  <tr key={name}>
                    <td className="nowrap">{name}</td>
                    <td className={`a-right ${pnlClass(s?.net_return)}`}>{fmtPct(s?.net_return, { sign: true })}</td>
                    <td className="a-right">{fmtNum(s?.sharpe)}</td>
                    <td className="a-right">{fmtPct(s?.max_drawdown)}</td>
                    <td className="a-right">{fmtInt(s?.total_trades)}</td>
                  </tr>
                ))}
                {holdBench.map(([name, v]) => (
                  <tr key={`b-${name}`} className="row-benchmark">
                    <td className="nowrap">{name}</td>
                    <td className={`a-right ${pnlClass(v)}`}>{fmtPct(v, { sign: true })}</td>
                    <td className="a-right">{DASH}</td>
                    <td className="a-right">{DASH}</td>
                    <td className="a-right">{DASH}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="disclaimer">
        All research figures are {OOS} results net of modelled costs. Backtested and simulated performance is not indicative of future results.
      </p>
    </section>
  );
}
