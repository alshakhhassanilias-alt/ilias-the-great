"""Strategy D - Cross-Asset Relative Strength and Pairs Rotation.

Two modes:

``relative_strength`` (default)
    Volatility-normalised momentum ``log(P_t/P_{t-L}) / (sigma * sqrt(L))`` is ranked across
    BTC/ETH/SOL on epoch-aligned rebalance bars.  If the strongest-minus-weakest spread
    exceeds ``min_spread_z`` *and* the two legs are sufficiently correlated (so the short leg
    actually hedges the long leg), go long the leader and short the laggard.  Legs are
    sized by the risk engine to equal *risk* (ATR stops), i.e. volatility-neutral rather than
    dollar-neutral, which keeps net beta exposure controlled.

``spread_reversion``
    Only enabled when :meth:`fit` finds, **on training data only**, a pair whose log-price
    spread is Engle-Granger cointegrated (p < 0.05) with a stable hedge ratio across
    training sub-periods.  Correlation alone is never treated as cointegration.

:meth:`fit` always records cointegration diagnostics and hedge-ratio stability for
reporting, whichever mode is active.
"""

from __future__ import annotations

import itertools
from typing import Any

import numpy as np
import pandas as pd
from statsmodels.tsa.stattools import coint

from quant_engine.core.types import timeframe_delta
from quant_engine.regime import indicators as ind
from quant_engine.strategies.base import MarketData, Strategy, empty_signal_frame


def hedge_ratio(y: pd.Series, x: pd.Series) -> tuple[float, float]:
    """OLS of y on x with intercept: returns (beta, alpha)."""
    xv, yv = x.to_numpy(), y.to_numpy()
    xm, ym = xv.mean(), yv.mean()
    beta = float(((xv - xm) * (yv - ym)).sum() / ((xv - xm) ** 2).sum())
    return beta, float(ym - beta * xm)


class PairsRotation(Strategy):
    strategy_id = "pairs_rotation"
    description = "Volatility-normalised cross-asset relative strength rotation with cointegration diagnostics"

    def fit(self, train: MarketData) -> dict[str, Any]:
        closes = pd.concat({s: train.get(s, self.timeframe)["close"] for s in self.symbols}, axis=1).dropna()
        diag: dict[str, Any] = {}
        best: tuple[str, str, float, float, float] | None = None
        if len(closes) >= 200:
            lp = np.log(closes)
            for a, b in itertools.combinations(self.symbols, 2):
                beta, alpha = hedge_ratio(lp[a], lp[b])
                try:
                    _, pval, _ = coint(lp[a], lp[b])
                except Exception:  # numerical failure -> treat as not cointegrated
                    pval = 1.0
                chunks = np.array_split(lp.index, 4)
                betas = [hedge_ratio(lp.loc[ch, a], lp.loc[ch, b])[0] for ch in chunks if len(ch) > 30]
                cv = float(np.std(betas) / abs(np.mean(betas))) if betas and np.mean(betas) != 0 else np.inf
                resid = lp[a] - beta * lp[b] - alpha
                diag[f"{a}~{b}"] = {
                    "beta": beta,
                    "alpha": alpha,
                    "coint_pvalue": float(pval),
                    "beta_cv_subperiods": cv,
                    "corr_logret": float(lp[a].diff().corr(lp[b].diff())),
                    "resid_mean": float(resid.mean()),
                    "resid_std": float(resid.std()),
                }
                if pval < 0.05 and cv < 0.25 and (best is None or pval < best[4]):
                    best = (a, b, beta, alpha, float(pval))
        self.fitted = {"diagnostics": diag, "cointegrated_pair": best}
        return self.fitted

    def compute(self, data: MarketData, params: dict[str, Any] | None = None) -> dict[str, pd.DataFrame]:
        p = {**self.params, **(params or {})}
        if p.get("mode", "relative_strength") == "spread_reversion":
            return self._compute_spread(data, p)
        return self._compute_rs(data, p)

    def _common(self, data: MarketData) -> tuple[pd.DataFrame, dict[str, pd.DataFrame]]:
        frames = {s: data.get(s, self.timeframe) for s in self.symbols}
        closes = pd.concat({s: f["close"] for s, f in frames.items()}, axis=1).dropna()
        return closes, frames

    def _rebalance_mask(self, idx: pd.DatetimeIndex, every: int) -> np.ndarray:
        step = timeframe_delta(self.timeframe).value
        bar_no = idx.as_unit("ns").asi8 // step
        return np.asarray(bar_no % every == 0)

    def _compute_rs(self, data: MarketData, p: dict[str, Any]) -> dict[str, pd.DataFrame]:
        closes, frames = self._common(data)
        lb, vlb = int(p["momentum_lookback"]), int(p["vol_lookback"])
        lr = np.log(closes).diff()
        sigma = lr.rolling(vlb, min_periods=vlb).std()
        mom = np.log(closes / closes.shift(lb)) / (sigma * np.sqrt(lb))
        corr_lb = int(p["corr_lookback"])
        valid = mom.notna().all(axis=1)
        mvals = mom.to_numpy()
        top = np.where(valid, np.nanargmax(np.where(np.isfinite(mvals), mvals, -np.inf), axis=1), -1)
        bot = np.where(valid, np.nanargmin(np.where(np.isfinite(mvals), mvals, np.inf), axis=1), -1)
        spread = np.where(
            valid,
            np.nanmax(np.where(np.isfinite(mvals), mvals, -np.inf), axis=1)
            - np.nanmin(np.where(np.isfinite(mvals), mvals, np.inf), axis=1),
            np.nan,
        )
        cols = list(closes.columns)
        # pairwise rolling correlations of the chosen legs
        corr_cache = {
            (a, b): lr[a].rolling(corr_lb, min_periods=corr_lb).corr(lr[b]).to_numpy() for a, b in itertools.permutations(cols, 2)
        }
        leg_corr = np.full(len(closes), np.nan)
        for i in range(len(closes)):
            if top[i] >= 0 and bot[i] >= 0 and top[i] != bot[i]:
                leg_corr[i] = corr_cache[(cols[top[i]], cols[bot[i]])][i]
        active = valid.to_numpy() & (spread > float(p["min_spread_z"])) & (leg_corr > float(p["min_corr"]))
        rebal = self._rebalance_mask(closes.index, int(p["rebalance_bars"]))

        out: dict[str, pd.DataFrame] = {}
        for j, sym in enumerate(cols):
            f = frames[sym].reindex(closes.index)
            a = ind.atr(frames[sym], int(p["atr_period"])).reindex(closes.index)
            sf = empty_signal_frame(closes.index, closes[sym])
            is_top = (top == j) & active
            is_bot = (bot == j) & active
            sf["entry"] = np.where(rebal & is_top, 1, np.where(rebal & is_bot, -1, 0))
            sf["exit_long"] = rebal & ~is_top
            sf["exit_short"] = rebal & ~is_bot
            sf["stop_dist"] = float(p["stop_atr"]) * a.to_numpy()
            sf["confidence"] = np.where(
                sf["entry"] != 0, np.clip(np.nan_to_num(spread) / (3 * float(p["min_spread_z"])), 0.05, 1.0), 0.0
            )
            sf["hold_bars"] = int(p["max_hold_bars"])
            sf["leg_corr"] = leg_corr
            sf["rs_spread"] = spread
            sf.loc[a.isna().to_numpy() | f["close"].isna().to_numpy(), "entry"] = 0
            out[sym] = sf
        return out

    def _compute_spread(self, data: MarketData, p: dict[str, Any]) -> dict[str, pd.DataFrame]:
        closes, frames = self._common(data)
        out = {s: empty_signal_frame(closes.index, closes[s]) for s in closes.columns}
        pair = self.fitted.get("cointegrated_pair")
        if not pair:
            return out  # no statistically supported pair: strategy stays flat
        a_sym, b_sym, beta, alpha, _ = pair
        lp = np.log(closes)
        resid = lp[a_sym] - beta * lp[b_sym] - alpha
        z = ind.zscore(resid, int(p["corr_lookback"]))
        entry_z = max(float(p["min_spread_z"]) * 2, 1.5)
        for sym, sign in ((a_sym, 1), (b_sym, -1)):
            a = ind.atr(frames[sym], int(p["atr_period"])).reindex(closes.index)
            sf = out[sym]
            # spread too high -> short A / long B ; too low -> long A / short B
            sf["entry"] = np.where(z > entry_z, -sign, np.where(z < -entry_z, sign, 0))
            sf["exit_long"] = ((z >= 0) if sign == 1 else (z <= 0)).to_numpy()
            sf["exit_short"] = ((z <= 0) if sign == 1 else (z >= 0)).to_numpy()
            sf["stop_dist"] = float(p["stop_atr"]) * a.to_numpy()
            sf["confidence"] = np.where(sf["entry"] != 0, np.clip(z.abs().to_numpy() / 4, 0.05, 1.0), 0.0)
            sf["hold_bars"] = int(p["max_hold_bars"])
            sf.loc[a.isna().to_numpy() | z.isna().to_numpy(), "entry"] = 0
        return out
