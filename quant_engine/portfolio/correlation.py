"""Correlation diagnostics between strategy / asset return streams."""

from __future__ import annotations

import numpy as np
import pandas as pd


def correlation_matrix(returns: pd.DataFrame) -> pd.DataFrame:
    return returns.corr()


def rolling_correlation(returns: pd.DataFrame, window: int = 90) -> dict[str, pd.Series]:
    """Pairwise rolling correlations keyed ``"a|b"``."""
    cols = list(returns.columns)
    out: dict[str, pd.Series] = {}
    for i, a in enumerate(cols):
        for b in cols[i + 1:]:
            out[f"{a}|{b}"] = returns[a].rolling(window, min_periods=window // 2).corr(returns[b])
    return out


def drawdown_correlation(returns: pd.DataFrame) -> pd.DataFrame:
    """Correlation of the drawdown series: do strategies lose money at the same time?"""
    eq = (1 + returns.fillna(0)).cumprod()
    dd = eq / eq.cummax() - 1
    return dd.corr()


def downside_correlation(returns: pd.DataFrame) -> pd.DataFrame:
    """Correlation conditional on the equal-weight portfolio having a down day."""
    port = returns.mean(axis=1)
    return returns[port < 0].corr()


def risk_contributions(returns: pd.DataFrame, weights: dict[str, float]) -> dict[str, float]:
    """Fractional contribution of each stream to portfolio variance: w_i (S w)_i / w'Sw."""
    cols = [c for c in returns.columns if c in weights]
    w = np.array([weights[c] for c in cols], dtype=float)
    cov = returns[cols].cov().to_numpy()
    var = float(w @ cov @ w)
    if var <= 0:
        return dict.fromkeys(cols, 0.0)
    rc = w * (cov @ w) / var
    return {c: float(x) for c, x in zip(cols, rc, strict=True)}
