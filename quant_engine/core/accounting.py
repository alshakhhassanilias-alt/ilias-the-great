"""Position and PnL accounting (linear USDT-margined instruments).

A single :class:`Ledger` implementation is shared by the backtester and the paper broker
so research and paper results use identical PnL arithmetic.

* Positions are tracked per ``(strategy_id, symbol)`` sub-account in one cash pool.
* Fees and funding are deducted from cash when incurred; realised PnL is booked on
  reductions using the average-entry-price method.
* Equity = cash + sum(unrealised PnL).  (Linear perpetual / margin model: notional is not
  deducted from cash; leverage is controlled by the risk engine.)
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from quant_engine.core.types import Fill, OrderIntent, Position

Key = tuple[str, str]  # (strategy_id, symbol)


@dataclass
class ClosedTrade:
    trade_id: str
    strategy_id: str
    symbol: str
    direction: int
    quantity: float
    entry_price: float
    exit_price: float
    entry_time: pd.Timestamp
    exit_time: pd.Timestamp
    pnl: float           # net of fees and funding attributable to the trade
    gross_pnl: float
    fees: float
    funding: float
    exit_reason: str

    @property
    def return_on_notional(self) -> float:
        n = abs(self.quantity) * self.entry_price
        return self.pnl / n if n else 0.0


@dataclass
class Ledger:
    cash: float
    positions: dict[Key, Position] = field(default_factory=dict)
    closed_trades: list[ClosedTrade] = field(default_factory=list)
    total_fees: float = 0.0
    total_funding: float = 0.0
    total_slippage_cost: float = 0.0
    realized_pnl: float = 0.0
    _trade_seq: int = 0

    def position(self, strategy_id: str, symbol: str) -> Position:
        key = (strategy_id, symbol)
        if key not in self.positions:
            self.positions[key] = Position(symbol=symbol, strategy_id=strategy_id)
        return self.positions[key]

    def open_positions(self) -> list[Position]:
        return [p for p in self.positions.values() if abs(p.quantity) > 1e-12]

    def apply_fill(self, fill: Fill, reason: str = "") -> ClosedTrade | None:
        """Apply a fill; returns a ClosedTrade when a position is fully closed."""
        pos = self.position(fill.strategy_id, fill.symbol)
        signed = fill.quantity * fill.side.sign
        self.cash -= fill.fee
        self.total_fees += fill.fee
        pos.fees_paid += fill.fee
        mid_equiv = fill.price / (1 + fill.side.sign * fill.slippage_bps / 1e4) if fill.slippage_bps else fill.price
        self.total_slippage_cost += abs(fill.price - mid_equiv) * fill.quantity
        closed: ClosedTrade | None = None
        q0 = pos.quantity
        if q0 == 0 or (q0 > 0) == (signed > 0):
            # open / increase
            new_q = q0 + signed
            pos.avg_entry_price = (abs(q0) * pos.avg_entry_price + abs(signed) * fill.price) / abs(new_q)
            if q0 == 0:
                pos.opened_at = fill.timestamp
                pos.fees_paid = fill.fee
                pos.funding_paid = 0.0
                pos.realized_pnl = 0.0
                pos.highest_price = fill.price
                pos.lowest_price = fill.price
            pos.quantity = new_q
            return None
        # reduce / close / flip
        reduce_qty = min(abs(signed), abs(q0))
        pnl = reduce_qty * (fill.price - pos.avg_entry_price) * (1 if q0 > 0 else -1)
        self.cash += pnl
        self.realized_pnl += pnl
        pos.realized_pnl += pnl
        remaining = abs(signed) - reduce_qty
        pos.quantity = q0 + (reduce_qty if q0 < 0 else -reduce_qty)
        if abs(pos.quantity) <= 1e-12:
            pos.quantity = 0.0
            self._trade_seq += 1
            closed = ClosedTrade(
                trade_id=f"{fill.strategy_id}-{fill.symbol}-{self._trade_seq}",
                strategy_id=fill.strategy_id, symbol=fill.symbol, direction=1 if q0 > 0 else -1,
                quantity=abs(q0), entry_price=pos.avg_entry_price, exit_price=fill.price,
                entry_time=pos.opened_at or fill.timestamp, exit_time=fill.timestamp,
                pnl=pos.realized_pnl - pos.fees_paid - pos.funding_paid, gross_pnl=pos.realized_pnl,
                fees=pos.fees_paid, funding=pos.funding_paid,
                exit_reason=reason or fill.intent.value,
            )
            self.closed_trades.append(closed)
            self._reset(pos)
        if remaining > 1e-12:  # flip into the opposite direction
            pos.quantity = remaining * (1 if signed > 0 else -1)
            pos.avg_entry_price = fill.price
            pos.opened_at = fill.timestamp
            pos.fees_paid = 0.0
            pos.funding_paid = 0.0
            pos.realized_pnl = 0.0
        return closed

    @staticmethod
    def _reset(pos: Position) -> None:
        pos.avg_entry_price = 0.0
        pos.stop_loss = pos.take_profit = pos.trailing_stop_distance = None
        pos.highest_price = pos.lowest_price = None
        pos.opened_at = None
        pos.max_hold_until = None
        pos.entry_signal_id = None
        pos.fees_paid = pos.funding_paid = pos.realized_pnl = 0.0

    def apply_funding(self, symbol: str, rate: float, mark: float) -> float:
        """Longs pay positive funding, shorts receive it.  Returns total paid (+ = cost)."""
        paid_total = 0.0
        for (_sid, sym), pos in self.positions.items():
            if sym != symbol or pos.quantity == 0:
                continue
            paid = pos.quantity * mark * rate
            self.cash -= paid
            pos.funding_paid += paid
            paid_total += paid
        self.total_funding += paid_total
        return paid_total

    def unrealized(self, marks: dict[str, float]) -> float:
        return sum(p.unrealized_pnl(marks[p.symbol]) for p in self.open_positions() if p.symbol in marks)

    def equity(self, marks: dict[str, float]) -> float:
        return self.cash + self.unrealized(marks)

    def gross_exposure(self, marks: dict[str, float]) -> float:
        return sum(p.notional(marks[p.symbol]) for p in self.open_positions() if p.symbol in marks)

    def net_exposure(self, marks: dict[str, float]) -> float:
        return sum(p.quantity * marks[p.symbol] for p in self.open_positions() if p.symbol in marks)

    def symbol_exposure(self, symbol: str, mark: float) -> float:
        return sum(p.quantity * mark for p in self.open_positions() if p.symbol == symbol)


_ = OrderIntent  # re-export convenience for type users
