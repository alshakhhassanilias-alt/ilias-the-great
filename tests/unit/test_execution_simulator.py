import numpy as np
import pytest

from quant_engine.backtest.execution_simulator import Bar, ExecutionSimulator
from quant_engine.config.settings import CostModelConfig
from quant_engine.core.types import Side

BAR = Bar(open=100.0, high=105.0, low=95.0, close=101.0, volume=1_000.0)


def sim(**kw):
    return ExecutionSimulator(CostModelConfig(**kw), np.random.default_rng(1), bar_minutes=60)


def test_market_fill_is_adverse_and_charges_taker_fee():
    s = sim()
    buy = s.fill_market("BTC/USDT", Side.BUY, 1.0, BAR, sigma_bps_bar=50).fill
    sell = s.fill_market("BTC/USDT", Side.SELL, 1.0, BAR, sigma_bps_bar=50).fill
    assert buy.price > BAR.open > sell.price
    assert buy.fee == pytest.approx(buy.quantity * buy.price * 0.001)
    assert buy.liquidity == "taker"


def test_slippage_increases_with_size_and_volatility():
    s = sim()
    assert s.slippage_bps(1e6, BAR, 50) > s.slippage_bps(1e3, BAR, 50)
    assert s.slippage_bps(1e3, BAR, 100) > s.slippage_bps(1e3, BAR, 20)


def test_partial_fill_capped_by_participation():
    s = sim(max_participation=0.05)
    res = s.fill_market("BTC/USDT", Side.BUY, 100.0, BAR, 50)
    assert res.fill.quantity == pytest.approx(50.0)
    assert res.remaining == pytest.approx(50.0)


def test_limit_touch_does_not_fill_but_trade_through_does():
    s = sim(limit_penetration_bps=2.0)
    touch = Bar(100, 101, 95.0, 100, 1000)
    assert s.fill_limit("BTC/USDT", Side.BUY, 1, 95.0, touch, 50).fill is None
    through = Bar(100, 101, 94.0, 100, 1000)
    f = s.fill_limit("BTC/USDT", Side.BUY, 1, 95.0, through, 50).fill
    assert f.price == 95.0 and f.liquidity == "maker"


def test_stop_gap_fills_at_open_not_stop():
    s = sim()
    gap = Bar(open=90.0, high=92.0, low=88.0, close=91.0, volume=1000)
    assert s.stop_trigger_price(Side.SELL, 95.0, gap) == 90.0
    normal = Bar(open=100.0, high=101.0, low=94.0, close=96.0, volume=1000)
    assert s.stop_trigger_price(Side.SELL, 95.0, normal) == 95.0
    assert s.stop_trigger_price(Side.SELL, 93.0, normal) is None
    f = s.fill_stop("BTC/USDT", Side.SELL, 1.0, 95.0, normal, 50)
    assert f.price < 95.0


def test_rejection_probability_is_seeded():
    s = sim(rejection_probability=1.0)
    r = s.fill_market("BTC/USDT", Side.BUY, 1.0, BAR, 50)
    assert r.rejected and r.fill is None


def test_book_walk_vwap():
    s = sim()
    res = s.fill_against_book(Side.BUY, 3.0, [(100.0, 1.0), (101.0, 1.0), (102.0, 5.0)])
    assert res.fill.price == pytest.approx(101.0)
    assert res.fill.slippage_bps == pytest.approx(100.0)
    short = s.fill_against_book(Side.BUY, 10.0, [(100.0, 1.0)])
    assert short.remaining == pytest.approx(9.0)


def test_cost_multiplier_scales_fees():
    s = ExecutionSimulator(CostModelConfig(), np.random.default_rng(0), 60, cost_multiplier=2.0)
    assert s.taker_fee() == pytest.approx(0.002)
