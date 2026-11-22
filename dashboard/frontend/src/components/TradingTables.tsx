import { useEffect, useMemo, useState } from "react";
import type { Order, Position, RegimeResponse, StrategyRow, Trade } from "../types";
import type { Loadable } from "../useDashboard";
import { DASH, fmtInt, fmtMoney, fmtNum, fmtPct, fmtPrice, fmtQty, fmtTime, pnlClass, toNum } from "../format";
import { Tag, ValidationBadge } from "./Badges";
import { LoadState, Pager, Table, type Column } from "./Table";

function Dir({ d }: { d: unknown }) {
  const s = typeof d === "number" ? (d > 0 ? "LONG" : d < 0 ? "SHORT" : "FLAT") : String(d ?? DASH).toUpperCase();
  const cls = s === "LONG" || s === "BUY" ? "pos" : s === "SHORT" || s === "SELL" ? "neg" : "";
  return <span className={`dir ${cls}`}>{s}</span>;
}

export function PositionsPanel({ positions }: { positions: Loadable<Position[]> }) {
  const rows = positions.data ?? [];
  const totalUpnl = rows.reduce<number | null>((s, p) => {
    const v = toNum(p.unrealized_pnl);
    return v === null ? s : (s ?? 0) + v;
  }, null);
  const totalNotional = rows.reduce((s, p) => s + (toNum(p.notional) ?? 0), 0);
  const cols: Column<Position>[] = [
    {
      key: "symbol",
      header: "Symbol",
      render: (p) => (
        <span className="nowrap">
          <b>{p.symbol}</b> {p.diagnostic && <Tag tone="purple">DIAGNOSTIC PROBE</Tag>}
        </span>
      ),
    },
    { key: "strategy", header: "Strategy", render: (p) => p.strategy_id || DASH },
    { key: "dir", header: "Side", render: (p) => <Dir d={p.direction} /> },
    { key: "qty", header: "Qty", align: "right", render: (p) => fmtQty(p.quantity) },
    { key: "entry", header: "Avg entry", align: "right", render: (p) => fmtPrice(p.avg_entry_price) },
    { key: "mark", header: "Mark", align: "right", render: (p) => fmtPrice(p.current_price) },
    { key: "sl", header: "Stop", align: "right", render: (p) => fmtPrice(p.stop_loss) },
    { key: "tp", header: "Take profit", align: "right", render: (p) => fmtPrice(p.take_profit) },
    { key: "upnl", header: "Unreal. P&L", align: "right", render: (p) => <span className={pnlClass(p.unrealized_pnl)}>{fmtMoney(p.unrealized_pnl, { sign: true })}</span> },
    { key: "notional", header: "Notional", align: "right", render: (p) => fmtMoney(p.notional) },
    { key: "opened", header: "Opened (UTC)", render: (p) => <span className="nowrap">{fmtTime(p.opened_at)}</span> },
  ];
  return (
    <section className="panel" aria-label="Open positions">
      <div className="panel-head">
        <h2>Open positions</h2>
        <span className="muted small num">
          {rows.length} open · notional {fmtMoney(rows.length ? totalNotional : null)} · uPnL{" "}
          <span className={pnlClass(totalUpnl)}>{fmtMoney(totalUpnl, { sign: true })}</span>
        </span>
      </div>
      <LoadState loading={positions.data === null && !positions.error} error={positions.error}>
        <Table
          testId="positions-table"
          columns={cols}
          rows={rows}
          rowKey={(p, i) => `${p.symbol}-${p.strategy_id}-${i}`}
          rowClass={(p) => (p.diagnostic ? "row-diagnostic" : undefined)}
          empty="No open positions"
        />
      </LoadState>
    </section>
  );
}

export function StrategiesPanel({ strategies }: { strategies: Loadable<StrategyRow[]> }) {
  const rows = strategies.data ?? [];
  const cols: Column<StrategyRow>[] = [
    { key: "id", header: "Strategy", render: (s) => <b className="nowrap">{s.strategy_id}</b> },
    { key: "tf", header: "TF", render: (s) => s.timeframe ?? DASH },
    { key: "status", header: "Validation", render: (s) => <ValidationBadge status={s.validation_status} /> },
    { key: "lw", header: "Live wt", align: "right", render: (s) => fmtPct(s.live_weight) },
    { key: "mw", header: "Max wt", align: "right", render: (s) => fmtPct(s.max_weight) },
    { key: "sh", header: "OOS Sharpe", align: "right", render: (s) => fmtNum(s.oos_sharpe) },
    { key: "ret", header: "OOS return", align: "right", render: (s) => <span className={pnlClass(s.oos_net_return)}>{fmtPct(s.oos_net_return, { sign: true })}</span> },
    { key: "mdd", header: "OOS max DD", align: "right", render: (s) => fmtPct(s.oos_max_drawdown) },
    { key: "tr", header: "OOS trades", align: "right", render: (s) => fmtInt(s.oos_trades) },
    { key: "dsr", header: "DSR", align: "right", title: "Deflated Sharpe ratio (probability)", render: (s) => fmtNum(s.dsr) },
    { key: "pbo", header: "PBO", align: "right", title: "Probability of backtest overfitting", render: (s) => fmtNum(s.pbo) },
    { key: "sig", header: "Last signal (UTC)", render: (s) => <span className="nowrap">{fmtTime(s.last_signal_ts)}</span> },
  ];
  return (
    <section className="panel" aria-label="Strategies">
      <div className="panel-head">
        <h2>Active strategies · weights &amp; validation</h2>
        <span className="muted small">OOS metrics are walk-forward out-of-sample</span>
      </div>
      <LoadState loading={strategies.data === null && !strategies.error} error={strategies.error}>
        <Table testId="strategies-table" columns={cols} rows={rows} rowKey={(s) => s.strategy_id} empty="No strategies configured" />
      </LoadState>
    </section>
  );
}

const REGIME_TONE: Record<string, "green" | "red" | "amber" | "blue" | "grey" | "purple"> = {
  trending_bull: "green",
  bull: "green",
  trending_bear: "red",
  bear: "red",
  high_volatility: "amber",
  high_vol: "amber",
  crisis: "red",
  ranging: "blue",
  mean_reverting: "blue",
  low_volatility: "purple",
};

function parseRegime(v: unknown): { label: string | null; conf: number | null } {
  if (Array.isArray(v)) return { label: v[0] == null ? null : String(v[0]), conf: toNum(v[1]) };
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return { label: o.regime == null ? null : String(o.regime), conf: toNum(o.confidence) };
  }
  if (typeof v === "string") return { label: v, conf: null };
  return { label: null, conf: null };
}

export function RegimePanel({ regime }: { regime: Loadable<RegimeResponse> }) {
  const entries = Object.entries(regime.data?.regimes ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return (
    <section className="panel" aria-label="Market regime">
      <div className="panel-head">
        <h2>Current regime</h2>
        <span className="muted small">{regime.data?.timestamp ? `as of ${fmtTime(regime.data.timestamp)}` : ""}</span>
      </div>
      <LoadState loading={regime.data === null && !regime.error} error={regime.error}>
        {entries.length === 0 ? (
          <div className="empty">No regime classification available</div>
        ) : (
          <ul className="regimes">
            {entries.map(([sym, v]) => {
              const { label, conf } = parseRegime(v);
              const tone = (label && REGIME_TONE[label.toLowerCase()]) || "grey";
              return (
                <li key={sym}>
                  <span className="regime-sym">{sym}</span>
                  <Tag tone={tone}>{label ? label.replace(/_/g, " ").toUpperCase() : DASH}</Tag>
                  <span className="regime-conf num" title="Classifier confidence">
                    {conf === null ? DASH : fmtPct(conf)}
                  </span>
                  <span className="conf-bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(0, Math.min(1, conf ?? 0)) * 100}%` }} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </LoadState>
    </section>
  );
}

const ORDER_TONE: Record<string, "green" | "red" | "amber" | "blue" | "grey"> = {
  filled: "green",
  open: "blue",
  new: "blue",
  submitted: "blue",
  partially_filled: "amber",
  pending: "amber",
  canceled: "grey",
  cancelled: "grey",
  expired: "grey",
  rejected: "red",
  failed: "red",
};

export function OrdersPanel({ orders }: { orders: Loadable<Order[]> }) {
  const rows = orders.data ?? [];
  const cols: Column<Order>[] = [
    { key: "t", header: "Updated (UTC)", render: (o) => <span className="nowrap">{fmtTime(o.updated_at ?? o.created_at)}</span> },
    { key: "sym", header: "Symbol", render: (o) => <b>{o.symbol}</b> },
    { key: "side", header: "Side", render: (o) => <Dir d={o.side} /> },
    { key: "type", header: "Type", render: (o) => <span className="nowrap">{(o.order_type ?? DASH).toUpperCase()}</span> },
    { key: "intent", header: "Intent", render: (o) => o.intent ?? DASH },
    { key: "strat", header: "Strategy", render: (o) => o.strategy_id ?? DASH },
    { key: "qty", header: "Qty", align: "right", render: (o) => fmtQty(o.quantity) },
    { key: "px", header: "Price", align: "right", render: (o) => fmtPrice(o.price) },
    { key: "stop", header: "Stop", align: "right", render: (o) => fmtPrice(o.stop_price) },
    { key: "filled", header: "Filled", align: "right", render: (o) => fmtQty(o.filled_quantity) },
    { key: "avg", header: "Avg fill", align: "right", render: (o) => fmtPrice(o.avg_fill_price) },
    { key: "fees", header: "Fees", align: "right", render: (o) => fmtMoney(o.fees_paid) },
    {
      key: "status",
      header: "Status",
      render: (o) => (
        <span title={o.reject_reason ?? undefined}>
          <Tag tone={ORDER_TONE[(o.status ?? "").toLowerCase()] ?? "grey"}>{(o.status ?? DASH).toUpperCase()}</Tag>
          {o.reject_reason ? <span className="neg small"> {o.reject_reason}</span> : null}
        </span>
      ),
    },
    { key: "id", header: "Client order ID", render: (o) => <span className="mono-id">{o.client_order_id}</span> },
  ];
  return (
    <section className="panel" aria-label="Recent orders">
      <div className="panel-head">
        <h2>Recent orders</h2>
        <span className="muted small num">last {rows.length} (max 100)</span>
      </div>
      <LoadState loading={orders.data === null && !orders.error} error={orders.error}>
        <div className="table-scroll-y">
          <Table testId="orders-table" columns={cols} rows={rows} rowKey={(o, i) => `${o.client_order_id}-${i}`} empty="No orders yet" />
        </div>
      </LoadState>
    </section>
  );
}

const PAGE = 25;

export function TradesPanel({ trades }: { trades: Loadable<Trade[]> }) {
  const rows = useMemo(() => trades.data ?? [], [trades.data]);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  useEffect(() => {
    if (page > pages - 1) setPage(pages - 1);
  }, [page, pages]);
  const stats = useMemo(() => {
    let net = 0;
    let fees = 0;
    let wins = 0;
    let n = 0;
    for (const t of rows) {
      const p = toNum(t.pnl);
      if (p === null) continue;
      n++;
      net += p;
      if (p > 0) wins++;
      fees += toNum(t.fees) ?? 0;
    }
    return { n, net: n ? net : null, fees: n ? fees : null, winRate: n ? wins / n : null };
  }, [rows]);
  const cols: Column<Trade>[] = [
    { key: "exit", header: "Exit (UTC)", render: (t) => <span className="nowrap">{fmtTime(t.exit_time)}</span> },
    { key: "sym", header: "Symbol", render: (t) => <b>{t.symbol}</b> },
    { key: "strat", header: "Strategy", render: (t) => t.strategy_id ?? DASH },
    { key: "dir", header: "Side", render: (t) => <Dir d={t.direction} /> },
    { key: "qty", header: "Qty", align: "right", render: (t) => fmtQty(t.quantity) },
    { key: "entry", header: "Entry", align: "right", render: (t) => fmtPrice(t.entry_price) },
    { key: "exitp", header: "Exit", align: "right", render: (t) => fmtPrice(t.exit_price) },
    { key: "pnl", header: "P&L", align: "right", render: (t) => <span className={pnlClass(t.pnl)}>{fmtMoney(t.pnl, { sign: true })}</span> },
    { key: "fees", header: "Fees", align: "right", render: (t) => fmtMoney(t.fees) },
    { key: "fund", header: "Funding", align: "right", render: (t) => fmtMoney(t.funding, { sign: true }) },
    { key: "reason", header: "Exit reason", render: (t) => t.exit_reason ?? DASH },
    { key: "entryt", header: "Entry (UTC)", render: (t) => <span className="nowrap">{fmtTime(t.entry_time)}</span> },
  ];
  return (
    <section className="panel" aria-label="Trade history">
      <div className="panel-head">
        <h2>Trade history</h2>
        <span className="muted small num">
          {stats.n} closed · net <span className={pnlClass(stats.net)}>{fmtMoney(stats.net, { sign: true })}</span> · fees {fmtMoney(stats.fees)} · win rate{" "}
          {fmtPct(stats.winRate)}
        </span>
      </div>
      <LoadState loading={trades.data === null && !trades.error} error={trades.error}>
        <Table
          testId="trades-table"
          columns={cols}
          rows={rows.slice(page * PAGE, page * PAGE + PAGE)}
          rowKey={(t, i) => `${String(t.trade_id)}-${i}`}
          empty="No closed trades yet"
        />
        <Pager page={page} pages={pages} total={rows.length} onPage={setPage} />
      </LoadState>
    </section>
  );
}
