"""Core domain types shared by research, risk and execution layers.

Timestamp convention (critical for leakage prevention)
------------------------------------------------------
* Raw candles are stored keyed by **open time** (UTC, ms) exactly as exchanges deliver them.
* All research computations index bars by **close time** (``open + timeframe``).  A value
  indexed at ``t`` is therefore *available* at ``t`` and may be used for decisions at ``t``.
* An order generated at bar-close ``t`` executes no earlier than the open of the bar that
  starts at ``t`` (plus modelled latency).
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass, field, replace
from enum import IntEnum, StrEnum
from typing import Any

import pandas as pd

TIMEFRAME_MS: dict[str, int] = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
}


def timeframe_ms(tf: str) -> int:
    try:
        return TIMEFRAME_MS[tf]
    except KeyError as exc:  # pragma: no cover - defensive
        raise ValueError(f"unsupported timeframe {tf!r}") from exc


def timeframe_delta(tf: str) -> pd.Timedelta:
    return pd.Timedelta(milliseconds=timeframe_ms(tf))


def bars_per_year(tf: str, days: float = 365.0) -> float:
    return days * 86_400_000 / timeframe_ms(tf)


class Direction(IntEnum):
    SHORT = -1
    FLAT = 0
    LONG = 1


class Side(StrEnum):
    BUY = "buy"
    SELL = "sell"

    @property
    def sign(self) -> int:
        return 1 if self is Side.BUY else -1


class OrderType(StrEnum):
    MARKET = "market"
    LIMIT = "limit"
    STOP_MARKET = "stop_market"
    TAKE_PROFIT_LIMIT = "take_profit_limit"


class OrderIntent(StrEnum):
    ENTRY = "entry"
    EXIT = "exit"
    STOP_LOSS = "stop_loss"
    TAKE_PROFIT = "take_profit"
    FLATTEN = "flatten"


class OrderStatus(StrEnum):
    PENDING = "pending"
    OPEN = "open"
    PARTIALLY_FILLED = "partially_filled"
    FILLED = "filled"
    CANCELED = "canceled"
    REJECTED = "rejected"
    EXPIRED = "expired"

    @property
    def is_terminal(self) -> bool:
        return self in {OrderStatus.FILLED, OrderStatus.CANCELED, OrderStatus.REJECTED, OrderStatus.EXPIRED}


class SystemStatus(StrEnum):
    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    HALTED = "HALTED"
    DISCONNECTED = "DISCONNECTED"
    RECOVERING = "RECOVERING"


@dataclass(frozen=True, slots=True)
class Signal:
    """A strategy's *proposal*.  Strategies never place orders; the risk engine decides."""

    strategy_id: str
    symbol: str
    timestamp: pd.Timestamp
    direction: Direction
    entry_price: float
    stop_loss: float | None
    take_profit: float | None
    confidence: float
    expected_holding_bars: int
    proposed_risk_fraction: float
    timeframe: str = "1h"
    is_exit: bool = False
    trailing_stop_distance: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def signal_id(self) -> str:
        raw = f"{self.strategy_id}|{self.symbol}|{self.timestamp.isoformat()}|{int(self.direction)}|{self.is_exit}"
        return hashlib.sha256(raw.encode()).hexdigest()[:24]

    def with_metadata(self, **kwargs: Any) -> Signal:
        return replace(self, metadata={**self.metadata, **kwargs})


@dataclass(slots=True)
class Order:
    client_order_id: str
    symbol: str
    side: Side
    order_type: OrderType
    quantity: float
    intent: OrderIntent
    strategy_id: str
    created_at: pd.Timestamp
    price: float | None = None
    stop_price: float | None = None
    reduce_only: bool = False
    status: OrderStatus = OrderStatus.PENDING
    filled_quantity: float = 0.0
    avg_fill_price: float = 0.0
    fees_paid: float = 0.0
    exchange_order_id: str | None = None
    parent_id: str | None = None
    reject_reason: str | None = None
    signal_id: str | None = None

    @property
    def remaining(self) -> float:
        return max(self.quantity - self.filled_quantity, 0.0)


@dataclass(frozen=True, slots=True)
class Fill:
    fill_id: str
    client_order_id: str
    symbol: str
    side: Side
    quantity: float
    price: float
    fee: float
    timestamp: pd.Timestamp
    liquidity: str  # "maker" | "taker"
    slippage_bps: float = 0.0
    strategy_id: str = ""
    intent: OrderIntent = OrderIntent.ENTRY


@dataclass(slots=True)
class Position:
    symbol: str
    quantity: float = 0.0  # signed: >0 long, <0 short
    avg_entry_price: float = 0.0
    realized_pnl: float = 0.0
    strategy_id: str = ""
    opened_at: pd.Timestamp | None = None
    stop_loss: float | None = None
    take_profit: float | None = None
    trailing_stop_distance: float | None = None
    highest_price: float | None = None
    lowest_price: float | None = None
    fees_paid: float = 0.0
    funding_paid: float = 0.0
    entry_signal_id: str | None = None
    max_hold_until: pd.Timestamp | None = None

    @property
    def direction(self) -> Direction:
        if self.quantity > 0:
            return Direction.LONG
        if self.quantity < 0:
            return Direction.SHORT
        return Direction.FLAT

    def unrealized_pnl(self, mark: float) -> float:
        return self.quantity * (mark - self.avg_entry_price)

    def notional(self, mark: float) -> float:
        return abs(self.quantity) * mark


def new_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:20]}"


def deterministic_client_order_id(*parts: Any, prefix: str = "qe") -> str:
    """Idempotent client order id: the same intent always produces the same id.

    Exchanges reject duplicate client ids, and the local order manager deduplicates on
    them, so a retried submission after a timeout cannot create a second order.
    Binance limits ids to 36 chars, OKX to 32 alphanumerics; 28 hex chars + prefix fits both.
    """
    raw = "|".join(str(p) for p in parts)
    return f"{prefix}{hashlib.sha256(raw.encode()).hexdigest()[:28]}"


def index_ms(idx: pd.DatetimeIndex) -> Any:
    """Epoch milliseconds of a DatetimeIndex, independent of its storage resolution."""
    return idx.as_unit("ms").asi8


def ts_ms(ts: pd.Timestamp) -> int:
    return int(pd.Timestamp(ts).value // 1_000_000)  # .value is always nanoseconds
