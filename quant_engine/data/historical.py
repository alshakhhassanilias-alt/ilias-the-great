"""Historical market-data acquisition.

* OHLCV: paginated CCXT ``fetch_ohlcv`` with retries / exponential backoff and incremental
  (head and tail) updates so unchanged history is never re-downloaded.
* Funding rates: Binance USD-M monthly archives from ``data.binance.vision`` (public,
  checksummed by Binance) plus OKX's public funding endpoint for the current month.
  Each funding row carries a ``source`` column; nothing is fabricated for missing periods.
"""

from __future__ import annotations

import io
import logging
import os
import time
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import ccxt
import httpx
import pandas as pd

from quant_engine.core.types import index_ms, timeframe_ms, ts_ms
from quant_engine.data.cache import ParquetCache
from quant_engine.data.normalization import ohlcv_to_frame
from quant_engine.data.validation import ValidationReport, clean_and_validate

log = logging.getLogger(__name__)

RETRYABLE = (ccxt.NetworkError, ccxt.RateLimitExceeded, ccxt.ExchangeNotAvailable, ccxt.RequestTimeout)


def with_retries(fn: Callable[[], Any], attempts: int = 6, base_delay: float = 0.5) -> Any:
    """Exponential backoff for transient failures; non-retryable errors propagate immediately."""
    for i in range(attempts):
        try:
            return fn()
        except RETRYABLE as exc:
            if i == attempts - 1:
                raise
            delay = base_delay * (2**i)
            log.warning("transient error %s; retrying in %.1fs", type(exc).__name__, delay)
            time.sleep(delay)
    raise RuntimeError("unreachable")  # pragma: no cover


@dataclass
class DownloadResult:
    symbol: str
    timeframe: str
    new_rows: int
    total_rows: int
    report: ValidationReport


class HistoricalDownloader:
    def __init__(self, exchange: ccxt.Exchange, exchange_name: str, cache: ParquetCache, limit: int = 1000):
        self.exchange = exchange
        self.exchange_name = exchange_name
        self.cache = cache
        self.limit = limit

    def _fetch_range(self, symbol: str, timeframe: str, since_ms: int, until_ms: int) -> pd.DataFrame:
        step = timeframe_ms(timeframe)
        frames: list[pd.DataFrame] = []
        cursor = since_ms
        empty_advances = 0
        while cursor < until_ms:
            # Bind loop variable explicitly for the retry closure.
            since = cursor
            rows = with_retries(lambda: self.exchange.fetch_ohlcv(symbol, timeframe, since=since, limit=self.limit))
            if not rows:
                # Possible exchange outage longer than one page: skip ahead, never invent data.
                cursor += step * self.limit
                empty_advances += 1
                if empty_advances > 5000:
                    break
                continue
            df = ohlcv_to_frame(rows)
            df = df[index_ms(df.index) >= cursor]
            if df.empty:
                cursor += step * self.limit
                continue
            frames.append(df)
            last_ms = ts_ms(df.index[-1])
            if last_ms + step <= cursor:  # no progress guard
                break
            cursor = last_ms + step
        if not frames:
            return ohlcv_to_frame([])
        out = pd.concat(frames)
        return out[index_ms(out.index) < until_ms]

    def download(
        self, symbol: str, timeframe: str, start: str | pd.Timestamp, end: str | pd.Timestamp | None = None
    ) -> DownloadResult:
        start_ts = pd.Timestamp(start, tz="UTC") if pd.Timestamp(start).tzinfo is None else pd.Timestamp(start)
        now = pd.Timestamp.now(tz="UTC")
        end_ts = now if end is None else pd.Timestamp(end, tz="UTC")
        step = timeframe_ms(timeframe)
        start_ms, end_ms = ts_ms(start_ts), ts_ms(end_ts)

        existing = self.cache.load(self.exchange_name, symbol, timeframe)
        parts = [existing]
        if existing.empty:
            parts.append(self._fetch_range(symbol, timeframe, start_ms, end_ms))
        else:
            first_ms = ts_ms(existing.index[0])
            last_ms = ts_ms(existing.index[-1])
            if start_ms < first_ms - step:
                parts.append(self._fetch_range(symbol, timeframe, start_ms, first_ms))
            if last_ms + step < end_ms:
                parts.append(self._fetch_range(symbol, timeframe, last_ms + step, end_ms))
        merged = pd.concat([p for p in parts if not p.empty]) if any(not p.empty for p in parts) else existing
        new_rows = len(merged) - len(existing)
        clean, report = clean_and_validate(merged, symbol, timeframe, now=now)
        if new_rows > 0 or not self.cache.path(self.exchange_name, symbol, timeframe).exists():
            self.cache.save(self.exchange_name, symbol, timeframe, clean)
        self.cache.update_index(self.exchange_name, symbol, timeframe, clean, report.to_dict())
        return DownloadResult(symbol, timeframe, max(new_rows, 0), len(clean), report)


# --------------------------------------------------------------------------------------
# Funding rates
# --------------------------------------------------------------------------------------
BINANCE_ARCHIVE = "https://data.binance.vision/data/futures/um/monthly/fundingRate/{s}/{s}-fundingRate-{y:04d}-{m:02d}.zip"


def _http_client() -> httpx.Client:
    return httpx.Client(timeout=30.0, follow_redirects=True, trust_env=True,
                        verify=os.environ.get("SSL_CERT_FILE", True))


def download_binance_funding_archive(raw_symbol: str, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    frames = []
    months = pd.period_range(start.tz_localize(None) if start.tzinfo else start,
                             end.tz_localize(None) if end.tzinfo else end, freq="M")
    with _http_client() as client:
        for p in months:
            url = BINANCE_ARCHIVE.format(s=raw_symbol, y=p.year, m=p.month)
            r = client.get(url)
            if r.status_code == 404:
                continue
            r.raise_for_status()
            with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
                name = zf.namelist()[0]
                df = pd.read_csv(zf.open(name))
            frames.append(df)
    if not frames:
        return pd.DataFrame(columns=["funding_rate", "source"])
    df = pd.concat(frames)
    # calc_time carries a few ms of jitter; round to the funding minute.
    ts = pd.to_datetime(df["calc_time"], unit="ms", utc=True).dt.round("min")
    out = pd.DataFrame({"funding_rate": df["last_funding_rate"].astype(float).to_numpy(),
                        "source": "binance_archive"}, index=pd.DatetimeIndex(ts, name="funding_time"))
    return out[~out.index.duplicated(keep="first")].sort_index()


def download_okx_funding_recent(okx: ccxt.Exchange, swap_symbol: str) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    until: int | None = None
    for _ in range(10):
        params = {"after": until} if until else {}
        req = dict(params)
        batch = with_retries(lambda: okx.fetch_funding_rate_history(swap_symbol, limit=100, params=req))
        if not batch:
            break
        rows.extend(batch)
        oldest = min(int(b["timestamp"]) for b in batch)
        if until is not None and oldest >= until:
            break
        until = oldest
    if not rows:
        return pd.DataFrame(columns=["funding_rate", "source"])
    idx = pd.to_datetime([int(r["timestamp"]) for r in rows], unit="ms", utc=True).round("min")
    out = pd.DataFrame({"funding_rate": [float(r["fundingRate"]) for r in rows], "source": "okx_api"},
                       index=pd.DatetimeIndex(idx, name="funding_time"))
    return out[~out.index.duplicated(keep="first")].sort_index()


def funding_coverage(df: pd.DataFrame) -> dict[str, Any]:
    if df.empty:
        return {"rows": 0}
    return {
        "rows": len(df),
        "first": df.index[0].isoformat(),
        "last": df.index[-1].isoformat(),
        "sources": df["source"].value_counts().to_dict(),
        "max_gap_hours": float(df.index.to_series().diff().max() / pd.Timedelta(hours=1)) if len(df) > 1 else None,
    }
