"""Deterministic fakes for execution tests (no network, no credentials)."""

from __future__ import annotations

import ccxt
import pandas as pd

from quant_engine.data.ingestion import FeedHealth
from quant_engine.execution.exchange_adapter import SymbolSnapshot


class FakeFeed:
    def __init__(self, symbols=("BTC/USDT", "ETH/USDT", "SOL/USDT"), price=100.0, depth=1e6):
        self.symbols = list(symbols)
        self.prices = dict.fromkeys(self.symbols, price)
        self.depth = depth
        self.bars: dict = {s: {} for s in self.symbols}
        self.book_features: dict = {}
        self.health = FeedHealth()
        self.fail_snapshots = 0
        self.stale_seconds = 0.0
        self.pending_updates: dict = {}

    async def snapshot(self):
        if self.fail_snapshots > 0:
            self.fail_snapshots -= 1
            raise ccxt.NetworkError("simulated timeout")
        now = pd.Timestamp.now(tz="UTC")
        self.health.last_success = now - pd.Timedelta(seconds=self.stale_seconds)
        self.health.record_latency(20.0)
        out = {}
        for s, p in self.prices.items():
            out[s] = SymbolSnapshot(s, p, p - 0.01, p + 0.01, [(p - 0.01, self.depth)], [(p + 0.01, self.depth)],
                                    now - pd.Timedelta(seconds=self.stale_seconds), latency_ms=20.0)
        return out

    async def refresh_bars(self, lookback=600):
        u, self.pending_updates = self.pending_updates, {}
        return u

    async def check_clock(self):
        self.health.exchange_time_offset_ms = 0.0
        return 0.0

    def data_age_seconds(self):
        if self.health.last_success is None:
            return float("inf")
        return (pd.Timestamp.now(tz="UTC") - self.health.last_success).total_seconds()

    async def close(self):
        return None
