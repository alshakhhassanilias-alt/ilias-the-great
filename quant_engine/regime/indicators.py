"""Causal technical indicators.

Every function here is *causal*: the output at row ``t`` depends only on rows ``<= t``.
This property is enforced by tests that recompute indicators on truncated data and
compare the last value with the full-history value (``tests/unit/test_indicators.py``).

Decision: indicators are implemented in-house rather than via ``pandas-ta`` because that
package's maintenance status is uncertain; formulas follow the standard definitions
(Wilder smoothing for ATR/RSI/ADX) and are unit-tested against hand computations.
"""

from __future__ import annotations

import warnings

import numpy as np
import pandas as pd


def ema(s: pd.Series, span: int) -> pd.Series:
    return s.ewm(span=span, adjust=False, min_periods=span).mean()


def sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n, min_periods=n).mean()


def wilder(s: pd.Series, n: int) -> pd.Series:
    """Wilder's smoothing (RMA): alpha = 1/n."""
    return s.ewm(alpha=1.0 / n, adjust=False, min_periods=n).mean()


def true_range(df: pd.DataFrame) -> pd.Series:
    prev_close = df["close"].shift(1)
    tr = pd.concat(
        [df["high"] - df["low"], (df["high"] - prev_close).abs(), (df["low"] - prev_close).abs()], axis=1
    ).max(axis=1)
    tr.iloc[0] = df["high"].iloc[0] - df["low"].iloc[0]
    return tr


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    return wilder(true_range(df), n)


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    d = close.diff()
    up = wilder(d.clip(lower=0), n)
    dn = wilder((-d).clip(lower=0), n)
    rs = up / dn.replace(0, np.nan)
    out = 100 - 100 / (1 + rs)
    out = out.where(dn != 0, 100.0)
    return out.where(up.notna())


def adx(df: pd.DataFrame, n: int = 14) -> pd.DataFrame:
    up_move = df["high"].diff()
    down_move = -df["low"].diff()
    plus_dm = pd.Series(np.where((up_move > down_move) & (up_move > 0), up_move, 0.0), index=df.index)
    minus_dm = pd.Series(np.where((down_move > up_move) & (down_move > 0), down_move, 0.0), index=df.index)
    tr_s = wilder(true_range(df), n)
    plus_di = 100 * wilder(plus_dm, n) / tr_s
    minus_di = 100 * wilder(minus_dm, n) / tr_s
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    return pd.DataFrame({"adx": wilder(dx, n), "plus_di": plus_di, "minus_di": minus_di})


def bollinger(close: pd.Series, n: int = 20, k: float = 2.0) -> pd.DataFrame:
    mid = sma(close, n)
    sd = close.rolling(n, min_periods=n).std(ddof=0)
    return pd.DataFrame({"mid": mid, "upper": mid + k * sd, "lower": mid - k * sd, "std": sd})


def zscore(s: pd.Series, n: int) -> pd.Series:
    m = s.rolling(n, min_periods=n).mean()
    sd = s.rolling(n, min_periods=n).std(ddof=0)
    return (s - m) / sd.replace(0, np.nan)


def donchian(df: pd.DataFrame, n: int) -> pd.DataFrame:
    """Channel of the *previous* ``n`` bars (excludes the current bar), so a breakout
    is ``close > upper`` without the current bar defining its own threshold."""
    upper = df["high"].rolling(n, min_periods=n).max().shift(1)
    lower = df["low"].rolling(n, min_periods=n).min().shift(1)
    return pd.DataFrame({"upper": upper, "lower": lower, "mid": (upper + lower) / 2})


def roc(close: pd.Series, n: int) -> pd.Series:
    return close / close.shift(n) - 1.0


def log_returns(close: pd.Series) -> pd.Series:
    return np.log(close).diff()


def realized_vol(close: pd.Series, n: int, periods_per_year: float | None = None) -> pd.Series:
    rv = log_returns(close).rolling(n, min_periods=n).std(ddof=1)
    return rv * np.sqrt(periods_per_year) if periods_per_year else rv


def rolling_percentile(s: pd.Series, n: int, min_periods: int | None = None) -> pd.Series:
    """Percentile rank (0..1) of the current value within the trailing window (inclusive)."""
    mp = min_periods or n
    return s.rolling(n, min_periods=mp).rank(pct=True)


def ema_slope(close: pd.Series, span: int, window: int) -> pd.Series:
    """Per-bar fractional slope of an EMA over ``window`` bars."""
    e = ema(close, span)
    return (e / e.shift(window) - 1.0) / window


def relative_volume(volume: pd.Series, n: int) -> pd.Series:
    """Current volume / mean of the *previous* ``n`` bars."""
    base = volume.rolling(n, min_periods=n).mean().shift(1)
    return volume / base.replace(0, np.nan)


def hurst_exponent(close: pd.Series, window: int = 120, max_lag: int = 20) -> pd.Series:
    """Rolling Hurst exponent via the scaling of lagged-difference dispersion.

    For lag ``k`` the standard deviation of ``log p_t - log p_{t-k}`` inside the trailing
    window scales like ``k^H``.  H is the OLS slope of ``log std`` on ``log k`` computed
    in closed form across lags, fully vectorised.  H>0.5 trending, H<0.5 mean reverting.
    """
    lp = np.log(close)
    lags = np.arange(2, max_lag + 1)
    cols = []
    for k in lags:
        d = lp - lp.shift(k)
        cols.append(np.log(d.rolling(window - k, min_periods=window - k).std(ddof=1)))
    y = pd.concat(cols, axis=1).to_numpy()
    x = np.log(lags.astype(float))
    xm = x - x.mean()
    with np.errstate(invalid="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        ym = y - np.nanmean(y, axis=1, keepdims=True)
        slope = (ym * xm).sum(axis=1) / (xm**2).sum()
    slope[~np.isfinite(y).all(axis=1)] = np.nan
    return pd.Series(slope, index=close.index, name="hurst")


def rsi_divergence(close: pd.Series, rsi_s: pd.Series, lookback: int = 14) -> pd.Series:
    """+1 bullish divergence (lower price low, higher RSI low), -1 bearish, 0 none. Causal."""
    p_low_prev = close.shift(1).rolling(lookback, min_periods=lookback).min()
    r_low_prev = rsi_s.shift(1).rolling(lookback, min_periods=lookback).min()
    p_high_prev = close.shift(1).rolling(lookback, min_periods=lookback).max()
    r_high_prev = rsi_s.shift(1).rolling(lookback, min_periods=lookback).max()
    bull = (close < p_low_prev) & (rsi_s > r_low_prev)
    bear = (close > p_high_prev) & (rsi_s < r_high_prev)
    return pd.Series(np.where(bull, 1, np.where(bear, -1, 0)), index=close.index)
