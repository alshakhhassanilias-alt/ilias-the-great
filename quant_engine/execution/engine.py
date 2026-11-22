"""Trading engine (PAPER by default; TESTNET/LIVE only behind the deployment gate).

One ``step()``:

1.  market snapshot (tickers + observed order books); errors -> circuit breaker accounting
2.  health checks (freshness, latency, clock skew, database)
3.  simulated resting-order processing (paper): stops before take-profits, OCO
4.  operator commands from the database queue (kill switch / flatten / cancel / resume)
5.  position management: trailing-stop amendment, time stops, protection verification
6.  pending flatten retries while ``flatten_pending`` (idempotent client ids)
7.  new closed bars -> strategies -> RiskManager -> OrderManager -> broker
8.  mark-to-market -> drawdown circuit breakers -> equity snapshot + heartbeat

Strategies never touch the broker.  Every entry passes the risk engine; every filled entry
gets protective orders which are then *verified* through the broker.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

import numpy as np
import pandas as pd

from quant_engine.config.settings import AppConfig, EnvSettings, TradingMode
from quant_engine.core.accounting import ClosedTrade, Ledger
from quant_engine.core.types import (
    Direction,
    Order,
    OrderIntent,
    OrderStatus,
    OrderType,
    Position,
    Side,
    Signal,
    SystemStatus,
    deterministic_client_order_id,
)
from quant_engine.data.database import integrity_check
from quant_engine.execution.exchange_adapter import Broker, SymbolSnapshot
from quant_engine.execution.order_manager import OrderManager
from quant_engine.execution.paper_broker import PaperBroker
from quant_engine.execution.recovery import RecoveryReport, post_restore_checks, restore_ledger
from quant_engine.execution.state_store import StateStore
from quant_engine.monitoring.alerts import AlertManager
from quant_engine.monitoring.health import HealthSnapshot, classify
from quant_engine.monitoring.metrics import RuntimeMetrics
from quant_engine.regime.allocation import RegimeAllocator, StrategyAllocationSpec, ValidationStatus
from quant_engine.regime.detector import RegimeDetector, RegimeParams
from quant_engine.risk.circuit_breaker import BreakerAction, RiskEvent, RiskState
from quant_engine.risk.kill_switch import run_emergency_procedure
from quant_engine.risk.limits import PortfolioView
from quant_engine.risk.manager import RiskManager
from quant_engine.strategies.base import MarketData, Strategy

log = logging.getLogger(__name__)
PROBE_ID = "diagnostic_probe"


class TradingEngine:
    def __init__(
        self,
        cfg: AppConfig,
        env: EnvSettings,
        mode: TradingMode,
        store: StateStore,
        feed: Any,
        strategies: list[Strategy],
        statuses: dict[str, ValidationStatus],
        broker: Broker | None = None,
        *,
        allow_rejected_in_paper: bool = False,
        diagnostic_probe: bool = False,
        probe_hold_seconds: float = 20.0,
        regime_history: dict[str, pd.DataFrame] | None = None,
        alerts: AlertManager | None = None,
    ) -> None:
        if mode is not TradingMode.PAPER and broker is None:
            raise PermissionError("non-paper modes require an explicitly constructed, gated broker")
        self.cfg, self.env, self.mode, self.store, self.feed = cfg, env, mode, store, feed
        self.metrics = RuntimeMetrics()
        self.alerts = alerts or AlertManager(store, env.alert_webhook_url.get_secret_value())
        self.initial_capital = env.initial_paper_capital
        ledger, self.recovery, risk_state, open_orders = restore_ledger(store, self.initial_capital)
        if not self.recovery.fresh_start:
            acct = store.account_row()
            self.initial_capital = acct["initial_capital"] if acct else self.initial_capital
        self.ledger: Ledger = ledger
        self.risk = RiskManager(cfg.risk, risk_state or RiskState(), persist=store.save_risk_state, on_event=self._on_risk_event)
        self.broker: Broker = broker or PaperBroker(store, cfg.backtest.costs, ledger, self._account_meta)
        if isinstance(self.broker, PaperBroker):
            self.broker.restore_orders(open_orders)
            self.broker.on_trade = self._on_trade
        self.om = OrderManager(self.broker, store, self.risk.breaker, sleep=lambda s: None)
        self.statuses = statuses
        self.allow_rejected = allow_rejected_in_paper and mode is TradingMode.PAPER
        self.strategies = strategies
        self.diagnostic_probe = diagnostic_probe
        self.probe_hold_seconds = probe_hold_seconds
        self._probe_state: dict[str, Any] = {}
        self.snapshots: dict[str, SymbolSnapshot] = {}
        self.recovering = True
        self.connected = False
        self.regimes: dict[str, tuple[str, float]] = {}
        self.regime_detectors: dict[str, RegimeDetector] = {}
        self._regime_history = regime_history or {}
        self.allocator = self._build_allocator()
        self.decisions: list[dict[str, Any]] = []
        self._last_equity_write = 0.0
        self._last_clock_check = 0.0
        self.running = False
        self._startup_updates: dict[str, list[str]] = {}
        self.signal_max_age_fraction = 0.25
        self.step_count = 0
        self.last_health: HealthSnapshot | None = None
        store.save_config_version(cfg.version_hash(), cfg.model_dump(mode="json"))

    # ------------------------------------------------------------------ setup helpers
    def _build_allocator(self) -> RegimeAllocator:
        specs = []
        for st in self.strategies:
            sc = self.cfg.strategies.strategies[st.strategy_id]
            status = self.statuses.get(st.strategy_id, ValidationStatus.UNVALIDATED)
            if status is ValidationStatus.REJECTED and not self.allow_rejected:
                continue
            specs.append(StrategyAllocationSpec(st.strategy_id, sc.max_weight, sc.regime_affinity, status))
        a = self.cfg.strategies.allocation
        # LIVE/TESTNET: only PROMOTED strategies receive capital.  PAPER: forward-testing of
        # research-only / under-review strategies is allowed (it is itself evidence gathering).
        require = self.mode is not TradingMode.PAPER and a.get("require_validation", True)
        return RegimeAllocator(
            specs,
            a.get("crisis_exposure_multiplier", 0.5),
            a.get("neutral_exposure_multiplier", 0.75),
            require,
            a.get("total_weight_cap", 1.0),
        )

    def _account_meta(self) -> tuple[float, float, float, str]:
        s = self.risk.state
        return self.initial_capital, s.high_water_mark, s.day_start_equity, s.day

    def _on_risk_event(self, ev: RiskEvent) -> None:
        self.store.record_risk_event(ev)
        if ev.severity in ("CRITICAL", "WARNING"):
            self.alerts.send(ev.severity, ev.event_type, ev.message)

    def _on_trade(self, t: ClosedTrade) -> None:
        self.metrics.inc("trades_closed")
        log.info("trade closed %s %s pnl=%.2f reason=%s", t.strategy_id, t.symbol, t.pnl, t.exit_reason)

    # ------------------------------------------------------------------ startup / recovery
    async def startup(self) -> RecoveryReport:
        self.recovering = True
        await self._snapshot()
        # Bars loaded at startup are evaluated on the first step (latest closed bar only; signals older
        # than ``signal_max_age_fraction`` of their bar are expired, and processed_signals prevents re-use).
        self._startup_updates = await self.feed.refresh_bars()
        await self.feed.check_clock()
        rep = post_restore_checks(self.store, self.ledger, self.broker, self.risk.breaker, self.initial_capital, self.recovery)
        self._sync_external_halt()
        self.store.save_risk_state(self.risk.state)
        self._fit_regimes()
        for p in self.ledger.open_positions():
            self._ensure_protection(p)
        self.recovering = False
        self.store.record_event(f"startup-{time.time_ns()}", "startup", {"recovery": rep.__dict__})
        return rep

    def _fit_regimes(self) -> None:
        rcfg = self.cfg.strategies.regime
        tf = rcfg.get("timeframe", "4h")
        for sym in self.cfg.research.symbols:
            hist = self._regime_history.get(sym)
            live = self.feed.bars.get(sym, {}).get(tf)
            train = hist if hist is not None and len(hist) > 500 else live
            if train is None or len(train) < 400:
                continue
            det = RegimeDetector(RegimeParams.from_config(rcfg))
            try:
                det.fit(train.iloc[-2190:])  # trailing ~12 months of 4h bars (training data only)
                self.regime_detectors[sym] = det
            except ValueError as exc:
                log.warning("regime fit failed for %s: %s", sym, exc)
        self._update_regimes()

    def _update_regimes(self) -> None:
        tf = self.cfg.strategies.regime.get("timeframe", "4h")
        for sym, det in self.regime_detectors.items():
            live = self.feed.bars.get(sym, {}).get(tf)
            hist = self._regime_history.get(sym)
            df = live if hist is None else pd.concat([hist, live]) if live is not None else hist
            if df is None or df.empty:
                continue
            df = df[~df.index.duplicated(keep="last")].sort_index()
            r = det.classify(df.iloc[-800:])
            self.regimes[sym] = (str(r["regime"].iloc[-1]), float(r["confidence"].iloc[-1]))

    # ------------------------------------------------------------------ market data / health
    async def _snapshot(self) -> None:
        try:
            snaps = await self.feed.snapshot()
            self.snapshots.update(snaps)
            self.connected = True
            self.risk.breaker.record_exchange_success()
            for s in snaps.values():
                self.metrics.observe("api_latency_ms", s.latency_ms)
        except Exception as exc:
            self.connected = False
            self.metrics.inc("feed_errors")
            self.risk.breaker.record_exchange_error(pd.Timestamp.now(tz="UTC").isoformat(), type(exc).__name__)
            log.warning("market data snapshot failed: %s", exc)

    def _health_checks(self) -> HealthSnapshot:
        cb = self.cfg.risk.circuit_breakers
        now_iso = pd.Timestamp.now(tz="UTC").isoformat()
        age = self.feed.data_age_seconds()
        lat = self.feed.health.latency_ms
        self.risk.breaker.check_data_freshness(now_iso, age)
        self.risk.breaker.check_latency(now_iso, lat)
        off = self.feed.health.exchange_time_offset_ms
        if off is not None:
            self.risk.breaker.check_clock_skew(now_iso, off)
        db_ok = True
        if self.step_count % 60 == 0:
            db_ok, msg = integrity_check(self.store.engine)
            if not db_ok:
                self.risk.breaker.database_failure(now_iso, msg)
        h = classify(
            halted=self.risk.state.halted,
            recovering=self.recovering,
            connected=self.connected,
            data_age_s=age,
            latency_ms=lat,
            consecutive_errors=self.risk.state.consecutive_errors,
            db_ok=db_ok,
            clock_offset_ms=off,
            max_age_s=cb.max_data_staleness_seconds,
            max_latency_ms=cb.max_api_latency_ms,
            max_clock_skew_ms=cb.max_clock_skew_ms,
            transient_blocks=self.risk.state.transient_blocks,
        )
        self.last_health = h
        return h

    # ------------------------------------------------------------------ marks / equity
    def marks(self) -> dict[str, float]:
        out = {s: snap.mid for s, snap in self.snapshots.items() if snap.mid > 0}
        for p in self.ledger.open_positions():  # never value a position at 0 for lack of a quote
            out.setdefault(p.symbol, p.avg_entry_price)
        return out

    def equity(self) -> float:
        return self.ledger.equity(self.marks())

    def _sync_external_halt(self) -> None:
        """Adopt a halt persisted by another process (dashboard kill switch while we were busy or
        offline).  The engine never clears a persisted halt except via authorize_resume."""
        try:
            ext = self.store.load_risk_state()
        except Exception as exc:
            self.risk.breaker.database_failure(pd.Timestamp.now(tz="UTC").isoformat(), str(exc))
            return
        if ext is None:
            return
        s = self.risk.state
        if ext.halted and not s.halted:
            s.halted, s.requires_authorization = True, True
            s.halt_reason, s.halted_at = ext.halt_reason or "external_halt", ext.halted_at
        s.kill_switch = s.kill_switch or ext.kill_switch
        s.flatten_pending = s.flatten_pending or (ext.flatten_pending and s.halted)

    def _record_equity(self, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self._last_equity_write < 5:
            return
        self._last_equity_write = now
        self._sync_external_halt()
        self.store.save_risk_state(self.risk.state)  # persists HWM / day-start equity / flags
        m = self.marks()
        eq = self.ledger.equity(m)
        hwm = max(self.risk.state.high_water_mark, eq)
        self.store.save_equity(
            pd.Timestamp.now(tz="UTC"),
            eq,
            self.ledger.cash,
            self.ledger.unrealized(m),
            self.ledger.realized_pnl,
            self.ledger.gross_exposure(m),
            1 - eq / hwm if hwm > 0 else 0.0,
        )

    # ------------------------------------------------------------------ ExecutionControl (kill switch)
    def cancel_orders(self, entries_only: bool) -> int:
        n = 0
        for o in list(self.broker.open_orders()):
            if entries_only and o.intent in (OrderIntent.STOP_LOSS, OrderIntent.TAKE_PROFIT):
                continue
            n += int(self.broker.cancel(o.client_order_id))
        return n

    def flatten_all(self, reason: str, attempt_key: str) -> int:
        n = 0
        for p in list(self.ledger.open_positions()):
            if self._close_position(p, reason, attempt_key) is not None:
                n += 1
        return n

    def remaining_exposure(self) -> dict[str, float]:
        return {k: v for k, v in self.broker.net_positions().items() if abs(v) > 1e-12}

    # ------------------------------------------------------------------ order helpers
    def _order(
        self,
        cid: str,
        p_sym: str,
        side: Side,
        typ: OrderType,
        qty: float,
        intent: OrderIntent,
        sid: str,
        price: float | None = None,
        stop: float | None = None,
        reduce_only: bool = False,
        parent: str | None = None,
        signal_id: str | None = None,
    ) -> Order:
        return Order(
            cid,
            p_sym,
            side,
            typ,
            qty,
            intent,
            sid,
            pd.Timestamp.now(tz="UTC"),
            price,
            stop,
            reduce_only,
            parent_id=parent,
            signal_id=signal_id,
        )

    def _close_position(self, p: Position, reason: str, key: str) -> Order | None:
        qty = abs(p.quantity)
        if qty <= 1e-12:
            return None
        for o in list(self.broker.open_orders()):  # cancel this position's protective orders first
            if o.symbol == p.symbol and o.strategy_id == p.strategy_id:
                self.broker.cancel(o.client_order_id)
        side = Side.SELL if p.quantity > 0 else Side.BUY
        cid = deterministic_client_order_id("exit", p.strategy_id, p.symbol, key, f"{qty:.10f}")
        o = self._order(
            cid,
            p.symbol,
            side,
            OrderType.MARKET,
            qty,
            OrderIntent.FLATTEN if "flatten" in reason or "kill" in reason or "drawdown" in reason else OrderIntent.EXIT,
            p.strategy_id,
            reduce_only=True,
        )
        res = self.om.submit(o, self.snapshots.get(p.symbol))
        self._check_slippage(res)
        return res

    def _check_slippage(self, o: Order) -> None:
        snap = self.snapshots.get(o.symbol)
        if o.filled_quantity > 0 and snap and snap.mid > 0:
            bps = abs(o.avg_fill_price / snap.mid - 1) * 1e4
            self.metrics.observe("execution_slippage_bps", bps)
            self.risk.breaker.check_slippage(pd.Timestamp.now(tz="UTC").isoformat(), bps)

    def _protective_orders(self, p: Position) -> list[Order]:
        return [
            o
            for o in self.broker.open_orders()
            if o.symbol == p.symbol
            and o.strategy_id == p.strategy_id
            and o.intent in (OrderIntent.STOP_LOSS, OrderIntent.TAKE_PROFIT)
        ]

    def _place_protection(self, p: Position) -> None:
        key = p.entry_signal_id or f"{p.strategy_id}-{p.symbol}-{p.opened_at}"
        side = Side.SELL if p.quantity > 0 else Side.BUY
        qty = abs(p.quantity)
        parent = deterministic_client_order_id(key, "entry")
        # Revision = number of dead protective orders for this position: identical state -> identical id
        # (no duplicates on retry), but a cancelled/rejected stop can be replaced with a fresh id.
        rev_sl = self.store.count_dead_protective(parent, OrderIntent.STOP_LOSS.value)
        rev_tp = self.store.count_dead_protective(parent, OrderIntent.TAKE_PROFIT.value)
        if p.stop_loss is not None:
            self.om.submit(
                self._order(
                    deterministic_client_order_id(key, "sl", f"{qty:.10f}", rev_sl),
                    p.symbol,
                    side,
                    OrderType.STOP_MARKET,
                    qty,
                    OrderIntent.STOP_LOSS,
                    p.strategy_id,
                    stop=p.stop_loss,
                    reduce_only=True,
                    parent=parent,
                )
            )
        if p.take_profit is not None:
            self.om.submit(
                self._order(
                    deterministic_client_order_id(key, "tp", f"{qty:.10f}", rev_tp),
                    p.symbol,
                    side,
                    OrderType.TAKE_PROFIT_LIMIT,
                    qty,
                    OrderIntent.TAKE_PROFIT,
                    p.strategy_id,
                    price=p.take_profit,
                    reduce_only=True,
                    parent=parent,
                )
            )

    def _ensure_protection(self, p: Position) -> bool:
        """Verify through the broker; re-place once; otherwise close the position and halt entries."""
        if not self.cfg.risk.stops.require_protective_orders:
            return True
        stops = [o for o in self._protective_orders(p) if o.intent is OrderIntent.STOP_LOSS]
        if not stops:
            self._place_protection(p)
        st = self.broker.verify_protection(p.symbol, self.broker.net_positions().get(p.symbol, p.quantity))
        if st.protected:
            return True
        self._place_protection(p)
        st = self.broker.verify_protection(p.symbol, self.broker.net_positions().get(p.symbol, p.quantity))
        if st.protected:
            return True
        ts = pd.Timestamp.now(tz="UTC").isoformat()
        self.risk.breaker.halt(ts, f"protection_unverified:{p.strategy_id}:{p.symbol}", flatten=False)
        self._close_position(p, "protection_unverified", ts)
        return False

    # ------------------------------------------------------------------ position management
    def _manage_positions(self) -> None:
        now = pd.Timestamp.now(tz="UTC")
        for p in list(self.ledger.open_positions()):
            snap = self.snapshots.get(p.symbol)
            if snap is None:
                continue
            if p.trailing_stop_distance:
                px = snap.last
                changed = False
                if p.quantity > 0:
                    p.highest_price = max(p.highest_price or px, px)
                    cand = p.highest_price - p.trailing_stop_distance
                    changed = p.stop_loss is None or cand > p.stop_loss
                else:
                    p.lowest_price = min(p.lowest_price or px, px)
                    cand = p.lowest_price + p.trailing_stop_distance
                    changed = p.stop_loss is None or cand < p.stop_loss
                if changed:
                    p.stop_loss = cand
                    for o in self._protective_orders(p):
                        if o.intent is OrderIntent.STOP_LOSS:
                            self.broker.amend_stop(o.client_order_id, cand)
            if not self._protective_orders(p):  # e.g. after CANCEL OPEN ORDERS: re-protect (new revision ids)
                self._ensure_protection(p)
            if p.strategy_id == PROBE_ID and self._probe_state.get("opened_at") is not None:
                if time.monotonic() - self._probe_state["opened_at"] >= self.probe_hold_seconds:
                    self._close_position(p, "diagnostic_probe_exit", "probe")
                    self._probe_state["closed"] = True
                continue
            if p.max_hold_until is not None and now >= p.max_hold_until:
                self._close_position(p, "time_stop", str(p.max_hold_until))

    # ------------------------------------------------------------------ signals
    def _weight(self, strategy_id: str, symbol: str) -> float:
        regime, conf = self.regimes.get(symbol, ("neutral", 0.0))
        return self.allocator.allocate(regime, conf).weights.get(strategy_id, 0.0)

    def handle_signal(self, sig: Signal, weight: float | None = None) -> dict[str, Any]:
        if self.store.signal_processed(sig.signal_id):
            return {"signal_id": sig.signal_id, "decision": "duplicate_ignored"}
        pos = self.ledger.position(sig.strategy_id, sig.symbol)
        if sig.is_exit:
            closes = (sig.metadata.get("exit_long") and pos.quantity > 0) or (sig.metadata.get("exit_short") and pos.quantity < 0)
            if closes:
                self._close_position(pos, "strategy_exit", sig.signal_id)
            self.store.mark_signal(
                sig.signal_id, sig.strategy_id, sig.symbol, sig.timestamp, "exit" if closes else "exit_noop", []
            )
            return {"signal_id": sig.signal_id, "decision": "exit" if closes else "exit_noop"}
        if int(np.sign(pos.quantity)) == int(sig.direction):
            self.store.mark_signal(sig.signal_id, sig.strategy_id, sig.symbol, sig.timestamp, "skipped", ["already_positioned"])
            return {"signal_id": sig.signal_id, "decision": "skipped"}
        if pos.quantity != 0:
            self._close_position(pos, "reverse", sig.signal_id)
        snap = self.snapshots.get(sig.symbol)
        w = self._weight(sig.strategy_id, sig.symbol) if weight is None else weight
        m = self.marks()
        view = PortfolioView(
            self.ledger.equity(m), m, [(p.strategy_id, p.symbol, p.quantity) for p in self.ledger.open_positions()]
        )
        age = snap.age_seconds() if snap else float("inf")
        dec = self.risk.evaluate(sig, view, weight=w, data_age_seconds=min(age, self.feed.data_age_seconds()))
        self.metrics.inc(f"risk_{dec.decision}")
        rec = {
            "signal_id": sig.signal_id,
            "strategy_id": sig.strategy_id,
            "symbol": sig.symbol,
            "direction": int(sig.direction),
            "decision": dec.decision,
            "reasons": dec.reasons,
            "quantity": dec.quantity,
            "weight": w,
            "ts": sig.timestamp.isoformat(),
        }
        self.decisions.append(rec)
        self.store.mark_signal(sig.signal_id, sig.strategy_id, sig.symbol, sig.timestamp, dec.decision, dec.reasons)
        self.store.record_event(f"decision-{sig.signal_id}", "risk_decision", rec)
        if not dec.approved:
            return rec
        side = Side.BUY if sig.direction is Direction.LONG else Side.SELL
        entry = self._order(
            deterministic_client_order_id(sig.signal_id, "entry"),
            sig.symbol,
            side,
            OrderType.MARKET,
            dec.quantity,
            OrderIntent.ENTRY,
            sig.strategy_id,
            signal_id=sig.signal_id,
        )
        res = self.om.submit(entry, snap)
        self._check_slippage(res)
        rec["order_status"] = res.status.value
        if res.filled_quantity > 0:
            p = self.ledger.position(sig.strategy_id, sig.symbol)
            p.stop_loss, p.take_profit = dec.stop_loss, dec.take_profit
            p.trailing_stop_distance = sig.trailing_stop_distance
            p.entry_signal_id = sig.signal_id
            if sig.expected_holding_bars > 0:
                p.max_hold_until = pd.Timestamp.now(tz="UTC") + pd.Timedelta(sig.timeframe) * sig.expected_holding_bars
            self._persist_ledger()
            rec["protected"] = self._ensure_protection(p)
        return rec

    def _persist_ledger(self) -> None:
        from quant_engine.data.database import transaction

        with transaction(self.store.engine) as c:
            self.store.save_ledger(c, self.ledger, *self._account_meta())

    def evaluate_strategies(self, updated: dict[str, list[str]]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        if not updated:
            return out
        self._update_regimes()
        md = MarketData(self.feed.bars, funding={}, orderbook=dict(self.feed.book_features))
        updated_tfs = {tf for tfs in updated.values() for tf in tfs}
        for st in self.strategies:
            if st.timeframe not in updated_tfs:
                continue
            try:
                if any(len(self.feed.bars.get(s, {}).get(tf, [])) < 100 for s in st.symbols for tf in st.required_timeframes()):
                    continue
                frames = st.compute(md)
                ts = min(f.index[-1] for f in frames.values())
                sigs = st.signals_at(frames, ts, self.cfg.risk.sizing.risk_per_trade)
                self.store.save_strategy_state(
                    st.strategy_id,
                    self.statuses.get(st.strategy_id, ValidationStatus.UNVALIDATED).value,
                    max((self._weight(st.strategy_id, s) for s in st.symbols), default=0.0),
                    {k: v for k, v in st.params.items()},
                    ts,
                )
                self.metrics.inc("strategy_evaluations")
                max_age = pd.Timedelta(st.timeframe) * self.signal_max_age_fraction
                age = pd.Timestamp.now(tz="UTC") - ts
                self.metrics.observe("signal_age_s", age.total_seconds())
                for sig in sigs:
                    if not sig.is_exit and age > max_age and not self.store.signal_processed(sig.signal_id):
                        rec = {
                            "signal_id": sig.signal_id,
                            "strategy_id": sig.strategy_id,
                            "symbol": sig.symbol,
                            "direction": int(sig.direction),
                            "decision": "expired",
                            "reasons": [f"signal_age_{age.total_seconds():.0f}s>{max_age.total_seconds():.0f}s"],
                            "ts": sig.timestamp.isoformat(),
                        }
                        self.store.mark_signal(
                            sig.signal_id, sig.strategy_id, sig.symbol, sig.timestamp, "expired", rec["reasons"]
                        )
                        self.decisions.append(rec)
                        out.append(rec)
                        continue
                    out.append(self.handle_signal(sig))
                if not sigs:
                    self.decisions.append(
                        {
                            "strategy_id": st.strategy_id,
                            "decision": "no_signal",
                            "bar_close": ts.isoformat(),
                            "symbols": st.symbols,
                        }
                    )
            except Exception as exc:  # a failing strategy must not take down risk control
                log.exception("strategy %s evaluation failed", st.strategy_id)
                self.store.record_event(
                    f"strategy-error-{st.strategy_id}-{time.time_ns()}",
                    "strategy_error",
                    {"strategy": st.strategy_id, "error": str(exc)},
                )
        return out

    def _run_probe(self) -> None:
        """Diagnostic probe (smoke tests only): one tiny, clearly-labelled entry through the full
        risk -> order -> protective-order path, closed after ``probe_hold_seconds``."""
        if not self.diagnostic_probe or self._probe_state.get("submitted"):
            return
        sym = self.cfg.research.symbols[0]
        snap = self.snapshots.get(sym)
        if snap is None:
            return
        px = snap.mid
        sig = Signal(
            PROBE_ID,
            sym,
            pd.Timestamp.now(tz="UTC").floor("s"),
            Direction.LONG,
            px,
            px * 0.99,
            px * 1.02,
            0.0,
            0,
            0.0005,
            "15m",
            metadata={"diagnostic": True},
        )
        self._probe_state["submitted"] = True
        rec = self.handle_signal(sig, weight=1.0)
        self._probe_state["decision"] = rec
        if rec.get("order_status") == OrderStatus.FILLED.value:
            self._probe_state["opened_at"] = time.monotonic()

    # ------------------------------------------------------------------ commands
    def process_commands(self) -> list[dict[str, Any]]:
        done = []
        for cmd in self.store.pending_commands():
            name, actor = cmd["command"], cmd["requested_by"]
            ok, result = True, {}
            try:
                if name == "kill_switch":
                    rep = run_emergency_procedure(
                        self.risk.breaker, self, f"kill_switch:{actor}", kill_switch=True, max_attempts=3, sleep=lambda s: None
                    )
                    result = rep.__dict__
                    ok = rep.success
                elif name == "flatten":
                    rep = run_emergency_procedure(
                        self.risk.breaker,
                        self,
                        f"emergency_flatten:{actor}",
                        kill_switch=False,
                        max_attempts=3,
                        sleep=lambda s: None,
                    )
                    result = rep.__dict__
                    ok = rep.success
                elif name == "cancel_orders":
                    result = {"canceled": self.cancel_orders(entries_only=False)}
                    # cancelling protective orders leaves positions unprotected -> re-verify next step
                elif name == "resume":
                    payload = json.loads(cmd.get("result_json") or "{}")
                    discrepancy = (self.risk.state.halt_reason or "").startswith("recovery_state_discrepancy")
                    if discrepancy and not payload.get("discrepancy_explained"):
                        raise PermissionError("halt caused by a state discrepancy: operator must confirm it is explained")
                    self.risk.breaker.authorize_resume(pd.Timestamp.now(tz="UTC").isoformat(), actor)
                    result = {"resumed_by": actor}
                else:
                    ok, result = False, {"error": f"unknown command {name}"}
            except Exception as exc:
                ok, result = False, {"error": f"{type(exc).__name__}: {exc}"}
            self.store.complete_command(cmd["id"], ok, result)
            done.append({"command": name, "ok": ok, "result": result})
        return done

    # ------------------------------------------------------------------ main step
    async def step(self) -> dict[str, Any]:
        self.step_count += 1
        self._sync_external_halt()
        await self._snapshot()
        health = self._health_checks()
        if isinstance(self.broker, PaperBroker) and self.snapshots:
            for t in self.broker.on_market(self.snapshots):
                self.store.record_event(
                    f"trade-{t.trade_id}-{t.exit_time.value}",
                    "trade_closed",
                    {"strategy": t.strategy_id, "symbol": t.symbol, "pnl": t.pnl, "reason": t.exit_reason},
                )
        cmds = self.process_commands()
        self._manage_positions()
        if self.risk.state.flatten_pending:
            self.cancel_orders(entries_only=True)
            self.flatten_all("circuit_breaker_flatten", self.risk.state.halted_at or "pending")
            if not self.remaining_exposure():
                self.risk.state.flatten_pending = False
                self.store.save_risk_state(self.risk.state)
        updated: dict[str, list[str]] = {}
        if self._startup_updates:
            updated, self._startup_updates = self._startup_updates, {}
        try:
            for sym, tfs in (await self.feed.refresh_bars()).items():
                updated[sym] = sorted(set(updated.get(sym, [])) | set(tfs))
        except Exception as exc:
            self.risk.breaker.record_exchange_error(pd.Timestamp.now(tz="UTC").isoformat(), type(exc).__name__)
        decisions = self.evaluate_strategies(updated) if not self.recovering else []
        self._run_probe()
        events = self.risk.on_equity(pd.Timestamp.now(tz="UTC"), self.equity()) if self.snapshots else []
        for ev in events:
            if ev.action is BreakerAction.HALT_AND_FLATTEN:
                self.cancel_orders(entries_only=True)
                self.flatten_all("drawdown_flatten", self.risk.state.halted_at or "dd")
        self._record_equity()
        status = SystemStatus.HALTED if self.risk.state.halted else health.status
        self.store.heartbeat(
            status.value,
            {
                "health": health.to_dict(),
                "equity": self.equity(),
                "open_positions": len(self.ledger.open_positions()),
                "open_orders": len(self.broker.open_orders()),
                "regimes": self.regimes,
                "metrics": self.metrics.summary(),
                "marks": self.marks(),
                "book": {
                    s: {k: f.get(k) for k in ("spread_bps", "imbalance", "mid", "impact_bps_buy", "fresh")}
                    for s, f in self.feed.book_features.items()
                },
                "mode": self.mode.value,
                "step": self.step_count,
            },
        )
        return {"health": health.status.value, "commands": cmds, "decisions": decisions, "updated": updated}

    async def run(self, duration_s: float | None = None, poll_seconds: float = 5.0) -> None:
        self.running = True
        t0 = time.monotonic()
        try:
            while self.running and (duration_s is None or time.monotonic() - t0 < duration_s):
                t1 = time.monotonic()
                await self.step()
                await asyncio.sleep(max(0.0, poll_seconds - (time.monotonic() - t1)))
        finally:
            self._record_equity(force=True)
            self.store.heartbeat("STOPPED", {"reason": "graceful shutdown", "equity": self.equity()})
            self.running = False

    def stop(self) -> None:
        self.running = False
