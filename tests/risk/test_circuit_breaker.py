import pandas as pd
import pytest

from quant_engine.config.settings import CircuitBreakerConfig
from quant_engine.risk.circuit_breaker import BreakerAction, CircuitBreaker, RiskState

D1 = pd.Timestamp("2024-01-01 01:00", tz="UTC")


def cb(persist=None):
    events = []
    return CircuitBreaker(CircuitBreakerConfig(), RiskState(), persist, events.append), events


def test_daily_drawdown_breach_halts_and_requires_authorization():
    b, _ev = cb()
    b.update_equity(D1, 100_000)
    out = b.update_equity(D1 + pd.Timedelta(hours=1), 96_900)
    assert out and out[0].action is BreakerAction.HALT_AND_FLATTEN
    assert b.state.halted and b.state.requires_authorization and b.state.flatten_pending


def test_total_drawdown_from_high_water_mark():
    b, _ = cb()
    b.update_equity(D1, 100_000)
    b.update_equity(D1 + pd.Timedelta(days=1), 110_000)
    for k, e in enumerate([108_000, 106_500, 105_000, 103_000, 101_000, 98_900], start=2):
        b.state.halted = False  # isolate the total-DD rule from daily breaches
        out = b.update_equity(D1 + pd.Timedelta(days=k), e)
    assert any("total_drawdown" in o.message for o in out)


def test_day_rollover_resets_daily_baseline():
    b, _ = cb()
    b.update_equity(D1, 100_000)
    b.update_equity(D1 + pd.Timedelta(hours=5), 98_000)  # -2%
    out = b.update_equity(D1 + pd.Timedelta(days=1), 96_500)  # new day baseline 96,500
    assert not out and not b.state.halted


def test_resume_requires_identified_actor_and_no_discrepancy():
    b, _ = cb()
    b.halt("t", "x", flatten=True)
    with pytest.raises(PermissionError):
        b.authorize_resume("t", "")
    with pytest.raises(PermissionError):
        b.authorize_resume("t", "alice", unexplained_discrepancy=True)
    b.authorize_resume("t", "alice")
    assert not b.state.halted


def test_halt_persisted_before_action():
    seen = []
    b, _ = cb(persist=lambda s: seen.append(s.halted))
    b.halt("t", "kill", flatten=True, kill_switch=True)
    assert seen and seen[0] is True


def test_persistence_failure_keeps_halted():
    def broken(_):
        raise OSError("disk full")

    b, _ = cb(persist=broken)
    b.halt("t", "x", flatten=False)
    assert b.state.halted and b.persist_failures >= 1


def test_transient_blocks_clear_automatically():
    b, _ = cb()
    b.check_data_freshness("t", 1000)
    assert b.state.entries_blocked and not b.state.halted
    b.check_data_freshness("t", 5)
    assert not b.state.entries_blocked


@pytest.mark.parametrize("method,args", [
    ("check_clock_skew", ("t", 10_000)),
    ("check_position_discrepancy", ("t", "BTC/USDT", 1.0, 0.0, 1.0)),
    ("check_balance", ("t", -5.0)),
    ("check_slippage", ("t", 500.0)),
    ("database_failure", ("t", "locked")),
])
def test_operational_triggers_halt(method, args):
    b, _ = cb()
    getattr(b, method)(*args)
    assert b.state.halted and b.state.requires_authorization


def test_repeated_exchange_errors_halt():
    b, _ = cb()
    for _ in range(4):
        b.record_exchange_error("t", "timeout")
    assert not b.state.halted
    b.record_exchange_error("t", "timeout")
    assert b.state.halted
