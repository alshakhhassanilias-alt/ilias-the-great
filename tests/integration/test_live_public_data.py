"""Live public market-data integration (read-only; deselect with -m 'not network')."""

import asyncio

import pandas as pd
import pytest

from quant_engine.config.settings import load_config
from quant_engine.data.exchanges.factory import create_async_public_exchange, create_public_exchange
from quant_engine.data.ingestion import LiveMarketFeed

pytestmark = pytest.mark.network


def test_binance_public_mirror_ohlcv_and_book():
    cfg = load_config()
    ex = create_public_exchange(cfg.exchanges.exchanges["binance"])
    rows = ex.fetch_ohlcv("BTC/USDT", "15m", limit=5)
    assert len(rows) == 5 and all(r[2] >= max(r[1], r[4]) for r in rows)
    ob = ex.fetch_order_book("BTC/USDT", 10)
    assert ob["bids"][0][0] < ob["asks"][0][0]


def test_okx_public_funding():
    cfg = load_config()
    ex = create_public_exchange(cfg.exchanges.exchanges["okx"], market_type="swap")
    hist = ex.fetch_funding_rate_history("BTC/USDT:USDT", limit=3)
    assert hist and abs(float(hist[-1]["fundingRate"])) < 0.05


def test_live_feed_snapshot_and_closed_bars_only():
    cfg = load_config()

    async def run():
        feed = LiveMarketFeed(create_async_public_exchange(cfg.exchanges.exchanges["binance"]), ["BTC/USDT"], ["15m"])
        try:
            snaps = await feed.snapshot()
            updated = await feed.refresh_bars(lookback=50)
            await feed.check_clock()
            return feed, snaps, updated
        finally:
            await feed.close()

    feed, snaps, updated = asyncio.run(run())
    s = snaps["BTC/USDT"]
    assert s.bid < s.ask and s.last > 0 and s.age_seconds() < 120
    bars = feed.bars["BTC/USDT"]["15m"]
    assert updated == {"BTC/USDT": ["15m"]}
    assert bars.index[-1] <= pd.Timestamp.now(tz="UTC")  # close-time index: never an unfinished bar
    assert feed.book_features["BTC/USDT"]["fresh"]
    assert abs(feed.health.exchange_time_offset_ms) < 5_000
