"""Look-ahead leakage tests: values at time t must not change when future data is removed."""

import numpy as np
import pandas as pd
import pytest

from quant_engine.data.normalization import resample_ohlcv, to_close_time_index
from quant_engine.regime import indicators as ind
from quant_engine.regime.detector import RegimeDetector
from quant_engine.strategies.base import SIGNAL_COLUMNS, MarketData
from quant_engine.strategies.registry import REGISTRY, build_strategy
from tests.conftest import make_ohlcv

SYMS = ["BTC/USDT", "ETH/USDT", "SOL/USDT"]


def build_md(n15=12_000, seed=0) -> MarketData:
    bars = {}
    funding = {}
    for k, s in enumerate(SYMS):
        df = make_ohlcv(n15, "15min", seed=seed + k, drift=0.00002 * (k - 1), vol=0.004, base=100 * (k + 1))
        df.index = df.index - pd.Timedelta("15min")  # -> open-time index
        df.index.name = "open_time"
        tfs = {"15m": df}
        for tf in ("1h", "4h"):
            tfs[tf] = resample_ohlcv(df, "15m", tf)
        bars[s] = {tf: to_close_time_index(d, tf) for tf, d in tfs.items()}
        fidx = pd.date_range(df.index[0], df.index[-1], freq="8h", tz="UTC")
        funding[s] = pd.DataFrame(
            {"funding_rate": np.random.default_rng(k).normal(1e-4, 2e-4, len(fidx)), "source": "test"}, index=fidx
        )
    return MarketData(bars, funding)


@pytest.fixture(scope="module")
def md():
    return build_md()


def truncate(md: MarketData, ts: pd.Timestamp) -> MarketData:
    return md.slice(None, ts)


@pytest.mark.parametrize("name", sorted(REGISTRY))
def test_strategy_signals_are_causal(name, md, cfg):
    st = build_strategy(name, cfg)
    st.fit(md.slice(None, md.get("BTC/USDT", "4h").index[300]))
    full = st.compute(md)
    tf_index = full["BTC/USDT"].index
    rng = np.random.default_rng(42)
    for k in rng.choice(np.arange(len(tf_index) // 2, len(tf_index) - 5), size=4, replace=False):
        ts = tf_index[k]
        part = st.compute(truncate(md, ts))
        for sym in st.symbols:
            a = full[sym].loc[:ts, SIGNAL_COLUMNS].tail(50)
            b = part[sym].loc[:ts, SIGNAL_COLUMNS].tail(50)
            pd.testing.assert_frame_equal(
                a.astype(float), b.astype(float), check_exact=False, rtol=1e-9, obj=f"{name} {sym} @ {ts}"
            )


INDICATORS = {
    "ema": lambda d: ind.ema(d["close"], 20),
    "atr": lambda d: ind.atr(d, 14),
    "rsi": lambda d: ind.rsi(d["close"], 14),
    "adx": lambda d: ind.adx(d, 14)["adx"],
    "zscore": lambda d: ind.zscore(d["close"], 20),
    "donchian": lambda d: ind.donchian(d, 20)["upper"],
    "hurst": lambda d: ind.hurst_exponent(d["close"], 100, 10),
    "relvol": lambda d: ind.relative_volume(d["volume"], 20),
    "pct": lambda d: ind.rolling_percentile(d["close"], 50),
    "div": lambda d: ind.rsi_divergence(d["close"], ind.rsi(d["close"]), 14),
}


@pytest.mark.parametrize("name", sorted(INDICATORS))
def test_indicators_are_causal(name):
    d = make_ohlcv(800, seed=3)
    fn = INDICATORS[name]
    full = fn(d)
    for k in (300, 500, 799):
        part = fn(d.iloc[: k + 1])
        np.testing.assert_allclose(part.iloc[-1], full.iloc[k], rtol=1e-9, equal_nan=True)


def test_regime_classification_is_causal():
    d = make_ohlcv(3000, "4h", seed=5)
    det = RegimeDetector()
    det.fit(d.iloc[:1500])
    full = det.classify(d)
    for k in (1800, 2400, 2999):
        part = det.classify(d.iloc[: k + 1])
        assert part["regime"].iloc[-1] == full["regime"].iloc[k]
        assert part["confidence"].iloc[-1] == pytest.approx(full["confidence"].iloc[k])


def test_donchian_excludes_current_bar():
    d = make_ohlcv(100, seed=1)
    dc = ind.donchian(d, 10)
    assert dc["upper"].iloc[50] == pytest.approx(d["high"].iloc[40:50].max())
