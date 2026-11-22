"""Performance metrics and statistical-validity tools.

Annualisation: crypto trades 24/7/365, so returns are resampled to **calendar-daily**
equity returns and annualised with sqrt(365) (volatility, Sharpe, Sortino) and a
365-day year (CAGR).  The risk-free rate is taken as 0 (cash benchmark).

Statistical tools
-----------------
* ``bootstrap_ci``: stationary (block) bootstrap confidence interval for any statistic.
* ``probabilistic_sharpe`` / ``deflated_sharpe``: Bailey & Lopez de Prado (2012, 2014),
  adjusting for non-normality and the number of trials (selection bias).
* ``pbo_cscv``: Probability of Backtest Overfitting via Combinatorially-Symmetric
  Cross-Validation (Bailey, Borwein, Lopez de Prado & Zhu, 2015).
"""

from __future__ import annotations

import itertools
import math
from collections.abc import Callable
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats

DAYS = 365.0
EULER_GAMMA = 0.5772156649015329


def daily_returns(equity: pd.Series) -> pd.Series:
    if equity.empty:
        return pd.Series(dtype=float)
    d = equity.resample("1D").last().dropna()
    first = equity.iloc[0]
    r = d.pct_change()
    if len(d):
        r.iloc[0] = d.iloc[0] / first - 1
    return r.fillna(0.0)


def sharpe(r: pd.Series | np.ndarray, periods: float = DAYS) -> float:
    r = np.asarray(r, dtype=float)
    if len(r) < 2 or np.std(r, ddof=1) == 0:
        return 0.0
    return float(np.mean(r) / np.std(r, ddof=1) * np.sqrt(periods))


def sortino(r: pd.Series | np.ndarray, periods: float = DAYS) -> float:
    r = np.asarray(r, dtype=float)
    if len(r) < 2:
        return 0.0
    downside = np.sqrt(np.mean(np.minimum(r, 0.0) ** 2))
    if downside == 0:
        return 0.0
    return float(np.mean(r) / downside * np.sqrt(periods))


def drawdown_series(equity: pd.Series) -> pd.Series:
    return equity / equity.cummax() - 1.0


def max_drawdown(equity: pd.Series) -> float:
    return float(-drawdown_series(equity).min()) if len(equity) else 0.0


def average_drawdown(equity: pd.Series) -> float:
    """Mean depth of distinct drawdown episodes."""
    dd = drawdown_series(equity)
    if dd.empty:
        return 0.0
    in_dd = dd < 0
    episode = (in_dd != in_dd.shift()).cumsum()[in_dd]
    if episode.empty:
        return 0.0
    return float(-dd[in_dd].groupby(episode).min().mean())


def cagr(equity: pd.Series) -> float:
    if len(equity) < 2 or equity.iloc[0] <= 0:
        return 0.0
    years = (equity.index[-1] - equity.index[0]) / pd.Timedelta(days=DAYS)
    if years <= 0:
        return 0.0
    total = equity.iloc[-1] / equity.iloc[0]
    return float(total ** (1 / years) - 1) if total > 0 else -1.0


def trade_metrics(trades: pd.DataFrame) -> dict[str, float]:
    n = len(trades)
    if n == 0:
        return {
            "total_trades": 0,
            "win_rate": 0.0,
            "profit_factor": 0.0,
            "avg_win": 0.0,
            "avg_loss": 0.0,
            "expectancy": 0.0,
            "avg_holding_hours": 0.0,
        }
    pnl = trades["pnl"].astype(float)
    wins, losses = pnl[pnl > 0], pnl[pnl <= 0]
    gross_loss = -losses.sum()
    hold = pd.to_datetime(trades["exit_time"], utc=True) - pd.to_datetime(trades["entry_time"], utc=True)
    return {
        "total_trades": int(n),
        "win_rate": float(len(wins) / n),
        "profit_factor": float(wins.sum() / gross_loss) if gross_loss > 0 else (float("inf") if len(wins) else 0.0),
        "avg_win": float(wins.mean()) if len(wins) else 0.0,
        "avg_loss": float(losses.mean()) if len(losses) else 0.0,
        "expectancy": float(pnl.mean()),
        "avg_holding_hours": float(hold.dt.total_seconds().mean() / 3600),
    }


def performance_summary(
    equity: pd.Series, trades: pd.DataFrame, gross_exposure: pd.Series | None = None, stats_in: dict[str, Any] | None = None
) -> dict[str, Any]:
    r = daily_returns(equity)
    mdd = max_drawdown(equity)
    ann = cagr(equity)
    net = float(equity.iloc[-1] / equity.iloc[0] - 1) if len(equity) else 0.0
    years = max((equity.index[-1] - equity.index[0]) / pd.Timedelta(days=DAYS), 1e-9) if len(equity) > 1 else 1.0
    avg_eq = float(equity.mean()) if len(equity) else 0.0
    st = stats_in or {}
    costs = float(st.get("fees", 0.0) + st.get("slippage_cost", 0.0) + st.get("funding", 0.0))
    out: dict[str, Any] = {
        "start": str(equity.index[0]) if len(equity) else None,
        "end": str(equity.index[-1]) if len(equity) else None,
        "days": len(r),
        "net_return": net,
        "annualized_return": ann,
        "annualized_volatility": float(np.std(r, ddof=1) * np.sqrt(DAYS)) if len(r) > 1 else 0.0,
        "sharpe": sharpe(r),
        "sortino": sortino(r),
        "calmar": float(ann / mdd) if mdd > 0 else 0.0,
        "max_drawdown": mdd,
        "average_drawdown": average_drawdown(equity),
        "recovery_factor": float((equity.iloc[-1] - equity.iloc[0]) / (mdd * equity.cummax().max()))
        if mdd > 0 and len(equity)
        else 0.0,
        "trading_costs": costs,
        "fees": float(st.get("fees", 0.0)),
        "slippage_cost": float(st.get("slippage_cost", 0.0)),
        "funding": float(st.get("funding", 0.0)),
        "turnover_annualized": float(st.get("traded_notional", 0.0) / avg_eq / years) if avg_eq > 0 else 0.0,
    }
    if gross_exposure is not None and len(gross_exposure):
        ge = gross_exposure.fillna(0.0)
        out["exposure_time_fraction"] = float((ge > 1e-9).mean())
        out["avg_gross_exposure"] = float(ge.mean())
    out.update(trade_metrics(trades))
    return out


# --------------------------------------------------------------------------------------
# Statistical validity
# --------------------------------------------------------------------------------------
def stationary_bootstrap_indices(n: int, block: int, rng: np.random.Generator) -> np.ndarray:
    """Politis-Romano stationary bootstrap: geometric block lengths with mean ``block``."""
    p = 1.0 / max(block, 1)
    idx = np.empty(n, dtype=int)
    idx[0] = rng.integers(n)
    jumps = rng.random(n) < p
    starts = rng.integers(n, size=n)
    for t in range(1, n):
        idx[t] = starts[t] if jumps[t] else (idx[t - 1] + 1) % n
    return idx


def bootstrap_ci(
    x: np.ndarray, stat: Callable[[np.ndarray], float], n_boot: int = 2000, block: int = 5, alpha: float = 0.05, seed: int = 0
) -> tuple[float, float, float]:
    x = np.asarray(x, dtype=float)
    if len(x) < 10:
        return (float("nan"),) * 3  # type: ignore[return-value]
    rng = np.random.default_rng(seed)
    vals = np.array([stat(x[stationary_bootstrap_indices(len(x), block, rng)]) for _ in range(n_boot)])
    return float(stat(x)), float(np.quantile(vals, alpha / 2)), float(np.quantile(vals, 1 - alpha / 2))


def probabilistic_sharpe(r: np.ndarray, sr_benchmark: float = 0.0) -> float:
    """P(true per-period SR > sr_benchmark) given sample skew/kurtosis (non-annualised SR)."""
    r = np.asarray(r, dtype=float)
    n = len(r)
    if n < 10 or np.std(r, ddof=1) == 0:
        return 0.0
    sr = np.mean(r) / np.std(r, ddof=1)
    g3 = stats.skew(r)
    g4 = stats.kurtosis(r, fisher=False)
    denom = math.sqrt(max(1 - g3 * sr + (g4 - 1) / 4 * sr**2, 1e-12))
    return float(stats.norm.cdf((sr - sr_benchmark) * math.sqrt(n - 1) / denom))


def expected_max_sharpe(sr_variance: float, n_trials: int) -> float:
    """Expected maximum of ``n_trials`` per-period Sharpe estimates under the null."""
    if n_trials <= 1 or sr_variance <= 0:
        return 0.0
    z1 = stats.norm.ppf(1 - 1.0 / n_trials)
    z2 = stats.norm.ppf(1 - 1.0 / (n_trials * math.e))
    return float(math.sqrt(sr_variance) * ((1 - EULER_GAMMA) * z1 + EULER_GAMMA * z2))


def deflated_sharpe(r: np.ndarray, trial_sharpes: np.ndarray, n_trials: int | None = None) -> dict[str, float]:
    """DSR = PSR evaluated against the expected max SR across all trials (per-period units).

    ``trial_sharpes`` estimates the cross-trial Sharpe variance; ``n_trials`` (default: their
    count) is the total number of configurations tried, which may exceed the sample given.
    """
    trial_sharpes = np.asarray(trial_sharpes, dtype=float)
    trial_sharpes = trial_sharpes[np.isfinite(trial_sharpes)]
    n_trials = max(n_trials or len(trial_sharpes), 1)
    var = float(np.var(trial_sharpes, ddof=1)) if len(trial_sharpes) > 1 else 0.0
    sr0 = expected_max_sharpe(var, n_trials)
    return {
        "dsr": probabilistic_sharpe(r, sr0),
        "sr_threshold_per_period": sr0,
        "n_trials": n_trials,
        "trial_sharpe_variance": var,
    }


def pbo_cscv(trial_returns: pd.DataFrame, n_splits: int = 16) -> dict[str, Any]:
    """Probability of Backtest Overfitting.

    ``trial_returns``: T x N matrix (rows = periods, columns = parameter configurations).
    The rows are split into ``n_splits`` contiguous blocks; for every combination of half the
    blocks as in-sample, the best in-sample configuration's out-of-sample relative rank is
    recorded.  PBO = fraction of combinations where that rank is below the median.
    """
    m = trial_returns.dropna(how="all").fillna(0.0).to_numpy()
    t, n = m.shape
    if n < 2 or t < n_splits * 2:
        return {"pbo": float("nan"), "combinations": 0, "reason": "insufficient data"}
    blocks = np.array_split(np.arange(t), n_splits)
    logits = []
    for is_blocks in itertools.combinations(range(n_splits), n_splits // 2):
        is_idx = np.concatenate([blocks[b] for b in is_blocks])
        oos_idx = np.concatenate([blocks[b] for b in range(n_splits) if b not in is_blocks])
        is_sr = _col_sharpe(m[is_idx])
        oos_sr = _col_sharpe(m[oos_idx])
        best = int(np.argmax(is_sr))
        rank = stats.rankdata(oos_sr)[best] / (n + 1)
        logits.append(math.log(rank / (1 - rank)))
    logits_a = np.array(logits)
    return {"pbo": float(np.mean(logits_a <= 0)), "combinations": len(logits_a), "median_logit": float(np.median(logits_a))}


def _col_sharpe(m: np.ndarray) -> np.ndarray:
    sd = m.std(axis=0, ddof=1)
    with np.errstate(divide="ignore", invalid="ignore"):
        s = np.where(sd > 0, m.mean(axis=0) / sd, 0.0)
    return s
