"""Load cached, validated market data into research structures (close-time indexed)."""

from __future__ import annotations

import pandas as pd

from quant_engine.config.settings import AppConfig, EnvSettings
from quant_engine.data.cache import ParquetCache
from quant_engine.data.normalization import to_close_time_index
from quant_engine.data.validation import clean_and_validate
from quant_engine.strategies.base import MarketData


class DataIntegrityError(RuntimeError):
    pass


def load_market_data(cfg: AppConfig, env: EnvSettings, symbols: list[str] | None = None,
                     timeframes: list[str] | None = None, exchange: str | None = None,
                     end: pd.Timestamp | None = None, require_valid: bool = True) -> tuple[MarketData, dict]:
    exchange = exchange or cfg.exchanges.market_data_primary
    cache = ParquetCache(env.market_data_dir)
    symbols = symbols or cfg.research.symbols
    timeframes = timeframes or cfg.research.timeframes
    bars: dict[str, dict[str, pd.DataFrame]] = {}
    reports: dict[str, dict] = {}
    for s in symbols:
        bars[s] = {}
        for tf in timeframes:
            raw = cache.load(exchange, s, tf)
            if raw.empty:
                raise DataIntegrityError(f"no cached data for {s} {tf}; run scripts/download_data.py")
            clean, rep = clean_and_validate(raw, s, tf)
            reports[f"{s} {tf}"] = rep.to_dict()
            if require_valid and not rep.passed:
                raise DataIntegrityError(f"data integrity check failed for {s} {tf}: {rep.to_dict()}")
            df = to_close_time_index(clean, tf)
            bars[s][tf] = df.loc[:end] if end is not None else df
    funding: dict[str, pd.DataFrame] = {}
    for s in symbols:
        f = cache.load(exchange, s, "8h", kind="funding")
        if not f.empty:
            f = f.copy()
            f.index = pd.DatetimeIndex(f.index).tz_convert("UTC")
            funding[s] = f.loc[:end] if end is not None else f
    return MarketData(bars, funding), reports
