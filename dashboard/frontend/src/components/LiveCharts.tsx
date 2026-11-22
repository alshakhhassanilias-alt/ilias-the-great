import { useMemo } from "react";
import type { EquityPoint } from "../types";
import { fmtMoney, fmtNum, fmtPct, toNum } from "../format";
import { C, Chart, ChartEmpty } from "./Chart";

const BUCKET_MS = 5 * 60 * 1000; // 5-minute resample
const PERIODS_PER_YEAR = (365 * 24 * 60 * 60 * 1000) / BUCKET_MS; // crypto trades 24/7
const ROLL_WINDOW = 288; // 24h of 5-minute returns
const MIN_RETURNS = 30;

interface Series {
  x: string[];
  y: (number | null)[];
}

function equitySeries(points: EquityPoint[]): Series {
  const x: string[] = [];
  const y: (number | null)[] = [];
  for (const p of points) {
    const e = toNum(p.equity);
    if (e === null || !p.timestamp) continue;
    x.push(p.timestamp);
    y.push(e);
  }
  return { x, y };
}

function drawdownSeries(points: EquityPoint[]): Series {
  const x: string[] = [];
  const y: (number | null)[] = [];
  let peak = -Infinity;
  for (const p of points) {
    if (!p.timestamp) continue;
    const e = toNum(p.equity);
    if (e !== null) peak = Math.max(peak, e);
    const d = toNum(p.drawdown);
    // prefer the engine's recorded drawdown; otherwise derive it from the recorded equity high-water mark
    const dd = d !== null ? d : e !== null && peak > 0 ? 1 - e / peak : null;
    x.push(p.timestamp);
    y.push(dd === null ? null : -Math.abs(dd) * 100);
  }
  return { x, y };
}

/** Resample equity to 5-minute buckets (last value per bucket) and compute a rolling annualised Sharpe. */
function rollingSharpe(points: EquityPoint[]): { series: Series; nReturns: number; latest: number | null } {
  const buckets = new Map<number, { t: number; e: number }>();
  for (const p of points) {
    const e = toNum(p.equity);
    const t = Date.parse(p.timestamp);
    if (e === null || e <= 0 || Number.isNaN(t)) continue;
    const b = Math.floor(t / BUCKET_MS);
    buckets.set(b, { t: (b + 1) * BUCKET_MS, e });
  }
  const bars = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  const rets: { t: number; r: number }[] = [];
  for (let i = 1; i < bars.length; i++) rets.push({ t: bars[i].t, r: bars[i].e / bars[i - 1].e - 1 });
  const x: string[] = [];
  const y: (number | null)[] = [];
  if (rets.length < MIN_RETURNS) return { series: { x, y }, nReturns: rets.length, latest: null };
  for (let i = MIN_RETURNS - 1; i < rets.length; i++) {
    const start = Math.max(0, i - ROLL_WINDOW + 1);
    const n = i - start + 1;
    let sum = 0;
    for (let j = start; j <= i; j++) sum += rets[j].r;
    const mean = sum / n;
    let ss = 0;
    for (let j = start; j <= i; j++) ss += (rets[j].r - mean) ** 2;
    const sd = Math.sqrt(ss / (n - 1));
    x.push(new Date(rets[i].t).toISOString());
    y.push(sd > 0 ? (mean / sd) * Math.sqrt(PERIODS_PER_YEAR) : null);
  }
  return { series: { x, y }, nReturns: rets.length, latest: y.length ? y[y.length - 1] : null };
}

export default function LiveCharts({ equity, error, mode }: { equity: EquityPoint[] | null; error: string | null; mode: string }) {
  const pts = useMemo(() => equity ?? [], [equity]);
  const eq = useMemo(() => equitySeries(pts), [pts]);
  const dd = useMemo(() => drawdownSeries(pts), [pts]);
  const rs = useMemo(() => rollingSharpe(pts), [pts]);
  const loading = equity === null && !error;
  const modeLabel = mode ? mode.toUpperCase() : "LIVE";

  const last = eq.y.length ? eq.y[eq.y.length - 1] : null;
  const first = eq.y.length ? eq.y[0] : null;
  const ddNow = dd.y.length ? dd.y[dd.y.length - 1] : null;
  const ddMin = dd.y.reduce<number | null>((m, v) => (v === null ? m : m === null ? v : Math.min(m, v)), null);

  const emptyMsg = loading ? "Loading equity history…" : error && !equity ? `Equity history unavailable: ${error}` : "No equity history yet";

  return (
    <section className="panel" aria-label="Live performance">
      <div className="panel-head">
        <h2>Live performance · {modeLabel} account</h2>
        <span className="muted small num">
          {eq.y.length ? `${eq.y.length.toLocaleString("en-US")} snapshots` : ""}
          {last !== null && first !== null && first > 0 ? ` · since first snapshot ${fmtPct(last / first - 1, { sign: true })}` : ""}
        </span>
      </div>
      <div className="mini-stats">
        <div>
          <span>Equity</span>
          <b className="num">{fmtMoney(last)}</b>
        </div>
        <div>
          <span>Drawdown now</span>
          <b className="num">{ddNow === null ? "—" : `${fmtNum(ddNow)}%`}</b>
        </div>
        <div>
          <span>Max drawdown (window)</span>
          <b className="num">{ddMin === null ? "—" : `${fmtNum(ddMin)}%`}</b>
        </div>
        <div>
          <span>Rolling Sharpe (24h)</span>
          <b className="num">{rs.latest === null ? "—" : fmtNum(rs.latest)}</b>
        </div>
      </div>
      {eq.x.length === 0 ? (
        <ChartEmpty title="Equity curve (real-time)" message={emptyMsg} testId="equity-chart" height={320} />
      ) : (
        <Chart
          testId="equity-chart"
          title="Equity curve (real-time)"
          xTitle="Time (UTC)"
          yTitle="Equity (USD)"
          height={320}
          yaxis={{ tickprefix: "$", tickformat: ",.0f" }}
          data={[
            {
              type: "scatter",
              mode: "lines",
              name: "Equity",
              x: eq.x,
              y: eq.y,
              line: { color: C.blue, width: 1.6 },
              hovertemplate: "%{y:$,.2f}<extra>Equity</extra>",
            },
          ]}
        />
      )}
      <div className="grid-2">
        {dd.x.length === 0 ? (
          <ChartEmpty title="Underwater (drawdown)" message={emptyMsg} testId="drawdown-chart" height={260} />
        ) : (
          <Chart
            testId="drawdown-chart"
            title="Underwater (drawdown from peak)"
            xTitle="Time (UTC)"
            yTitle="Drawdown (%)"
            height={260}
            yaxis={{ ticksuffix: "%", rangemode: "tozero" }}
            data={[
              {
                type: "scatter",
                mode: "lines",
                name: "Drawdown",
                x: dd.x,
                y: dd.y,
                fill: "tozeroy",
                fillcolor: "rgba(248,81,73,0.25)",
                line: { color: C.red, width: 1.2 },
                connectgaps: false,
                hovertemplate: "%{y:.2f}%<extra>Drawdown</extra>",
              },
            ]}
          />
        )}
        {rs.series.x.length === 0 ? (
          <ChartEmpty
            title="Rolling Sharpe (live, 5-min returns)"
            testId="live-sharpe-chart"
            height={260}
            message={
              eq.x.length === 0
                ? emptyMsg
                : `Insufficient live history: ${rs.nReturns} five-minute returns available, at least ${MIN_RETURNS} needed for a meaningful Sharpe estimate.`
            }
          />
        ) : (
          <Chart
            testId="live-sharpe-chart"
            title="Rolling Sharpe (live, annualised)"
            xTitle="Time (UTC)"
            yTitle="Sharpe ratio"
            height={260}
            data={[
              {
                type: "scatter",
                mode: "lines",
                name: "Rolling Sharpe",
                x: rs.series.x,
                y: rs.series.y,
                line: { color: C.amber, width: 1.4 },
                hovertemplate: "%{y:.2f}<extra>Sharpe</extra>",
              },
            ]}
            note={
              <>
                5-minute resampled returns, rolling {ROLL_WINDOW}-bar (24h) window, annualised ×√{Math.round(PERIODS_PER_YEAR).toLocaleString("en-US")}.
                {rs.nReturns < ROLL_WINDOW ? ` Only ${rs.nReturns} returns so far — early values are very noisy.` : ""}
              </>
            }
          />
        )}
      </div>
    </section>
  );
}
