"""Shared deterministic fixtures. No test in this suite places real orders or uses credentials."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("PAPER_MODE", "true")
os.environ.setdefault("LIVE_TRADING_ENABLED", "false")

from quant_engine.config.settings import load_config  # noqa: E402


@pytest.fixture(scope="session")
def cfg():
    return load_config()


def make_ohlcv(
    n: int = 2000,
    tf: str = "1h",
    seed: int = 0,
    drift: float = 0.0,
    vol: float = 0.01,
    start: str = "2023-01-01",
    base: float = 100.0,
) -> pd.DataFrame:
    """Close-time-indexed synthetic OHLCV with valid OHLC relationships."""
    rng = np.random.default_rng(seed)
    step = pd.Timedelta(tf)
    idx = pd.date_range(pd.Timestamp(start, tz="UTC") + step, periods=n, freq=step, name="close_time")
    r = rng.normal(drift, vol, n)
    close = base * np.exp(np.cumsum(r))
    open_ = np.r_[base, close[:-1]]
    wig = np.abs(rng.normal(0, vol / 2, n))
    high = np.maximum(open_, close) * (1 + wig)
    low = np.minimum(open_, close) * (1 - wig)
    volume = rng.lognormal(10, 0.3, n)
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close, "volume": volume}, index=idx)


@pytest.fixture
def ohlcv():
    return make_ohlcv()
