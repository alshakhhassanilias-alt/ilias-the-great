"""Portfolio allocator: regime-aware weights per (strategy, symbol, time) for the engine."""

from __future__ import annotations

import numpy as np
import pandas as pd

from quant_engine.regime.allocation import RegimeAllocator
from quant_engine.strategies.momentum_flow import align_backward


def weight_arrays(
    allocator: RegimeAllocator, regimes_by_symbol: dict[str, pd.DataFrame], clock: pd.DatetimeIndex, strategy_ids: list[str]
) -> tuple[dict[str, dict[str, np.ndarray]], pd.DataFrame]:
    """For each strategy, a per-symbol weight array aligned to ``clock`` (causal: the regime
    used at time t is the one classified on the last closed regime bar <= t)."""
    out: dict[str, dict[str, np.ndarray]] = {sid: {} for sid in strategy_ids}
    log_rows = []
    for sym, reg in regimes_by_symbol.items():
        r = align_backward(reg[["regime", "confidence"]], clock)
        r["regime"] = r["regime"].fillna("neutral")
        r["confidence"] = r["confidence"].fillna(0.0)
        cache: dict[str, dict[str, float]] = {}
        arrs = {sid: np.zeros(len(clock)) for sid in strategy_ids}
        for i, g in enumerate(r["regime"].to_numpy()):
            if g not in cache:
                cache[g] = allocator.allocate(str(g)).weights
            for sid in strategy_ids:
                arrs[sid][i] = cache[g].get(sid, 0.0)
        for sid in strategy_ids:
            out[sid][sym] = arrs[sid]
        counts = r["regime"].value_counts(normalize=True)
        log_rows.append({"symbol": sym, **counts.to_dict()})
    return out, pd.DataFrame(log_rows)
