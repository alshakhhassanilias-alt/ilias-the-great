"""Order-book analytics computed from OBSERVED snapshots.

These are measurements of the live book.  They are kept separate from execution
*assumptions* (``CostModelConfig``) which drive backtest fills; the paper broker uses
observed levels directly when walking the book.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np


@dataclass(frozen=True)
class BookMetrics:
    best_bid: float
    best_ask: float
    mid: float
    spread: float
    spread_bps: float
    imbalance: float              # (bid_depth - ask_depth) / (bid_depth + ask_depth) within the band
    bid_depth_quote: float        # quote notional within +-band of mid
    ask_depth_quote: float
    band_bps: float
    impact_bps_buy: float | None  # VWAP slippage vs mid for a reference notional; None if book too thin
    impact_bps_sell: float | None
    reference_notional: float
    observed: bool = True

    def to_dict(self) -> dict:
        return asdict(self)


def _depth(levels: list[tuple[float, float]], lo: float, hi: float) -> float:
    return float(sum(p * q for p, q in levels if lo <= p <= hi))


def impact_bps(levels: list[tuple[float, float]], notional: float, mid: float) -> float | None:
    remaining, cost, qty = notional, 0.0, 0.0
    for p, q in levels:
        take = min(remaining, p * q)
        cost += take
        qty += take / p
        remaining -= take
        if remaining <= 1e-9:
            break
    if remaining > 1e-9 or qty == 0:
        return None
    vwap = cost / qty
    return float(abs(vwap / mid - 1) * 1e4)


def book_metrics(bids: list[tuple[float, float]], asks: list[tuple[float, float]], band_bps: float = 10.0,
                 reference_notional: float = 50_000.0) -> BookMetrics:
    if not bids or not asks:
        raise ValueError("empty order book")
    bb, ba = float(bids[0][0]), float(asks[0][0])
    if bb >= ba:
        raise ValueError(f"crossed book bid={bb} ask={ba}")
    mid = (bb + ba) / 2
    lo, hi = mid * (1 - band_bps / 1e4), mid * (1 + band_bps / 1e4)
    bd, ad = _depth(bids, lo, mid), _depth(asks, mid, hi)
    imb = (bd - ad) / (bd + ad) if bd + ad > 0 else 0.0
    return BookMetrics(bb, ba, mid, ba - bb, (ba - bb) / mid * 1e4, float(np.clip(imb, -1, 1)), bd, ad, band_bps,
                       impact_bps(asks, reference_notional, mid), impact_bps(bids, reference_notional, mid),
                       reference_notional)
