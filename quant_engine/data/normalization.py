"""Normalisation of exchange payloads into canonical frames and symbols."""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import pandas as pd

from quant_engine.core.types import timeframe_delta

OHLCV_COLUMNS = ["open", "high", "low", "close", "volume"]


def normalize_symbol(raw: str) -> str:
    """Map exchange-specific spellings to the unified ``BASE/QUOTE`` form.

    ``BTCUSDT`` / ``BTC-USDT`` / ``BTC_USDT`` / ``BTC/USDT:USDT`` -> ``BTC/USDT``.
    """
    s = raw.strip().upper()
    if ":" in s:
        s = s.split(":", 1)[0]
    for sep in ("-", "_"):
        if sep in s:
            parts = s.split(sep)
            if parts[-1] == "SWAP":
                parts = parts[:-1]
            return f"{parts[0]}/{parts[1]}"
    if "/" in s:
        return s
    for quote in ("USDT", "USDC", "BUSD", "USD", "BTC", "ETH"):
        if s.endswith(quote) and len(s) > len(quote):
            return f"{s[: -len(quote)]}/{quote}"
    raise ValueError(f"cannot normalise symbol {raw!r}")


def symbol_to_filename(symbol: str) -> str:
    return normalize_symbol(symbol).replace("/", "_")


def ohlcv_to_frame(rows: Sequence[Sequence[float]]) -> pd.DataFrame:
    """CCXT ``[[ts, o, h, l, c, v], ...]`` -> frame indexed by UTC open time."""
    if len(rows) == 0:
        idx = pd.DatetimeIndex([], tz="UTC", name="open_time")
        return pd.DataFrame(columns=OHLCV_COLUMNS, index=idx, dtype="float64")
    arr = np.asarray(rows, dtype="float64")
    idx = pd.to_datetime(arr[:, 0].astype("int64"), unit="ms", utc=True)
    df = pd.DataFrame(arr[:, 1:6], columns=OHLCV_COLUMNS, index=pd.DatetimeIndex(idx, name="open_time"))
    return df


def to_close_time_index(df: pd.DataFrame, timeframe: str) -> pd.DataFrame:
    """Re-index an open-time frame by bar **close** time (the instant the bar is known)."""
    out = df.copy()
    out.index = pd.DatetimeIndex(out.index + timeframe_delta(timeframe), name="close_time")
    return out


def resample_ohlcv(df: pd.DataFrame, source_tf: str, target_tf: str) -> pd.DataFrame:
    """Aggregate an *open-time indexed* frame to a coarser timeframe.

    Incomplete target bars (fewer constituent bars than expected) are dropped rather than
    emitted, so a partially-formed higher-timeframe candle is never used.
    """
    rule = {"15m": "15min", "1h": "1h", "4h": "4h", "1d": "1D"}[target_tf]
    agg = df.resample(rule, label="left", closed="left", origin="epoch").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    )
    counts = df["close"].resample(rule, label="left", closed="left", origin="epoch").count()
    expected = int(timeframe_delta(target_tf) / timeframe_delta(source_tf))
    agg = agg[counts == expected]
    agg.index.name = "open_time"
    return agg.dropna()
