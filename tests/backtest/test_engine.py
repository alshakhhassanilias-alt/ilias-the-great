"""Deterministic engine scenarios with hand-checkable numbers."""

import numpy as np
import pandas as pd
import pytest

from quant_engine.backtest.engine import BacktestEngine, StrategyRun
from quant_engine.config.settings import BacktestConfig, CostModelConfig, RiskConfig
from quant_engine.strategies.base import empty_signal_frame

SYM = "BTC/USDT"
N = 60


def flat_bars(n=N, price=100.0, vol=1e7):
    idx = pd.date_range("2024-01-01 01:00", periods=n, freq="1h", tz="UTC", name="close_time")
    return pd.DataFrame({"open": price, "high": price + 1, "low": price - 1, "close": price, "volume": vol}, index=idx)


def signals(bars, at, entry=1, stop=5.0, tp=10.0, hold=0, conf=1.0):
    sf = empty_signal_frame(bars.index, bars["close"])
    sf.iloc[at, sf.columns.get_loc("entry")] = entry
    sf.iloc[at, sf.columns.get_loc("stop_dist")] = stop
    sf.iloc[at, sf.columns.get_loc("tp_dist")] = tp
    sf.iloc[at, sf.columns.get_loc("confidence")] = conf
    sf["hold_bars"] = hold
    return sf


def zero_cost():
    return BacktestConfig(
        costs=CostModelConfig(
            taker_fee=0,
            maker_fee=0,
            spread_bps={},
            default_spread_bps=0,
            base_slippage_bps=0,
            volatility_slippage_coef=0,
            impact_coef=0,
            unknown_funding_rate_8h=0,
        )
    )


def engine(bars, bt=None, enforce=False, funding=None):
    return BacktestEngine(bt or zero_cost(), RiskConfig(), "1h", {SYM: bars}, funding or {}, enforce_circuit_breakers=enforce)


def test_entry_executes_at_next_open_not_signal_close():
    b = flat_bars()
    b.iloc[11, b.columns.get_loc("open")] = 102.0  # next bar opens higher
    b.iloc[11, b.columns.get_loc("high")] = 103.0
    sf = signals(b, 10, tp=np.nan)
    res = engine(b).run([StrategyRun("t", "1h", {SYM: sf})])
    t = res.trades.iloc[0]
    assert t["entry_price"] == pytest.approx(102.0)  # not the 100 close of the signal bar
    assert pd.Timestamp(t["entry_time"]) == b.index[10]  # = open time of bar 11


def test_stop_loss_pnl_matches_hand_calculation():
    b = flat_bars()
    b.iloc[20, b.columns.get_loc("low")] = 94.0
    res = engine(b).run([StrategyRun("t", "1h", {SYM: signals(b, 10)})])
    t = res.trades.iloc[0]
    # qty = 100k * 1% / 5 = 200 ; exit at stop 95 with zero costs
    assert t["quantity"] == pytest.approx(200.0)
    assert t["exit_reason"] == "stop_loss"
    assert t["exit_price"] == pytest.approx(95.0)
    assert t["pnl"] == pytest.approx(-1000.0)
    assert res.equity.iloc[-1] == pytest.approx(99_000.0)


def test_stop_before_take_profit_when_both_in_bar():
    b = flat_bars()
    b.iloc[20, b.columns.get_loc("low")] = 94.0
    b.iloc[20, b.columns.get_loc("high")] = 111.0
    res = engine(b).run([StrategyRun("t", "1h", {SYM: signals(b, 10)})])
    assert res.trades.iloc[0]["exit_reason"] == "stop_loss"


def test_take_profit_requires_trade_through():
    b = flat_bars()
    b.iloc[20, b.columns.get_loc("high")] = 110.0  # touch only
    b.iloc[25, b.columns.get_loc("high")] = 111.0
    res = engine(b).run([StrategyRun("t", "1h", {SYM: signals(b, 10)})])
    t = res.trades.iloc[0]
    assert t["exit_reason"] == "take_profit"
    assert pd.Timestamp(t["exit_time"]) == b.index[25]
    assert t["pnl"] == pytest.approx(2000.0)


def test_gap_through_stop_fills_at_open():
    b = flat_bars()
    b.iloc[20, b.columns.get_loc("open")] = 90.0
    b.iloc[20, b.columns.get_loc("low")] = 89.0
    res = engine(b).run([StrategyRun("t", "1h", {SYM: signals(b, 10)})])
    assert res.trades.iloc[0]["exit_price"] == pytest.approx(90.0)


def test_costs_reduce_equity():
    b = flat_bars()
    res_free = engine(b).run([StrategyRun("t", "1h", {SYM: signals(b, 10, tp=np.nan)})])
    res_cost = engine(b, BacktestConfig()).run([StrategyRun("t", "1h", {SYM: signals(b, 10, tp=np.nan)})])
    assert res_free.equity.iloc[-1] == pytest.approx(100_000.0)
    assert res_cost.equity.iloc[-1] < 100_000.0 - 2 * 20_000 * 0.001 * 0.99  # >= two taker fees
    assert res_cost.trades.iloc[0]["exit_reason"] == "end_of_window"


def test_time_stop_closes_position():
    b = flat_bars()
    res = engine(b).run([StrategyRun("t", "1h", {SYM: signals(b, 10, tp=np.nan, hold=5)})])
    assert res.trades.iloc[0]["exit_reason"] == "time_stop"


def test_funding_charged_to_long():
    b = flat_bars()
    f = pd.DataFrame({"funding_rate": [0.001]}, index=pd.DatetimeIndex([b.index[30]]))
    res = engine(b, funding={SYM: f}).run([StrategyRun("t", "1h", {SYM: signals(b, 10, tp=np.nan)})])
    # 200 units * 100 * 0.001 = 20 paid
    assert res.stats["funding"] == pytest.approx(20.0)
    assert res.equity.iloc[-1] == pytest.approx(100_000 - 20)


def _crash_bars(level):
    b = flat_bars(120)
    b.iloc[20, b.columns.get_loc("open")] = level  # catastrophic gap through the stop
    b.iloc[20, b.columns.get_loc("low")] = level - 1
    b.iloc[20:, b.columns.get_loc("close")] = level
    b.loc[b.index[21:], ["open", "high", "low"]] = [level, level + 1, level - 1]
    sf = signals(b, 10, stop=5.0, tp=np.nan)
    sf.iloc[40, sf.columns.get_loc("entry")] = 1  # next UTC day
    sf.iloc[40, sf.columns.get_loc("stop_dist")] = 3.0
    sf.iloc[40, sf.columns.get_loc("confidence")] = 1.0
    return b, sf


def test_total_drawdown_breach_halts_permanently():
    b, sf = _crash_bars(40.0)  # 200 units x 60 = 12% loss > 10% total limit
    res = engine(b, enforce=True).run([StrategyRun("t", "1h", {SYM: sf})])
    assert any(e.event_type == "circuit_breaker" and "total_drawdown" in e.message for e in res.risk_events)
    assert len(res.trades) == 1  # second entry rejected while halted
    assert res.stats["reject_reasons"].get("halted", 0) >= 1
    assert res.stats["halted_at_end"]


def test_daily_breach_resumes_next_day_only_under_backtest_policy():
    b, sf = _crash_bars(60.0)  # 8% loss: daily breach, not total
    res = engine(b, enforce=True).run([StrategyRun("t", "1h", {SYM: sf})])
    assert res.stats["breaches"] == {"daily_drawdown": 1}
    assert len(res.trades) == 2  # simulated operator re-authorisation on the next UTC day
    assert any(e.event_type == "resume_authorized" for e in res.risk_events)


def test_no_pyramiding_and_reverse():
    b = flat_bars()
    sf = signals(b, 10, tp=np.nan)
    sf.iloc[12, sf.columns.get_loc("entry")] = 1  # same direction: ignored
    sf.iloc[12, sf.columns.get_loc("stop_dist")] = 5
    sf.iloc[20, sf.columns.get_loc("entry")] = -1  # reverse
    sf.iloc[20, sf.columns.get_loc("stop_dist")] = 5
    sf.iloc[20, sf.columns.get_loc("confidence")] = 1.0
    res = engine(b).run([StrategyRun("t", "1h", {SYM: sf})])
    assert list(res.trades["direction"]) == [1, -1]
    assert res.trades.iloc[0]["exit_reason"] == "reverse"
