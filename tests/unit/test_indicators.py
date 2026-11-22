"""Indicator values against hand computations and known properties."""

import numpy as np
import pandas as pd
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from quant_engine.regime import indicators as ind
from tests.conftest import make_ohlcv


def test_ema_matches_recursive_definition():
    s = pd.Series([1.0, 2, 3, 4, 5, 6])
    e = ind.ema(s, 3)
    alpha = 0.5
    ref = [1.0]
    for x in s.iloc[1:]:
        ref.append(alpha * x + (1 - alpha) * ref[-1])
    assert np.isnan(e.iloc[1])
    assert e.iloc[5] == pytest.approx(ref[5])


def test_true_range_and_atr():
    df = pd.DataFrame({"open": [10, 11, 12.0], "high": [11, 13, 12.5], "low": [9, 10.5, 9.0], "close": [10.5, 12, 10.0]})
    tr = ind.true_range(df)
    assert list(tr) == [2.0, 2.5, 3.5]  # max(h-l, |h-pc|, |l-pc|)
    a = ind.atr(df, 2)
    assert a.iloc[1] == pytest.approx(2.0 * 0.5 + 2.5 * 0.5)  # Wilder alpha=1/2


def test_rsi_extremes():
    up = pd.Series(np.arange(1, 50, dtype=float))
    assert ind.rsi(up, 14).iloc[-1] == pytest.approx(100.0)
    down = pd.Series(np.arange(50, 1, -1, dtype=float))
    assert ind.rsi(down, 14).iloc[-1] == pytest.approx(0.0)


def test_bollinger_and_zscore_consistent():
    c = make_ohlcv(200, seed=2)["close"]
    bb = ind.bollinger(c, 20, 2.0)
    z = ind.zscore(c, 20)
    k = 150
    assert (c.iloc[k] - bb["mid"].iloc[k]) / bb["std"].iloc[k] == pytest.approx(z.iloc[k])


def test_hurst_distinguishes_trend_from_mean_reversion():
    rng = np.random.default_rng(0)
    n = 3000
    # Persistent increments (positively autocorrelated returns) -> H > 0.5.
    # Note: drift alone does not raise H for this estimator (dispersion removes the mean);
    # directional drift is captured by the regime detector's EMA slope / ADX instead.
    r = np.zeros(n)
    for i in range(1, n):
        r[i] = 0.7 * r[i - 1] + rng.normal(0, 0.001)
    trend = pd.Series(100 * np.exp(np.cumsum(r)))
    x = np.zeros(n)
    for i in range(1, n):
        x[i] = -0.6 * x[i - 1] + rng.normal(0, 0.01)
    mr = pd.Series(100 * np.exp(x))
    assert ind.hurst_exponent(trend, 200, 20).dropna().median() > 0.6
    assert ind.hurst_exponent(mr, 200, 20).dropna().median() < 0.4


def test_adx_high_in_strong_trend():
    n = 300
    idx = np.arange(n, dtype=float)
    df = pd.DataFrame({"high": 100 + idx + 0.5, "low": 100 + idx - 0.5, "close": 100 + idx, "open": 100 + idx - 0.2})
    assert ind.adx(df, 14)["adx"].iloc[-1] > 80


@settings(max_examples=40, deadline=None)
@given(st.lists(st.floats(min_value=1, max_value=1e5), min_size=30, max_size=200))
def test_rolling_percentile_bounded(xs):
    p = ind.rolling_percentile(pd.Series(xs), 20)
    v = p.dropna()
    assert ((v > 0) & (v <= 1)).all()


@settings(max_examples=40, deadline=None)
@given(st.integers(min_value=0, max_value=10_000))
def test_atr_positive_on_random_valid_bars(seed):
    d = make_ohlcv(100, seed=seed)
    a = ind.atr(d, 14).dropna()
    assert (a > 0).all()
