"""Strategy research tournament and promotion decisions.

Promotion is multi-criteria by design; no single metric can promote a strategy:

* sample size (OOS trades), bootstrap Sharpe CI lower bound, Deflated Sharpe probability,
  PBO, OOS max drawdown, fraction of positive walk-forward windows, profit factor,
  survival under cost stress, diversification contribution, and (after freezing) the
  untouched final holdout.

A Sharpe below ``review_sharpe_threshold`` (1.0) puts an otherwise-passing strategy under
REVIEW rather than auto-rejecting or auto-promoting it.  If nothing qualifies the
tournament says so explicitly.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from quant_engine.config.settings import PromotionCriteria
from quant_engine.portfolio.correlation import (
    correlation_matrix,
    downside_correlation,
    drawdown_correlation,
    risk_contributions,
    rolling_correlation,
)
from quant_engine.regime.allocation import ValidationStatus


def evaluate_promotion(s: dict[str, Any], crit: PromotionCriteria) -> tuple[ValidationStatus, dict[str, Any]]:
    checks = {
        "min_oos_trades": (s["total_trades"] >= crit.min_oos_trades, s["total_trades"], crit.min_oos_trades),
        "sharpe_ci_lower": (s["sharpe_ci_lower"] > crit.min_oos_sharpe_ci_lower, s["sharpe_ci_lower"],
                            crit.min_oos_sharpe_ci_lower),
        "deflated_sharpe": (s["dsr"] >= crit.min_deflated_sharpe_prob, s["dsr"], crit.min_deflated_sharpe_prob),
        "pbo": (np.isfinite(s["pbo"]) and s["pbo"] <= crit.max_pbo, s["pbo"], crit.max_pbo),
        "max_drawdown": (s["max_drawdown"] <= crit.max_oos_drawdown, s["max_drawdown"], crit.max_oos_drawdown),
        "positive_windows": (s["positive_window_fraction"] >= crit.min_positive_window_fraction,
                             s["positive_window_fraction"], crit.min_positive_window_fraction),
        "profit_factor": (s["profit_factor"] >= crit.min_profit_factor, s["profit_factor"], crit.min_profit_factor),
        "cost_stress": ((s["stress_net_return"] > 0) or not crit.must_survive_cost_stress, s["stress_net_return"], 0.0),
    }
    out = {k: {"passed": bool(v[0]), "value": _f(v[1]), "threshold": v[2]} for k, v in checks.items()}
    passed_all = all(v["passed"] for v in out.values())
    if passed_all:
        status = ValidationStatus.UNDER_REVIEW if s["sharpe"] < crit.review_sharpe_threshold else ValidationStatus.PROMOTED
    elif s["net_return"] <= 0 or s["sharpe_ci_upper"] < 0:
        status = ValidationStatus.REJECTED
    else:
        status = ValidationStatus.RESEARCH_ONLY
    return status, out


def _f(x: Any) -> Any:
    try:
        return round(float(x), 4)
    except (TypeError, ValueError):
        return x


def tournament_report(oos_daily: dict[str, pd.Series], weights: dict[str, float] | None = None,
                      rolling_window: int = 90) -> dict[str, Any]:
    df = pd.DataFrame(oos_daily).fillna(0.0)
    if df.shape[1] < 2:
        return {"note": "fewer than two strategies with OOS returns"}
    w = weights or dict.fromkeys(df.columns, 1.0 / df.shape[1])
    roll = rolling_correlation(df, rolling_window)
    corr = correlation_matrix(df)
    rep = {
        "correlation": corr.round(3).to_dict(),
        "drawdown_correlation": drawdown_correlation(df).round(3).to_dict(),
        "downside_correlation": downside_correlation(df).round(3).to_dict(),
        "risk_contribution_equal_weight": {k: round(v, 4) for k, v in risk_contributions(df, w).items()},
        "rolling_correlation_summary": {k: {"mean": _f(v.mean()), "min": _f(v.min()), "max": _f(v.max()),
                                            "last": _f(v.dropna().iloc[-1]) if v.notna().any() else None}
                                        for k, v in roll.items()},
    }
    high = [(a, b, float(corr.loc[a, b])) for i, a in enumerate(corr.columns) for b in corr.columns[i + 1:]
            if corr.loc[a, b] > 0.7]
    rep["highly_correlated_pairs"] = high
    rep["_rolling"] = roll
    return rep


def regime_performance(trades: pd.DataFrame, regimes_by_symbol: dict[str, pd.DataFrame]) -> dict[str, Any]:
    """PnL / trade stats grouped by the regime known at trade entry."""
    if trades.empty:
        return {}
    tags = []
    for _, t in trades.iterrows():
        reg = regimes_by_symbol.get(t["symbol"])
        if reg is None or reg.empty:
            tags.append("unknown")
            continue
        sub = reg.loc[: pd.Timestamp(t["entry_time"])]
        tags.append(str(sub["regime"].iloc[-1]) if len(sub) else "unknown")
    tt = trades.assign(regime=tags)
    g = tt.groupby("regime")["pnl"]
    return {r: {"trades": int(g.count()[r]), "net_pnl": _f(g.sum()[r]), "win_rate": _f((tt[tt.regime == r].pnl > 0).mean()),
                "avg_pnl": _f(g.mean()[r])} for r in g.count().index}
