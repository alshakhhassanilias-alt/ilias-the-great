"""Broker abstraction and the CCXT exchange broker (TESTNET / LIVE).

The same :class:`Broker` interface is implemented by :class:`~quant_engine.execution.paper_broker.PaperBroker`
(simulated fills against *observed* live order books) and :class:`CCXTExchangeBroker`.

Exchange-specific protective-order behaviour (USD-M linear perpetuals) — never assumed identical:

=========  ==========================================  =========================  ======================
Exchange   Stop-loss order (CCXT unified + raw)        Trigger reference          Position mode params
=========  ==========================================  =========================  ======================
binance    STOP_MARKET via ``stopLossPrice``,          ``workingType`` MARK_PRICE  ``positionSide`` BOTH
           ``reduceOnly``, ``newClientOrderId``                                   (one-way) / LONG|SHORT
okx        conditional/trigger via ``stopLossPrice``,  ``slTriggerPxType`` mark   ``tdMode`` cross,
           ``reduceOnly``, ``clOrdId`` (32 alnum)                                 ``posSide`` net|long|short
bybit      ``triggerPrice`` + ``triggerDirection``,    ``triggerBy`` MarkPrice    ``positionIdx`` 0 / 1 / 2
           ``reduceOnly``, ``orderLinkId``
=========  ==========================================  =========================  ======================

After every entry the engine calls :meth:`verify_protection`, which re-reads open orders *from
the exchange* and confirms a reduce-only stop exists for the position quantity.  A locally
recorded stop price is never treated as proof of exchange-side protection.

Status: TESTNET/LIVE paths are implemented but **unverified** in this environment (no
credentials; Binance futures and Bybit are geo-blocked from the build host).
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

import ccxt
import pandas as pd

from quant_engine.config.settings import TradingMode
from quant_engine.core.types import Order, OrderIntent, OrderStatus, OrderType, Side

log = logging.getLogger(__name__)


@dataclass
class SymbolSnapshot:
    symbol: str
    last: float
    bid: float
    ask: float
    bids: list[tuple[float, float]] = field(default_factory=list)
    asks: list[tuple[float, float]] = field(default_factory=list)
    exchange_ts: pd.Timestamp | None = None
    received_at: pd.Timestamp = field(default_factory=lambda: pd.Timestamp.now(tz="UTC"))
    latency_ms: float = 0.0

    @property
    def mid(self) -> float:
        return (self.bid + self.ask) / 2 if self.bid > 0 and self.ask > 0 else self.last

    def age_seconds(self, now: pd.Timestamp | None = None) -> float:
        now = now or pd.Timestamp.now(tz="UTC")
        ref = self.exchange_ts or self.received_at
        return max((now - ref).total_seconds(), 0.0)


@dataclass
class ProtectionStatus:
    symbol: str
    position_qty: float
    stop_found: bool
    stop_qty: float
    take_profit_found: bool
    source: str  # "exchange" | "paper_simulation"
    detail: str = ""

    @property
    def protected(self) -> bool:
        return self.stop_found and self.stop_qty >= abs(self.position_qty) * (1 - 1e-6)


class Broker(ABC):
    mode: TradingMode

    @abstractmethod
    def submit(self, order: Order, snapshot: SymbolSnapshot | None = None) -> Order: ...

    @abstractmethod
    def cancel(self, client_order_id: str) -> bool: ...

    @abstractmethod
    def open_orders(self) -> list[Order]: ...

    @abstractmethod
    def net_positions(self) -> dict[str, float]: ...

    @abstractmethod
    def balance(self) -> float: ...

    @abstractmethod
    def verify_protection(self, symbol: str, position_qty: float) -> ProtectionStatus: ...

    def amend_stop(self, client_order_id: str, new_stop: float) -> Order | None:  # pragma: no cover - optional
        return None


def protective_params(exchange_id: str, intent: OrderIntent, trigger: float, client_order_id: str,
                      hedge_mode: bool = False, position_side: str = "LONG") -> dict[str, Any]:
    """Exchange-specific parameters for reduce-only protective orders (unified CCXT where possible)."""
    params: dict[str, Any] = {"reduceOnly": True}
    key = "stopLossPrice" if intent is OrderIntent.STOP_LOSS else "takeProfitPrice"
    if exchange_id == "binance":
        params.update({key: trigger, "workingType": "MARK_PRICE", "newClientOrderId": client_order_id})
        if hedge_mode:
            params["positionSide"] = position_side
            params.pop("reduceOnly")  # Binance rejects reduceOnly in hedge mode; positionSide implies it
    elif exchange_id == "okx":
        params.update({key: trigger, "clOrdId": client_order_id[:32], "tdMode": "cross",
                       ("slTriggerPxType" if key == "stopLossPrice" else "tpTriggerPxType"): "mark"})
        if hedge_mode:
            params["posSide"] = position_side.lower()
    elif exchange_id == "bybit":
        params.update({key: trigger, "orderLinkId": client_order_id, "triggerBy": "MarkPrice",
                       "positionIdx": (1 if position_side == "LONG" else 2) if hedge_mode else 0})
    else:
        raise ValueError(f"unsupported exchange {exchange_id}")
    return params


def entry_params(exchange_id: str, client_order_id: str) -> dict[str, Any]:
    table: dict[str, dict[str, Any]] = {"binance": {"newClientOrderId": client_order_id},
            "okx": {"clOrdId": client_order_id[:32], "tdMode": "cross"},
            "bybit": {"orderLinkId": client_order_id, "positionIdx": 0}}
    return dict(table[exchange_id])


class CCXTExchangeBroker(Broker):
    """Authenticated exchange broker.  Constructed only for TESTNET/LIVE (factory enforces it)."""

    def __init__(self, exchange: ccxt.Exchange, mode: TradingMode, exchange_id: str, hedge_mode: bool = False,
                 swap_symbols: dict[str, str] | None = None) -> None:
        if mode is TradingMode.PAPER:
            raise PermissionError("CCXTExchangeBroker must not be used in PAPER mode")
        self.ex = exchange
        self.mode = mode
        self.exchange_id = exchange_id
        self.hedge_mode = hedge_mode
        self.swap = swap_symbols or {}
        self._orders: dict[str, Order] = {}

    def _sym(self, s: str) -> str:
        return self.swap.get(s, s)

    def _find_by_client_id(self, order: Order) -> dict[str, Any] | None:
        try:
            for o in self.ex.fetch_open_orders(self._sym(order.symbol)) + self.ex.fetch_closed_orders(
                    self._sym(order.symbol), limit=50):
                if o.get("clientOrderId") == order.client_order_id:
                    return o
        except ccxt.BaseError as exc:
            log.warning("lookup by client id failed: %s", type(exc).__name__)
        return None

    def submit(self, order: Order, snapshot: SymbolSnapshot | None = None) -> Order:
        existing = self._find_by_client_id(order)  # idempotency: never resubmit a known client id
        if existing is None:
            sym = self._sym(order.symbol)
            if order.intent in (OrderIntent.STOP_LOSS, OrderIntent.TAKE_PROFIT):
                params = protective_params(self.exchange_id, order.intent, float(order.stop_price or order.price or 0),
                                           order.client_order_id, self.hedge_mode,
                                           "LONG" if order.side is Side.SELL else "SHORT")
                existing = self.ex.create_order(sym, "market", order.side.value, order.quantity, None, params)
            else:
                params = entry_params(self.exchange_id, order.client_order_id)
                if order.reduce_only:
                    params["reduceOnly"] = True
                typ = "limit" if order.order_type is OrderType.LIMIT else "market"
                existing = self.ex.create_order(sym, typ, order.side.value, order.quantity, order.price, params)
        order.exchange_order_id = str(existing.get("id"))
        status = str(existing.get("status"))
        order.filled_quantity = float(existing.get("filled") or 0.0)
        order.avg_fill_price = float(existing.get("average") or existing.get("price") or 0.0)
        order.status = {"closed": OrderStatus.FILLED, "canceled": OrderStatus.CANCELED,
                        "rejected": OrderStatus.REJECTED}.get(status, OrderStatus.OPEN)
        self._orders[order.client_order_id] = order
        return order

    def cancel(self, client_order_id: str) -> bool:
        o = self._orders.get(client_order_id)
        if o is None or o.exchange_order_id is None:
            return False
        try:
            self.ex.cancel_order(o.exchange_order_id, self._sym(o.symbol))
            o.status = OrderStatus.CANCELED
            return True
        except ccxt.OrderNotFound:
            return False

    def open_orders(self) -> list[Order]:
        return [o for o in self._orders.values() if not o.status.is_terminal]

    def net_positions(self) -> dict[str, float]:
        out: dict[str, float] = {}
        inv = {v: k for k, v in self.swap.items()}
        for p in self.ex.fetch_positions():
            qty = float(p.get("contracts") or 0.0) * float(p.get("contractSize") or 1.0)
            if p.get("side") == "short":
                qty = -qty
            out[inv.get(p["symbol"], p["symbol"])] = out.get(inv.get(p["symbol"], p["symbol"]), 0.0) + qty
        return out

    def balance(self) -> float:
        bal = self.ex.fetch_balance()
        return float(bal.get("total", {}).get("USDT", 0.0))

    def verify_protection(self, symbol: str, position_qty: float) -> ProtectionStatus:
        stop_qty, tp = 0.0, False
        for o in self.ex.fetch_open_orders(self._sym(symbol)):
            info_reduce = o.get("reduceOnly") or str(o.get("info", {}).get("reduceOnly", "")).lower() == "true"
            trig = o.get("stopLossPrice") or o.get("triggerPrice") or o.get("stopPrice")
            if info_reduce and trig and o.get("side") == ("sell" if position_qty > 0 else "buy"):
                if o.get("takeProfitPrice"):
                    tp = True
                else:
                    stop_qty += float(o.get("remaining") or o.get("amount") or 0.0)
        return ProtectionStatus(symbol, position_qty, stop_qty > 0, stop_qty, tp, "exchange")
