"""Capital weights across strategy sleeves: capped inverse-volatility (risk-parity-lite).

Mean-variance optimisation is deliberately avoided: expected-return estimates from short
OOS samples are too noisy and would concentrate capital in the luckiest backtest.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def inverse_vol_weights(returns: pd.DataFrame, caps: dict[str, float] | None = None,
                        total: float = 1.0) -> dict[str, float]:
    vol = returns.std(ddof=1).replace(0, np.nan)
    inv = (1 / vol).fillna(0.0)
    if inv.sum() == 0:
        return dict.fromkeys(returns.columns, 0.0)
    w = inv / inv.sum() * total
    caps = caps or {}
    for _ in range(10):  # iterative capping with redistribution
        over = {k: v for k, v in w.items() if v > caps.get(k, total)}
        if not over:
            break
        excess = sum(v - caps.get(k, total) for k, v in over.items())
        for k in over:
            w[k] = caps.get(k, total)
        free = [k for k in w.index if k not in over and w[k] < caps.get(k, total)]
        if not free:
            break
        w[free] += excess * w[free] / w[free].sum()
    return {k: float(v) for k, v in w.items()}
