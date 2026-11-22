"""Market-data integrity validation.

Checks are *reporting*, never silent repair: duplicates are dropped (keeping the first
occurrence, which is identical for exchange data) and counted; gaps are reported and
**never interpolated**; invalid OHLC rows are flagged and excluded from research.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from quant_engine.core.types import timeframe_delta


@dataclass
class ValidationReport:
    symbol: str
    timeframe: str
    rows: int = 0
    first: str | None = None
    last: str | None = None
    duplicates: int = 0
    unsorted: bool = False
    missing_bars: int = 0
    gaps: list[tuple[str, str, int]] = field(default_factory=list)
    invalid_ohlc: int = 0
    nonpositive_prices: int = 0
    negative_volume: int = 0
    zero_volume_bars: int = 0
    price_jump_anomalies: int = 0
    volume_anomalies: int = 0
    unfinished_last_bar_dropped: bool = False
    expected_bars: int = 0

    @property
    def completeness(self) -> float:
        return 0.0 if self.expected_bars == 0 else self.rows / self.expected_bars

    @property
    def passed(self) -> bool:
        """Hard integrity gate used before any backtest."""
        return (
            self.rows > 0
            and not self.unsorted
            and self.invalid_ohlc == 0
            and self.nonpositive_prices == 0
            and self.negative_volume == 0
            and self.completeness >= 0.995
        )

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["completeness"] = round(self.completeness, 6)
        d["passed"] = self.passed
        d["gaps"] = self.gaps[:50]
        d["gap_count"] = len(self.gaps)
        return d


def clean_and_validate(
    df: pd.DataFrame,
    symbol: str,
    timeframe: str,
    now: pd.Timestamp | None = None,
    jump_sigma: float = 12.0,
    volume_sigma: float = 15.0,
) -> tuple[pd.DataFrame, ValidationReport]:
    """Return (clean frame, report).  ``df`` is open-time indexed."""
    rep = ValidationReport(symbol=symbol, timeframe=timeframe)
    if df.empty:
        return df, rep
    step = timeframe_delta(timeframe)

    rep.unsorted = not df.index.is_monotonic_increasing
    df = df.sort_index()
    dup_mask = df.index.duplicated(keep="first")
    rep.duplicates = int(dup_mask.sum())
    df = df[~dup_mask]
    rep.unsorted = False  # resolved by sorting; duplicates counted separately

    # Drop an unfinished last candle: open + tf must be <= now.
    now = now if now is not None else pd.Timestamp.now(tz="UTC")
    if len(df) and df.index[-1] + step > now:
        df = df.iloc[:-1]
        rep.unfinished_last_bar_dropped = True

    o, h, low, c, v = (df[k].to_numpy() for k in ("open", "high", "low", "close", "volume"))
    nonpos = (o <= 0) | (h <= 0) | (low <= 0) | (c <= 0)
    bad_ohlc = (h < np.maximum(o, c) - 1e-12) | (low > np.minimum(o, c) + 1e-12) | (h < low)
    rep.nonpositive_prices = int(nonpos.sum())
    rep.invalid_ohlc = int(bad_ohlc.sum())
    rep.negative_volume = int((v < 0).sum())
    rep.zero_volume_bars = int((v == 0).sum())
    bad = nonpos | bad_ohlc | (v < 0) | ~np.isfinite(o + h + low + c + v)
    if bad.any():
        df = df[~bad]

    # Gaps (never filled).
    if len(df) > 1:
        diffs = df.index.to_series().diff().iloc[1:]
        gap_mask = diffs > step
        for ts, d in diffs[gap_mask].items():
            n_missing = int(d / step) - 1
            rep.missing_bars += n_missing
            rep.gaps.append(((ts - d).isoformat(), ts.isoformat(), n_missing))
        rep.expected_bars = int((df.index[-1] - df.index[0]) / step) + 1

    # Anomalies: robust z-scores of log returns and log volume.
    lr = np.diff(np.log(df["close"].to_numpy()))
    if len(lr) > 50:
        med = np.median(lr)
        mad = np.median(np.abs(lr - med)) * 1.4826 or 1e-12
        rep.price_jump_anomalies = int((np.abs(lr - med) / mad > jump_sigma).sum())
    lv = np.log1p(df["volume"].to_numpy())
    if len(lv) > 50:
        med = np.median(lv)
        mad = np.median(np.abs(lv - med)) * 1.4826 or 1e-12
        rep.volume_anomalies = int(((lv - med) / mad > volume_sigma).sum())

    rep.rows = len(df)
    rep.first = df.index[0].isoformat() if len(df) else None
    rep.last = df.index[-1].isoformat() if len(df) else None
    return df, rep
