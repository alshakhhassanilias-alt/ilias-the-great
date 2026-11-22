"""Live public market-data ingestion (polling, async CCXT).

Each poll fetches tickers and order books (and closed candles when a new bar is due),
measures API latency, and reports freshness.  Unfinished candles are always dropped.
Network failures are retried with exponential backoff and surfaced to the health monitor;
they never produce synthetic data.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

import ccxt.async_support as accxt
import pandas as pd

from quant_engine.core.types import timeframe_delta
from quant_engine.data.normalization import ohlcv_to_frame, to_close_time_index
from quant_engine.data.orderbook import book_metrics
from quant_engine.execution.exchange_adapter import SymbolSnapshot

log = logging.getLogger(__name__)


@dataclass
class FeedHealth:
    last_success: pd.Timestamp | None = None
    last_error: str | None = None
    consecutive_errors: int = 0
    latency_ms: float = 0.0
    requests: int = 0
    errors: int = 0
    exchange_time_offset_ms: float | None = None
    latencies: list[float] = field(default_factory=list)

    def record_latency(self, ms: float) -> None:
        self.latency_ms = ms
        self.latencies = ([*self.latencies, ms])[-200:]


class LiveMarketFeed:
    def __init__(self, exchange: accxt.Exchange, symbols: list[str], timeframes: list[str],
                 book_depth: int = 20, max_retries: int = 3) -> None:
        self.ex = exchange
        self.symbols = symbols
        self.timeframes = timeframes
        self.book_depth = book_depth
        self.max_retries = max_retries
        self.health = FeedHealth()
        self.bars: dict[str, dict[str, pd.DataFrame]] = {s: {} for s in symbols}
        self.book_features: dict[str, dict[str, Any]] = {}

    async def _call(self, fn, *args, **kwargs):  # noqa: ANN001
        delay = 0.5
        for attempt in range(self.max_retries):
            t0 = time.perf_counter()
            try:
                self.health.requests += 1
                res = await fn(*args, **kwargs)
                self.health.record_latency((time.perf_counter() - t0) * 1000)
                self.health.consecutive_errors = 0
                self.health.last_success = pd.Timestamp.now(tz="UTC")
                return res
            except (accxt.NetworkError, accxt.ExchangeNotAvailable, accxt.RequestTimeout) as exc:
                self.health.errors += 1
                self.health.consecutive_errors += 1
                self.health.last_error = f"{type(exc).__name__}: {str(exc)[:160]}"
                if attempt == self.max_retries - 1:
                    raise
                await asyncio.sleep(delay)
                delay *= 2
        raise RuntimeError("unreachable")

    async def check_clock(self) -> float | None:
        """Local clock minus exchange clock (ms).  None if the exchange has no time endpoint."""
        try:
            t0 = time.time() * 1000
            server = await self._call(self.ex.fetch_time)
            t1 = time.time() * 1000
            self.health.exchange_time_offset_ms = (t0 + t1) / 2 - float(server)
        except Exception as exc:
            log.warning("clock check failed: %s", exc)
            return None
        return self.health.exchange_time_offset_ms

    async def snapshot(self) -> dict[str, SymbolSnapshot]:
        out: dict[str, SymbolSnapshot] = {}

        async def one(sym: str) -> None:
            t0 = time.perf_counter()
            ticker, book = await asyncio.gather(self._call(self.ex.fetch_ticker, sym),
                                                self._call(self.ex.fetch_order_book, sym, self.book_depth))
            lat = (time.perf_counter() - t0) * 1000
            bids = [(float(p), float(q)) for p, q, *_ in book["bids"]]
            asks = [(float(p), float(q)) for p, q, *_ in book["asks"]]
            ts = ticker.get("timestamp") or book.get("timestamp")
            snap = SymbolSnapshot(sym, float(ticker["last"]), float(bids[0][0]) if bids else float(ticker["bid"] or 0),
                                  float(asks[0][0]) if asks else float(ticker["ask"] or 0), bids, asks,
                                  pd.Timestamp(ts, unit="ms", tz="UTC") if ts else None, latency_ms=lat)
            out[sym] = snap
            try:
                m = book_metrics(bids, asks)
                self.book_features[sym] = {**m.to_dict(), "timestamp": snap.received_at.isoformat(), "fresh": True}
            except ValueError as exc:
                self.book_features[sym] = {"fresh": False, "error": str(exc)}

        await asyncio.gather(*(one(s) for s in self.symbols))
        return out

    async def refresh_bars(self, lookback: int = 600) -> dict[str, list[str]]:
        """Fetch recent CLOSED bars; returns {symbol: [timeframes with a new closed bar]}."""
        updated: dict[str, list[str]] = {}
        now = pd.Timestamp.now(tz="UTC")
        for sym in self.symbols:
            for tf in self.timeframes:
                cur = self.bars[sym].get(tf)
                step = timeframe_delta(tf)
                if cur is not None and len(cur) and now < cur.index[-1] + step:
                    continue  # next bar not closed yet
                rows = await self._call(self.ex.fetch_ohlcv, sym, tf, None, min(lookback, 1000))
                df = ohlcv_to_frame(rows)
                df = df[df.index + step <= now]  # drop the unfinished candle
                df = to_close_time_index(df, tf)
                if cur is not None and len(cur):
                    df = pd.concat([cur, df])
                    df = df[~df.index.duplicated(keep="last")].sort_index().iloc[-lookback:]
                if cur is None or not len(cur) or df.index[-1] > cur.index[-1]:
                    updated.setdefault(sym, []).append(tf)
                self.bars[sym][tf] = df
        return updated

    def data_age_seconds(self) -> float:
        if self.health.last_success is None:
            return float("inf")
        return (pd.Timestamp.now(tz="UTC") - self.health.last_success).total_seconds()

    async def close(self) -> None:
        await self.ex.close()
