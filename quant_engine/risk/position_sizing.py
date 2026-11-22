"""Position sizing.

* **Fixed fractional / volatility-adjusted**: quantity = (equity x risk fraction) / stop distance.
  Because stops are ATR-based, this automatically scales size inversely to volatility.
* **Fractional Kelly**: only when the trade sample is large enough *and* the Kelly estimate is
  statistically stable (relative standard error below a threshold).  Kelly is computed on
  R-multiples (PnL / initial risk): f* = E[R] / E[R^2] (risk fraction), multiplied by
  ``kelly_multiplier`` (<= 0.25) and clamped to [0, max_risk_per_trade].  Unreliable estimates
  fall back to the conservative fixed fraction.
* **Correlation-aware scaling**: positively-correlated same-direction exposure reduces size.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from quant_engine.config.settings import PositionSizingConfig


@dataclass(frozen=True)
class KellyEstimate:
    fraction: float | None  # risk fraction (already multiplied), None = unreliable
    raw: float | None
    n: int
    relative_se: float | None
    reason: str


def kelly_from_r_multiples(r: np.ndarray, cfg: PositionSizingConfig) -> KellyEstimate:
    r = np.asarray(r, dtype=float)
    r = r[np.isfinite(r)]
    n = len(r)
    if n < cfg.kelly_min_trades:
        return KellyEstimate(None, None, n, None, f"insufficient trades ({n} < {cfg.kelly_min_trades})")
    m2 = float(np.mean(r**2))
    mu = float(np.mean(r))
    if m2 <= 0:
        return KellyEstimate(None, None, n, None, "degenerate outcomes")
    raw = mu / m2
    se_mu = float(np.std(r, ddof=1) / np.sqrt(n))
    rel_se = abs(se_mu / mu) if mu != 0 else np.inf
    if rel_se > cfg.kelly_max_relative_se:
        return KellyEstimate(None, raw, n, rel_se, f"unstable estimate (rel SE {rel_se:.2f})")
    frac = float(np.clip(raw * cfg.kelly_multiplier, 0.0, cfg.max_risk_per_trade))
    return KellyEstimate(frac, raw, n, rel_se, "ok")


def base_risk_fraction(cfg: PositionSizingConfig, proposed: float | None, kelly: KellyEstimate | None) -> tuple[float, str]:
    frac = min(proposed if proposed and proposed > 0 else cfg.risk_per_trade, cfg.max_risk_per_trade)
    if cfg.use_kelly and kelly is not None and kelly.fraction is not None:
        return float(kelly.fraction), "fractional_kelly"
    return float(frac), "fixed_fractional"


def correlation_scale(
    new_symbol: str, new_dir: int, existing: list[tuple[str, int]], corr_fn, threshold: float
) -> tuple[float, list[str]]:
    """Scale factor in (0, 1]; penalises positively-correlated same-direction exposure."""
    penalty, notes = 0.0, []
    for sym, d in existing:
        rho = 1.0 if sym == new_symbol else corr_fn(new_symbol, sym)
        if rho is None or not np.isfinite(rho):
            rho = 1.0  # unknown correlation: assume the worst
        eff = rho * np.sign(new_dir * d)
        if eff > threshold:
            penalty += eff
            notes.append(f"{sym}:{eff:.2f}")
    return 1.0 / np.sqrt(1.0 + penalty), notes


def quantity_for_risk(equity: float, risk_fraction: float, entry: float, stop: float) -> float:
    dist = abs(entry - stop)
    if dist <= 0 or equity <= 0 or risk_fraction <= 0:
        return 0.0
    return equity * risk_fraction / dist
