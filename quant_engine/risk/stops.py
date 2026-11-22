"""Protective stop / take-profit validation and trailing logic."""

from __future__ import annotations

from quant_engine.config.settings import StopConfig
from quant_engine.core.types import Direction, Position


def validate_protection(direction: Direction, entry: float, stop: float | None, tp: float | None,
                        atr: float | None, cfg: StopConfig) -> list[str]:
    """Return reasons the protective levels are unacceptable (empty list = OK)."""
    errs: list[str] = []
    if stop is None:
        if cfg.require_protective_orders:
            errs.append("missing_stop_loss")
        return errs
    if not (entry > 0 and stop > 0):
        errs.append("non_positive_price")
        return errs
    if direction is Direction.LONG and stop >= entry:
        errs.append("stop_on_wrong_side")
    if direction is Direction.SHORT and stop <= entry:
        errs.append("stop_on_wrong_side")
    dist = abs(entry - stop)
    if dist / entry > cfg.max_stop_distance_pct:
        errs.append("stop_too_wide")
    if atr is not None and atr > 0 and dist < cfg.min_stop_distance_atr * atr:
        errs.append("stop_too_tight")
    if tp is not None:
        if direction is Direction.LONG and tp <= entry:
            errs.append("take_profit_on_wrong_side")
        if direction is Direction.SHORT and tp >= entry:
            errs.append("take_profit_on_wrong_side")
    return errs


def atr_levels(direction: Direction, entry: float, atr: float, stop_mult: float,
               tp_mult: float | None) -> tuple[float, float | None]:
    stop = entry - int(direction) * stop_mult * atr
    tp = entry + int(direction) * tp_mult * atr if tp_mult else None
    return stop, tp


def update_trailing_stop(pos: Position, bar_high: float, bar_low: float) -> float | None:
    """Ratchet a trailing stop using the *completed* bar's extreme; never loosens."""
    if pos.trailing_stop_distance is None or pos.quantity == 0:
        return pos.stop_loss
    if pos.quantity > 0:
        pos.highest_price = max(pos.highest_price or bar_high, bar_high)
        cand = pos.highest_price - pos.trailing_stop_distance
        if pos.stop_loss is None or cand > pos.stop_loss:
            pos.stop_loss = cand
    else:
        pos.lowest_price = min(pos.lowest_price or bar_low, bar_low)
        cand = pos.lowest_price + pos.trailing_stop_distance
        if pos.stop_loss is None or cand < pos.stop_loss:
            pos.stop_loss = cand
    return pos.stop_loss
