"""Paper broker: genuine live public market data, simulated execution.

* Market orders walk the **observed** order-book levels (VWAP) plus the configured latency
  slippage, and pay the taker fee.  The observed book is market data; the fill is a simulation.
* Limit / take-profit orders rest and fill only when the last traded price trades *through*
  the limit by ``limit_penetration_bps`` (maker fee, no price improvement).
* Stop-market orders trigger when the last price crosses the stop and then execute as market
  orders against the current book (so gaps/slippage are realistic, not filled at the stop).
* Protective SL/TP pairs are OCO via ``parent_id``.
* Every state change (order, fill, ledger, trade) is committed in **one** SQL transaction;
  client order ids and fill ids are idempotency keys.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

import numpy as np
import pandas as pd

from quant_engine.backtest.execution_simulator import ExecutionSimulator
from quant_engine.config.settings import CostModelConfig, TradingMode
from quant_engine.core.accounting import ClosedTrade, Ledger
from quant_engine.core.types import Fill, Order, OrderIntent, OrderStatus, OrderType, Side
from quant_engine.data import database as db
from quant_engine.execution.exchange_adapter import Broker, ProtectionStatus, SymbolSnapshot
from quant_engine.execution.state_store import StateStore

log = logging.getLogger(__name__)
PROTECTIVE = (OrderIntent.STOP_LOSS, OrderIntent.TAKE_PROFIT)


class PaperBroker(Broker):
    mode = TradingMode.PAPER

    def __init__(self, store: StateStore, costs: CostModelConfig, ledger: Ledger,
                 account_meta: Callable[[], tuple[float, float, float, str]],
                 rng: np.random.Generator | None = None) -> None:
        self.store = store
        self.costs = costs
        self.ledger = ledger
        self.sim = ExecutionSimulator(costs, rng or np.random.default_rng())
        self.orders: dict[str, Order] = {}
        self.last_snapshot: dict[str, SymbolSnapshot] = {}
        self._account_meta = account_meta  # -> (initial_capital, hwm, day_start_equity, day)
        self.closed_trades: list[ClosedTrade] = []
        self.on_trade: Callable[[ClosedTrade], None] | None = None

    # ------------------------------------------------------------------ restore
    def restore_orders(self, orders: list[Order]) -> None:
        for o in orders:
            self.orders[o.client_order_id] = o

    # ------------------------------------------------------------------ core
    def _commit(self, order: Order, fill: Fill | None, reason: str = "") -> ClosedTrade | None:
        trade: ClosedTrade | None = None
        with db.transaction(self.store.engine) as conn:
            if fill is not None:
                fresh = self.store.record_fill(conn, fill)
                if fresh:  # duplicate fill ids are ignored -> no double accounting
                    trade = self.ledger.apply_fill(fill, reason)
                    if trade:
                        self.store.save_trade(conn, trade)
            self.store.save_order(order, conn)
            init, hwm, day_start, day = self._account_meta()
            self.store.save_ledger(conn, self.ledger, init, hwm, day_start, day)
        if trade:
            self.closed_trades.append(trade)
            if self.on_trade:
                self.on_trade(trade)
        return trade

    def _market_fill(self, order: Order, snap: SymbolSnapshot, qty: float) -> Fill | None:
        levels = snap.asks if order.side is Side.BUY else snap.bids
        if not levels:
            ref = snap.ask if order.side is Side.BUY else snap.bid
            levels = [(ref if ref > 0 else snap.last, float("inf"))]
        latency_bps = self.costs.base_slippage_bps
        res = self.sim.fill_against_book(order.side, qty, levels, latency_bps)
        if res.fill is None:
            order.status = OrderStatus.REJECTED
            order.reject_reason = res.reason
            return None
        f = res.fill
        seq = int(round(order.filled_quantity * 1e8))
        return Fill(f"{order.client_order_id}-{seq}", order.client_order_id, order.symbol, order.side, f.quantity,
                    f.price, f.fee, pd.Timestamp.now(tz="UTC"), f.liquidity, f.slippage_bps, order.strategy_id,
                    order.intent)

    def _apply_fill_to_order(self, order: Order, fill: Fill) -> None:
        tot = order.filled_quantity + fill.quantity
        order.avg_fill_price = (order.avg_fill_price * order.filled_quantity + fill.price * fill.quantity) / tot
        order.filled_quantity = tot
        order.fees_paid += fill.fee
        order.status = OrderStatus.FILLED if order.remaining <= 1e-12 else OrderStatus.PARTIALLY_FILLED

    def submit(self, order: Order, snapshot: SymbolSnapshot | None = None) -> Order:
        if order.client_order_id in self.orders:  # idempotent resubmission
            return self.orders[order.client_order_id]
        persisted = self.store.get_order(order.client_order_id)
        if persisted is not None:
            self.orders[order.client_order_id] = persisted
            return persisted
        snap = snapshot or self.last_snapshot.get(order.symbol)
        self.orders[order.client_order_id] = order
        if order.reduce_only:
            pos = self.ledger.position(order.strategy_id, order.symbol).quantity
            if pos == 0 or np.sign(pos) == order.side.sign:
                order.status = OrderStatus.REJECTED
                order.reject_reason = "reduce_only_would_increase"
                self._commit(order, None)
                return order
            order.quantity = min(order.quantity, abs(pos))
        if order.order_type is OrderType.MARKET:
            if snap is None:
                order.status = OrderStatus.REJECTED
                order.reject_reason = "no_market_data"
                self._commit(order, None)
                return order
            fill = self._market_fill(order, snap, order.quantity)
            if fill is not None:
                self._apply_fill_to_order(order, fill)
                if order.status is OrderStatus.PARTIALLY_FILLED and order.intent is OrderIntent.ENTRY:
                    order.status = OrderStatus.CANCELED  # entry remainder cancelled (book exhausted)
            self._commit(order, fill, reason=order.intent.value)
            return order
        order.status = OrderStatus.OPEN  # resting limit / stop / take-profit
        self._commit(order, None)
        return order

    def cancel(self, client_order_id: str) -> bool:
        o = self.orders.get(client_order_id)
        if o is None or o.status.is_terminal:
            return False
        o.status = OrderStatus.CANCELED
        self._commit(o, None)
        return True

    def amend_stop(self, client_order_id: str, new_stop: float) -> Order | None:
        o = self.orders.get(client_order_id)
        if o is None or o.status.is_terminal:
            return None
        o.stop_price = new_stop
        self._commit(o, None)
        return o

    def open_orders(self) -> list[Order]:
        return [o for o in self.orders.values() if not o.status.is_terminal]

    def net_positions(self) -> dict[str, float]:
        out: dict[str, float] = {}
        for p in self.ledger.open_positions():
            out[p.symbol] = out.get(p.symbol, 0.0) + p.quantity
        return out

    def balance(self) -> float:
        return self.ledger.cash

    def verify_protection(self, symbol: str, position_qty: float) -> ProtectionStatus:
        side = Side.SELL if position_qty > 0 else Side.BUY
        stops = [o for o in self.open_orders() if o.symbol == symbol and o.intent is OrderIntent.STOP_LOSS
                 and o.side is side]
        tps = [o for o in self.open_orders() if o.symbol == symbol and o.intent is OrderIntent.TAKE_PROFIT]
        return ProtectionStatus(symbol, position_qty, bool(stops), sum(o.remaining for o in stops), bool(tps),
                                "paper_simulation", "simulated protective orders (no exchange-side protection in PAPER)")

    # ------------------------------------------------------------------ market updates
    def on_market(self, snaps: dict[str, SymbolSnapshot]) -> list[ClosedTrade]:
        self.last_snapshot.update(snaps)
        closed: list[ClosedTrade] = []
        pen = self.costs.limit_penetration_bps / 1e4
        # stops before take-profits (conservative ordering)
        resting = sorted(self.open_orders(), key=lambda o: 0 if o.intent is OrderIntent.STOP_LOSS else 1)
        for o in resting:
            if o.status.is_terminal:
                continue  # cancelled earlier in this loop by OCO
            snap = snaps.get(o.symbol)
            if snap is None or snap.last <= 0:
                continue
            fill: Fill | None = None
            if o.order_type is OrderType.STOP_MARKET:
                hit = snap.last <= (o.stop_price or 0) if o.side is Side.SELL else snap.last >= (o.stop_price or np.inf)
                if hit:
                    pos = self.ledger.position(o.strategy_id, o.symbol).quantity
                    qty = min(o.remaining, abs(pos))
                    if qty <= 0:
                        o.status = OrderStatus.CANCELED
                        self._commit(o, None)
                        continue
                    fill = self._market_fill(o, snap, qty)
            elif o.order_type in (OrderType.LIMIT, OrderType.TAKE_PROFIT_LIMIT):
                limit = float(o.price or 0)
                through = snap.last < limit * (1 - pen) if o.side is Side.BUY else snap.last > limit * (1 + pen)
                if through:
                    qty = o.remaining
                    if o.reduce_only:
                        qty = min(qty, abs(self.ledger.position(o.strategy_id, o.symbol).quantity))
                    if qty > 0:
                        fee = qty * limit * self.costs.maker_fee
                        seq = int(round(o.filled_quantity * 1e8))
                        fill = Fill(f"{o.client_order_id}-{seq}", o.client_order_id, o.symbol, o.side, qty, limit, fee,
                                    pd.Timestamp.now(tz="UTC"), "maker", 0.0, o.strategy_id, o.intent)
            if fill is None:
                continue
            self._apply_fill_to_order(o, fill)
            if o.intent in PROTECTIVE:
                o.status = OrderStatus.FILLED
            t = self._commit(o, fill, reason=o.intent.value)
            if t:
                closed.append(t)
            if o.intent in PROTECTIVE and o.parent_id:  # OCO: cancel the sibling
                for sib in self.open_orders():
                    if sib.parent_id == o.parent_id and sib.client_order_id != o.client_order_id:
                        self.cancel(sib.client_order_id)
        return closed
