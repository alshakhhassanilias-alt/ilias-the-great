"""Execution cost and fill simulation (shared by the backtester and the paper broker).

All parameters are configurable *assumptions* (see ``CostModelConfig``), not claims about
real exchange behaviour.  The model is deliberately conservative:

* **Market orders** fill at the next bar's open (the first price observable after the
  decision) adjusted by half the spread plus slippage:

      slip_bps = base + vol_coef * sigma15 + impact_coef * sigma15 * sqrt(participation)

  where ``sigma15`` is the trailing (decision-time) 15-minute-equivalent return volatility
  in bps and ``participation`` = order notional / 15-minute-equivalent quote volume
  (square-root market-impact law).  Latency is absorbed in the volatility term.
* **Partial fills**: at most ``max_participation`` of the fill bar's quote volume executes;
  entry remainders are cancelled, exit remainders carry to the next bar.
* **Limit orders** fill only if price trades *through* the limit by ``limit_penetration_bps``
  (touches do not fill: queue position is unknown).  Marketable limits are treated as taker.
* **Stops** trigger on the bar's adverse extreme.  If the bar *opens* beyond the stop
  (gap), the fill is at the open, not the stop.  Stop fills pay double slippage.
* **Ambiguous bars**: if a stop and a take-profit are both inside one bar's range the stop
  is assumed to have executed first.
* **Rejections** occur with ``rejection_probability`` (seeded RNG) and for sub-minimum notional.

For paper trading with an *observed* order book, :meth:`fill_against_book` walks the book
levels instead of using the impact formula.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from quant_engine.config.settings import CostModelConfig
from quant_engine.core.types import Side


@dataclass(frozen=True, slots=True)
class Bar:
    open: float
    high: float
    low: float
    close: float
    volume: float  # base units


@dataclass(frozen=True, slots=True)
class SimFill:
    quantity: float
    price: float
    fee: float
    slippage_bps: float  # total adverse deviation from the reference price (spread + slippage)
    liquidity: str


@dataclass(frozen=True, slots=True)
class SimResult:
    fill: SimFill | None
    rejected: bool = False
    reason: str = ""
    remaining: float = 0.0


class ExecutionSimulator:
    def __init__(self, costs: CostModelConfig, rng: np.random.Generator | None = None,
                 bar_minutes: float = 60.0, cost_multiplier: float = 1.0, slippage_multiplier: float = 1.0) -> None:
        self.c = costs
        self.rng = rng or np.random.default_rng(0)
        self.bar_minutes = bar_minutes
        self.cost_mult = cost_multiplier
        self.slip_mult = slippage_multiplier

    # ------------------------------------------------------------------ cost components
    def half_spread_bps(self, symbol: str) -> float:
        return 0.5 * self.c.spread_bps.get(symbol, self.c.default_spread_bps) * self.slip_mult

    def taker_fee(self) -> float:
        return self.c.taker_fee * self.cost_mult

    def maker_fee(self) -> float:
        return self.c.maker_fee * self.cost_mult

    def slippage_bps(self, notional: float, bar: Bar, sigma_bps_bar: float) -> float:
        scale = np.sqrt(15.0 / self.bar_minutes)
        sigma15 = max(float(sigma_bps_bar), 0.0) * scale if np.isfinite(sigma_bps_bar) else 25.0
        quote_vol_15 = max(bar.volume * bar.open * (15.0 / self.bar_minutes), 1e-9)
        participation = notional / quote_vol_15
        slip = (self.c.base_slippage_bps + self.c.volatility_slippage_coef * sigma15
                + self.c.impact_coef * sigma15 * np.sqrt(participation))
        return float(slip * self.slip_mult)

    def _cap_quantity(self, qty: float, bar: Bar) -> float:
        cap = self.c.max_participation * bar.volume
        return min(qty, cap) if cap > 0 else 0.0

    def _maybe_reject(self) -> bool:
        return self.c.rejection_probability > 0 and self.rng.random() < self.c.rejection_probability

    # ------------------------------------------------------------------ order types
    def fill_market(self, symbol: str, side: Side, qty: float, bar: Bar, sigma_bps_bar: float,
                    allow_partial: bool = True) -> SimResult:
        if qty <= 0:
            return SimResult(None, True, "non_positive_quantity")
        if self._maybe_reject():
            return SimResult(None, True, "simulated_exchange_rejection", qty)
        fill_qty = self._cap_quantity(qty, bar) if allow_partial else qty
        if fill_qty <= 0:
            return SimResult(None, True, "no_liquidity", qty)
        notional = fill_qty * bar.open
        adverse_bps = self.half_spread_bps(symbol) + self.slippage_bps(notional, bar, sigma_bps_bar)
        price = bar.open * (1 + side.sign * adverse_bps / 1e4)
        fee = fill_qty * price * self.taker_fee()
        return SimResult(SimFill(fill_qty, price, fee, adverse_bps, "taker"), remaining=qty - fill_qty)

    def fill_limit(self, symbol: str, side: Side, qty: float, limit: float, bar: Bar,
                   sigma_bps_bar: float, resting: bool = True) -> SimResult:
        """Limit order evaluated against one bar.  ``resting`` = order was on the book before the bar."""
        if self._maybe_reject():
            return SimResult(None, True, "simulated_exchange_rejection", qty)
        marketable = (side is Side.BUY and limit >= bar.open) or (side is Side.SELL and limit <= bar.open)
        if marketable and not resting:
            res = self.fill_market(symbol, side, qty, bar, sigma_bps_bar)
            if res.fill and ((side is Side.BUY and res.fill.price > limit) or (side is Side.SELL and res.fill.price < limit)):
                return SimResult(None, False, "limit_not_reached", qty)
            return res
        pen = self.c.limit_penetration_bps / 1e4
        if side is Side.BUY:
            touched = bar.low < limit * (1 - pen)
            price = min(limit, bar.open) if resting else limit
        else:
            touched = bar.high > limit * (1 + pen)
            price = max(limit, bar.open) if resting else limit
        if not touched:
            return SimResult(None, False, "limit_not_reached", qty)
        price = limit  # conservative: no price improvement assumed
        fill_qty = self._cap_quantity(qty, bar)
        if fill_qty <= 0:
            return SimResult(None, False, "no_liquidity", qty)
        fee = fill_qty * price * self.maker_fee()
        return SimResult(SimFill(fill_qty, price, fee, 0.0, "maker"), remaining=qty - fill_qty)

    def stop_trigger_price(self, side: Side, stop: float, bar: Bar) -> float | None:
        """Exit stop for a position: SELL stop (long) triggers on low<=stop, BUY stop (short) on high>=stop.
        Returns the *reference* execution price (open if gapped through) or None."""
        if side is Side.SELL:
            if bar.open <= stop:
                return bar.open if self.c.gap_stop_fill_at_open else stop
            return stop if bar.low <= stop else None
        if bar.open >= stop:
            return bar.open if self.c.gap_stop_fill_at_open else stop
        return stop if bar.high >= stop else None

    def fill_stop(self, symbol: str, side: Side, qty: float, ref_price: float, bar: Bar,
                  sigma_bps_bar: float) -> SimFill:
        """Stops always fill in full (exit priority) with doubled slippage."""
        adverse_bps = self.half_spread_bps(symbol) + 2.0 * self.slippage_bps(qty * ref_price, bar, sigma_bps_bar)
        price = ref_price * (1 + side.sign * adverse_bps / 1e4)
        if side is Side.SELL:
            price = max(price, bar.low * (1 - adverse_bps / 1e4))
        fee = qty * price * self.taker_fee()
        return SimFill(qty, price, fee, adverse_bps, "taker")

    def take_profit_hit(self, side: Side, target: float, bar: Bar) -> bool:
        pen = self.c.limit_penetration_bps / 1e4
        if side is Side.SELL:  # closing a long
            return bar.high > target * (1 + pen)
        return bar.low < target * (1 - pen)

    def fill_take_profit(self, qty: float, target: float) -> SimFill:
        return SimFill(qty, target, qty * target * self.maker_fee(), 0.0, "maker")

    # ------------------------------------------------------------------ observed order book (paper)
    def fill_against_book(self, side: Side, qty: float, book_levels: list[tuple[float, float]],
                          extra_slippage_bps: float = 0.0) -> SimResult:
        """Walk observed book levels [(price, size), ...] (asks for BUY, bids for SELL)."""
        if self._maybe_reject():
            return SimResult(None, True, "simulated_exchange_rejection", qty)
        remaining, cost = qty, 0.0
        for px, sz in book_levels:
            take = min(remaining, sz)
            cost += take * px
            remaining -= take
            if remaining <= 1e-15:
                break
        filled = qty - max(remaining, 0.0)
        if filled <= 0:
            return SimResult(None, True, "empty_book", qty)
        vwap = cost / filled * (1 + side.sign * extra_slippage_bps / 1e4)
        top = book_levels[0][0]
        slip_bps = side.sign * (vwap / top - 1) * 1e4
        fee = filled * vwap * self.taker_fee()
        return SimResult(SimFill(filled, vwap, fee, slip_bps, "taker"), remaining=max(remaining, 0.0))
