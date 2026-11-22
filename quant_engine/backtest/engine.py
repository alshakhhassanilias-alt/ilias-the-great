"""Event-driven backtesting engine.

Per clock bar ``i`` (close time ``t_i``, open time ``t_i - tf``) events are processed in this
order, which is the only order consistent with information availability:

1. **Pending orders** (decided at close ``t_{i-1}``) execute at bar ``i``'s open via the
   execution simulator (spread, slippage, latency, partial fills, rejections, fees).
2. **Funding** settlements whose timestamp falls in ``(open_i, close_i]``.
3. **Protective orders** are checked against bar ``i``'s high/low.  Gaps fill at the open;
   if stop and take-profit are both inside the range the stop is assumed first.  Trailing
   stops are ratcheted *after* the check with the completed bar's extreme.
4. **Mark-to-market** at ``close_i``; worst-case intrabar liquidation check when leveraged.
5. **Circuit breakers** (when enforced): halt, cancel pending entries, flatten next bar.
6. **Signals** at ``close_i`` -> RiskManager -> orders queued for bar ``i+1``.

Strategies cannot place orders; only risk-approved decisions become orders.
At the end of the window all positions are closed at the last close with taker costs.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from quant_engine.backtest.execution_simulator import Bar, ExecutionSimulator
from quant_engine.config.settings import BacktestConfig, RiskConfig
from quant_engine.core.accounting import ClosedTrade, Ledger
from quant_engine.core.types import Direction, Fill, OrderIntent, Side, Signal, timeframe_delta
from quant_engine.risk.circuit_breaker import BreakerAction, RiskEvent, RiskState
from quant_engine.risk.limits import PortfolioView
from quant_engine.risk.manager import RiskManager
from quant_engine.risk.position_sizing import KellyEstimate
from quant_engine.risk.stops import update_trailing_stop


@dataclass
class StrategyRun:
    strategy_id: str
    timeframe: str
    frames: dict[str, pd.DataFrame]
    weight: float | dict[str, np.ndarray] = 1.0  # constant, or per-symbol array aligned to the clock
    kelly: KellyEstimate | None = None
    risk_fraction: float | None = None


@dataclass
class BacktestResult:
    equity: pd.Series
    gross_exposure: pd.Series
    trades: pd.DataFrame
    risk_events: list[RiskEvent]
    stats: dict[str, Any]
    initial_capital: float
    clock_tf: str

    @property
    def returns(self) -> pd.Series:
        return self.equity.pct_change().fillna(0.0)


@dataclass
class _Pending:
    strategy_id: str
    symbol: str
    side: Side
    qty: float | None  # None -> close whole position at fill time
    intent: OrderIntent
    stop: float | None = None
    tp: float | None = None
    trail: float | None = None
    hold: pd.Timedelta | None = None
    signal_id: str | None = None
    reason: str = ""


@dataclass
class _SymbolArrays:
    o: np.ndarray
    h: np.ndarray
    lo: np.ndarray
    c: np.ndarray
    v: np.ndarray
    sigma_bps: np.ndarray  # decision-time (lagged) per-bar volatility in bps
    atr: np.ndarray
    funding_times: np.ndarray = field(default_factory=lambda: np.array([], dtype="int64"))
    funding_rates: np.ndarray = field(default_factory=lambda: np.array([], dtype=float))


def _trades_frame(trades: list[ClosedTrade]) -> pd.DataFrame:
    cols = ["trade_id", "strategy_id", "symbol", "direction", "quantity", "entry_price", "exit_price",
            "entry_time", "exit_time", "pnl", "gross_pnl", "fees", "funding", "exit_reason"]
    if not trades:
        return pd.DataFrame(columns=cols)
    return pd.DataFrame([{c: getattr(t, c) for c in cols} for t in trades])


class BacktestEngine:
    def __init__(
        self,
        bt_cfg: BacktestConfig,
        risk_cfg: RiskConfig,
        clock_tf: str,
        bars: dict[str, pd.DataFrame],
        funding: dict[str, pd.DataFrame] | None = None,
        *,
        enforce_circuit_breakers: bool = True,
        cost_multiplier: float = 1.0,
        slippage_multiplier: float = 1.0,
        seed: int | None = None,
        initial_capital: float | None = None,
    ) -> None:
        self.bt = bt_cfg
        self.risk_cfg = risk_cfg
        self.clock_tf = clock_tf
        self.step = timeframe_delta(clock_tf)
        self.enforce = enforce_circuit_breakers
        self.capital = initial_capital or bt_cfg.initial_capital
        self.cost_multiplier = cost_multiplier
        self.slippage_multiplier = slippage_multiplier
        self.seed = bt_cfg.seed if seed is None else seed
        idx = None
        for df in bars.values():
            idx = df.index if idx is None else idx.intersection(df.index)
        assert idx is not None
        self.index = idx.sort_values()
        self.symbols = list(bars)
        self.arr: dict[str, _SymbolArrays] = {}
        for s, df in bars.items():
            d = df.reindex(self.index)
            lr = np.log(d["close"]).diff()
            sigma = (lr.rolling(96, min_periods=20).std().shift(1) * 1e4).to_numpy()
            tr = pd.concat([d["high"] - d["low"], (d["high"] - d["close"].shift()).abs(),
                            (d["low"] - d["close"].shift()).abs()], axis=1).max(axis=1)
            atr = tr.ewm(alpha=1 / 14, adjust=False, min_periods=14).mean().to_numpy()
            sa = _SymbolArrays(d["open"].to_numpy(), d["high"].to_numpy(), d["low"].to_numpy(),
                               d["close"].to_numpy(), d["volume"].to_numpy(), sigma, atr)
            f = (funding or {}).get(s)
            if f is not None and not f.empty:
                sa.funding_times = f.index.as_unit("ns").asi8
                sa.funding_rates = f["funding_rate"].to_numpy(dtype=float)
            self.arr[s] = sa
        # rolling correlations of clock returns for correlation-aware sizing (lagged one bar)
        rets = pd.DataFrame({s: np.log(bars[s]["close"].reindex(self.index)).diff() for s in self.symbols})
        lb = risk_cfg.exposure.correlation_lookback_bars
        self.corr: dict[tuple[str, str], np.ndarray] = {}
        for a in self.symbols:
            for b in self.symbols:
                if a < b:
                    cc = rets[a].rolling(lb, min_periods=max(lb // 4, 20)).corr(rets[b]).shift(1).to_numpy()
                    self.corr[(a, b)] = cc
                    self.corr[(b, a)] = cc

    # ------------------------------------------------------------------ main loop
    def run(self, runs: list[StrategyRun], start: pd.Timestamp | None = None,
            end: pd.Timestamp | None = None, risk_state: RiskState | None = None) -> BacktestResult:
        idx = self.index
        i0 = 0 if start is None else int(idx.searchsorted(start, side="left"))
        i1 = len(idx) if end is None else int(idx.searchsorted(end, side="right"))
        if i1 - i0 < 2:
            raise ValueError("backtest window too short")
        bar_minutes = self.step / pd.Timedelta(minutes=1)
        sim = ExecutionSimulator(self.bt.costs, np.random.default_rng(self.seed), bar_minutes,
                                 self.cost_multiplier, self.slippage_multiplier)
        ledger = Ledger(cash=self.capital)
        events: list[RiskEvent] = []
        rm = RiskManager(self.risk_cfg, risk_state or RiskState(), on_event=events.append)

        # ---- schedule actionable signal rows on the clock
        schedule: dict[int, list[tuple[int, str, Any]]] = {}
        for r_i, run in enumerate(runs):
            for sym, fr in run.frames.items():
                if sym not in self.arr:
                    continue
                act = fr[(fr["entry"] != 0) | fr["exit_long"].astype(bool) | fr["exit_short"].astype(bool)]
                act = act.loc[(act.index >= idx[i0]) & (act.index <= idx[i1 - 1])]
                pos_idx = idx.get_indexer(act.index)
                for k, row in zip(pos_idx, act.itertuples(), strict=True):
                    if k >= 0:
                        schedule.setdefault(int(k), []).append((r_i, sym, row))
        weights_cache: dict[int, Callable[[str, int], float]] = {}
        for r_i, run in enumerate(runs):
            w = run.weight
            if isinstance(w, dict):
                weights_cache[r_i] = (lambda s, i, w=w: float(w[s][i]) if s in w else 0.0)
            else:
                weights_cache[r_i] = (lambda s, i, w=w: float(w))
        run_tf = {r_i: timeframe_delta(r.timeframe) for r_i, r in enumerate(runs)}

        pending: list[_Pending] = []
        eq_vals = np.empty(i1 - i0)
        gross_vals = np.empty(i1 - i0)
        n_signals = n_approved = n_rejected = n_partial = n_exch_reject = n_liq = 0
        reject_reasons: dict[str, int] = {}
        funding_ptr = {s: int(np.searchsorted(a.funding_times, (idx[i0] - self.step).value, side="right"))
                       for s, a in self.arr.items()}
        traded_notional = 0.0

        def bar_of(s: str, i: int) -> Bar:
            a = self.arr[s]
            return Bar(a.o[i], a.h[i], a.lo[i], a.c[i], a.v[i])

        def apply(fill_side: Side, sid: str, sym: str, simfill: Any, ts: pd.Timestamp, intent: OrderIntent,
                  reason: str) -> ClosedTrade | None:
            nonlocal traded_notional
            traded_notional += simfill.quantity * simfill.price
            f = Fill(f"{sid}-{sym}-{ts.value}-{intent.value}", "", sym, fill_side, simfill.quantity,
                     simfill.price, simfill.fee, ts, simfill.liquidity, simfill.slippage_bps, sid, intent)
            return ledger.apply_fill(f, reason)

        last_day = None
        for i in range(i0, i1):
            ts_close = idx[i]
            ts_open = ts_close - self.step
            day = ts_close.normalize() if ts_close.hour or ts_close.minute else (ts_close - self.step).normalize()
            # simulated operator re-authorisation after a *daily* breach (backtest policy only)
            if (self.enforce and self.risk_cfg.circuit_breakers.backtest_resume_after_daily_breach
                    and last_day is not None and day != last_day and rm.state.halted
                    and (rm.state.halt_reason or "").startswith("daily_drawdown") and not ledger.open_positions()):
                rm.breaker.authorize_resume(ts_open.isoformat(), "backtest_simulated_operator")
            last_day = day

            # 1. pending orders at the open (exits first)
            pending.sort(key=lambda p: 0 if p.intent is not OrderIntent.ENTRY else 1)
            carry: list[_Pending] = []
            for p in pending:
                pos = ledger.position(p.strategy_id, p.symbol)
                bar = bar_of(p.symbol, i)
                if not np.isfinite(bar.open):
                    carry.append(p)
                    continue
                if p.intent is OrderIntent.ENTRY:
                    if rm.state.halted:
                        continue  # cancelled by halt
                    res = sim.fill_market(p.symbol, p.side, float(p.qty or 0), bar, self.arr[p.symbol].sigma_bps[i])
                    if res.fill is None:
                        n_exch_reject += 1
                        continue
                    if res.remaining > 1e-12:
                        n_partial += 1  # entry remainder cancelled
                    apply(p.side, p.strategy_id, p.symbol, res.fill, ts_open, OrderIntent.ENTRY, "")
                    pos.stop_loss, pos.take_profit, pos.trailing_stop_distance = p.stop, p.tp, p.trail
                    pos.highest_price = pos.lowest_price = res.fill.price
                    pos.entry_signal_id = p.signal_id
                    pos.max_hold_until = ts_open + p.hold if p.hold is not None else None
                else:
                    q = abs(pos.quantity)
                    if q <= 1e-12:
                        continue
                    side = Side.SELL if pos.quantity > 0 else Side.BUY
                    res = sim.fill_market(p.symbol, side, q, bar, self.arr[p.symbol].sigma_bps[i])
                    if res.fill is None:
                        carry.append(p)  # exits are retried
                        n_exch_reject += 1
                        continue
                    apply(side, p.strategy_id, p.symbol, res.fill, ts_open, p.intent, p.reason)
                    if res.remaining > 1e-12:
                        n_partial += 1
                        carry.append(p)
            pending = carry

            # 2. funding settlements in (open, close]
            for s, a in self.arr.items():
                ptr = funding_ptr[s]
                while ptr < len(a.funding_times) and a.funding_times[ptr] <= ts_close.value:
                    if a.funding_times[ptr] > ts_open.value:
                        ledger.apply_funding(s, float(a.funding_rates[ptr]), float(a.c[i]))
                    ptr += 1
                funding_ptr[s] = ptr
            if not any(len(a.funding_times) for a in self.arr.values()) and ts_close.hour % 8 == 0 and ts_close.minute == 0:
                # No funding data at all: charge the conservative assumed rate against every position.
                for p in ledger.open_positions():
                    rate = self.bt.costs.unknown_funding_rate_8h * np.sign(p.quantity)
                    ledger.apply_funding(p.symbol, float(rate), float(self.arr[p.symbol].c[i]))

            # 3. protective orders on this bar's range
            for p in list(ledger.open_positions()):
                bar = bar_of(p.symbol, i)
                if not np.isfinite(bar.high):
                    continue
                exit_side = Side.SELL if p.quantity > 0 else Side.BUY
                q = abs(p.quantity)
                done = False
                if p.stop_loss is not None:
                    ref = sim.stop_trigger_price(exit_side, p.stop_loss, bar)
                    if ref is not None:
                        f = sim.fill_stop(p.symbol, exit_side, q, ref, bar, self.arr[p.symbol].sigma_bps[i])
                        apply(exit_side, p.strategy_id, p.symbol, f, ts_close, OrderIntent.STOP_LOSS, "stop_loss")
                        done = True
                if not done and p.take_profit is not None and sim.take_profit_hit(exit_side, p.take_profit, bar):
                    f = sim.fill_take_profit(q, p.take_profit)
                    apply(exit_side, p.strategy_id, p.symbol, f, ts_close, OrderIntent.TAKE_PROFIT, "take_profit")
                    done = True
                if not done:
                    update_trailing_stop(p, bar.high, bar.low)
                    if p.max_hold_until is not None and ts_close >= p.max_hold_until:
                        if not any(x.strategy_id == p.strategy_id and x.symbol == p.symbol and x.intent is not OrderIntent.ENTRY
                                   for x in pending):
                            pending.append(_Pending(p.strategy_id, p.symbol, exit_side, None, OrderIntent.EXIT,
                                                    reason="time_stop"))

            # 4. mark to market + liquidation check
            marks = {s: float(a.c[i]) for s, a in self.arr.items() if np.isfinite(a.c[i])}
            equity = ledger.equity(marks)
            gross = ledger.gross_exposure(marks)
            if gross > 0:
                worst = {s: (float(self.arr[s].lo[i]) if ledger.symbol_exposure(s, 1.0) > 0 else float(self.arr[s].h[i]))
                         for s in marks}
                eq_worst = ledger.equity(worst)
                if eq_worst < self.bt.costs.maintenance_margin_rate * ledger.gross_exposure(worst):
                    n_liq += 1
                    for p in list(ledger.open_positions()):
                        side = Side.SELL if p.quantity > 0 else Side.BUY
                        f = sim.fill_stop(p.symbol, side, abs(p.quantity), worst[p.symbol], bar_of(p.symbol, i),
                                          self.arr[p.symbol].sigma_bps[i])
                        apply(side, p.strategy_id, p.symbol, f, ts_close, OrderIntent.FLATTEN, "liquidation")
                    events.append(RiskEvent(ts_close.isoformat(), "CRITICAL", "liquidation",
                                            "simulated liquidation", BreakerAction.HALT_AND_FLATTEN))
                    equity = ledger.equity(marks)
                    gross = 0.0
            eq_vals[i - i0] = equity
            gross_vals[i - i0] = gross / equity if equity > 0 else np.nan

            # 5. circuit breakers
            if self.enforce:
                for ev in rm.on_equity(ts_close, equity):
                    if ev.action is BreakerAction.HALT_AND_FLATTEN:
                        pending = [p for p in pending if p.intent is not OrderIntent.ENTRY]
                        for p in ledger.open_positions():
                            pending.append(_Pending(p.strategy_id, p.symbol,
                                                    Side.SELL if p.quantity > 0 else Side.BUY, None,
                                                    OrderIntent.FLATTEN, reason="circuit_breaker"))

            # 6. signals at the close -> risk -> orders for next bar
            if i == i1 - 1:
                break
            for r_i, sym, row in schedule.get(i, ()):
                run = runs[r_i]
                pos = ledger.position(run.strategy_id, sym)
                has_pending_exit = any(x.strategy_id == run.strategy_id and x.symbol == sym
                                       and x.intent is not OrderIntent.ENTRY for x in pending)
                if ((row.exit_long and pos.quantity > 0) or (row.exit_short and pos.quantity < 0)) and not has_pending_exit:
                    pending.append(_Pending(run.strategy_id, sym, Side.SELL if pos.quantity > 0 else Side.BUY, None,
                                            OrderIntent.EXIT, reason="strategy_exit"))
                    has_pending_exit = True
                e = int(row.entry)
                if e == 0:
                    continue
                n_signals += 1
                cur_dir = int(np.sign(pos.quantity))
                if cur_dir == e and not has_pending_exit:
                    continue  # already positioned; no pyramiding
                if any(x.strategy_id == run.strategy_id and x.symbol == sym and x.intent is OrderIntent.ENTRY
                       for x in pending):
                    continue
                if cur_dir == -e and not has_pending_exit:
                    pending.append(_Pending(run.strategy_id, sym, Side.SELL if cur_dir > 0 else Side.BUY, None,
                                            OrderIntent.EXIT, reason="reverse"))
                price = float(row.close)
                stop = price - e * float(row.stop_dist)
                tp = price + e * float(row.tp_dist) if np.isfinite(row.tp_dist) else None
                trail = float(row.trail_dist) if np.isfinite(row.trail_dist) else None
                sig = Signal(run.strategy_id, sym, ts_close, Direction(e), price, stop, tp, float(row.confidence),
                             int(row.hold_bars), run.risk_fraction or self.risk_cfg.sizing.risk_per_trade,
                             run.timeframe, trailing_stop_distance=trail)
                exiting = {(x.strategy_id, x.symbol) for x in pending if x.intent is not OrderIntent.ENTRY}
                view_positions = [(p.strategy_id, p.symbol, p.quantity) for p in ledger.open_positions()
                                  if (p.strategy_id, p.symbol) not in exiting]
                view_positions += [(x.strategy_id, x.symbol, (x.qty or 0) * x.side.sign) for x in pending
                                   if x.intent is OrderIntent.ENTRY]
                view = PortfolioView(equity, marks, view_positions)
                w = weights_cache[r_i](sym, i)
                dec = rm.evaluate(sig, view, atr=float(self.arr[sym].atr[i]), weight=w,
                                  corr_fn=lambda a, b, i=i: float(self.corr[(a, b)][i]) if (a, b) in self.corr else None,
                                  kelly=run.kelly)
                if dec.approved:
                    n_approved += 1
                    hold = run_tf[r_i] * int(row.hold_bars) if int(row.hold_bars) > 0 else None
                    pending.append(_Pending(run.strategy_id, sym, Side.BUY if e > 0 else Side.SELL, dec.quantity,
                                            OrderIntent.ENTRY, dec.stop_loss, dec.take_profit, trail, hold,
                                            sig.signal_id))
                else:
                    n_rejected += 1
                    for rr in dec.reasons:
                        key = rr.split(":")[0]
                        reject_reasons[key] = reject_reasons.get(key, 0) + 1

        # end of window: close everything at the last close with taker costs
        last = i1 - 1
        for p in list(ledger.open_positions()):
            side = Side.SELL if p.quantity > 0 else Side.BUY
            a = self.arr[p.symbol]
            bar = Bar(a.c[last], a.c[last], a.c[last], a.c[last], a.v[last])
            res = sim.fill_market(p.symbol, side, abs(p.quantity), bar, a.sigma_bps[last], allow_partial=False)
            if res.fill is not None:
                apply(side, p.strategy_id, p.symbol, res.fill, idx[last], OrderIntent.EXIT, "end_of_window")
        marks = {s: float(a.c[last]) for s, a in self.arr.items()}
        eq_vals[-1] = ledger.equity(marks)

        eq = pd.Series(eq_vals, index=idx[i0:i1], name="equity")
        stats = {
            "signals": n_signals, "approved": n_approved, "rejected": n_rejected,
            "reject_reasons": reject_reasons, "partial_fills": n_partial, "exchange_rejections": n_exch_reject,
            "liquidations": n_liq, "fees": ledger.total_fees, "funding": ledger.total_funding,
            "slippage_cost": ledger.total_slippage_cost, "traded_notional": traded_notional,
            "halted_at_end": rm.state.halted, "breaches": dict(rm.state.breach_count),
            "cost_multiplier": self.cost_multiplier, "slippage_multiplier": self.slippage_multiplier,
        }
        return BacktestResult(eq, pd.Series(gross_vals, index=eq.index, name="gross_exposure"),
                              _trades_frame(ledger.closed_trades), events, stats, self.capital, self.clock_tf)
