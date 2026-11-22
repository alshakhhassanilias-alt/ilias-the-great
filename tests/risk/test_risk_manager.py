import numpy as np
import pandas as pd
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from quant_engine.config.settings import PositionSizingConfig, RiskConfig
from quant_engine.core.types import Direction, Signal
from quant_engine.risk.circuit_breaker import RiskState
from quant_engine.risk.limits import PortfolioView
from quant_engine.risk.manager import RiskManager
from quant_engine.risk.position_sizing import kelly_from_r_multiples

T = pd.Timestamp("2024-01-01", tz="UTC")


def sig(direction=Direction.LONG, entry=100.0, stop=95.0, tp=110.0, conf=1.0, sym="BTC/USDT", exit_=False):
    return Signal("s", sym, T, direction, entry, stop, tp, conf, 10, 0.01, "1h", is_exit=exit_)


def view(equity=100_000.0, positions=None, marks=None):
    return PortfolioView(equity, marks or {"BTC/USDT": 100.0, "ETH/USDT": 100.0, "SOL/USDT": 100.0}, positions or [])


def test_approved_size_risks_exactly_one_percent():
    d = RiskManager(RiskConfig()).evaluate(sig(), view())
    assert d.approved
    assert d.quantity == pytest.approx(200.0)
    assert d.risk_amount == pytest.approx(1_000.0)


@pytest.mark.parametrize("stop,reason", [(None, "missing_stop_loss"), (101.0, "stop_on_wrong_side"), (50.0, "stop_too_wide")])
def test_invalid_protection_rejected(stop, reason):
    d = RiskManager(RiskConfig()).evaluate(sig(stop=stop), view())
    assert not d.approved and reason in d.reasons


def test_stop_too_tight_relative_to_atr():
    d = RiskManager(RiskConfig()).evaluate(sig(stop=99.9), view(), atr=2.0)
    assert not d.approved and "stop_too_tight" in d.reasons


def test_halt_and_kill_switch_block_entries_but_not_exits():
    rm = RiskManager(RiskConfig(), RiskState(halted=True, halt_reason="x", kill_switch=True))
    d = rm.evaluate(sig(), view())
    assert not d.approved and "kill_switch_engaged" in d.reasons
    assert rm.evaluate(sig(exit_=True), view()).approved


def test_stale_data_rejected():
    d = RiskManager(RiskConfig()).evaluate(sig(), view(), data_age_seconds=10_000)
    assert not d.approved and "stale_market_data" in d.reasons


def test_concentration_cap_limits_quantity():
    # 1% risk with a 1-unit stop would need 1000 units = 100% equity notional; cap is 60%.
    d = RiskManager(RiskConfig()).evaluate(sig(stop=99.0), view(), atr=1.0)
    assert d.approved
    assert d.quantity * 100 == pytest.approx(60_000.0)
    assert "asset_concentration_cap" in d.adjustments["caps"]


def test_max_open_positions():
    pos = [("s", "ETH/USDT", 1.0)] * 6
    d = RiskManager(RiskConfig()).evaluate(sig(), view(positions=pos))
    assert not d.approved and "max_open_positions" in d.reasons


def test_correlated_same_direction_exposure_reduces_size():
    rm = RiskManager(RiskConfig())
    base = rm.evaluate(sig(), view()).quantity
    corr = rm.evaluate(sig(), view(positions=[("s", "ETH/USDT", 10.0)]), corr_fn=lambda a, b: 0.9).quantity
    hedge = rm.evaluate(sig(), view(positions=[("s", "ETH/USDT", -10.0)]), corr_fn=lambda a, b: 0.9).quantity
    assert corr < base
    assert hedge == pytest.approx(base)


def test_fail_closed_on_internal_error():
    rm = RiskManager(RiskConfig())

    def boom(a, b):
        raise RuntimeError("corr service down")

    d = rm.evaluate(sig(), view(positions=[("s", "ETH/USDT", 1.0)]), corr_fn=boom)
    assert not d.approved and d.reasons[0].startswith("risk_engine_error")


def test_risk_per_trade_schema_rejects_above_1_5_percent():
    with pytest.raises(ValueError):
        PositionSizingConfig(risk_per_trade=0.02)
    with pytest.raises(ValueError):
        PositionSizingConfig(kelly_multiplier=0.5)


def test_kelly_requires_sample_and_stability():
    cfg = PositionSizingConfig()
    assert kelly_from_r_multiples(np.ones(20), cfg).fraction is None
    noisy = np.random.default_rng(0).normal(0.01, 2.0, 200)
    assert kelly_from_r_multiples(noisy, cfg).fraction is None  # unstable
    good = np.random.default_rng(0).normal(0.5, 1.0, 400)
    k = kelly_from_r_multiples(good, cfg)
    assert k.fraction is not None and 0 < k.fraction <= cfg.max_risk_per_trade


@settings(max_examples=200, deadline=None)
@given(
    equity=st.floats(1_000, 1e7),
    entry=st.floats(1, 1e5),
    stop_pct=st.floats(0.002, 0.14),
    conf=st.floats(0, 1),
    short=st.booleans(),
)
def test_property_never_exceeds_risk_ceiling_or_exposure(equity, entry, stop_pct, conf, short):
    cfg = RiskConfig()
    d_ = Direction.SHORT if short else Direction.LONG
    stop = entry * (1 + stop_pct) if short else entry * (1 - stop_pct)
    s = Signal("s", "BTC/USDT", T, d_, entry, stop, None, conf, 5, 0.015, "1h")
    dec = RiskManager(cfg).evaluate(s, PortfolioView(equity, {"BTC/USDT": entry}, []))
    if dec.approved:
        assert dec.risk_amount <= cfg.sizing.max_risk_per_trade * equity * (1 + 1e-9)
        assert dec.quantity * entry <= cfg.exposure.max_asset_concentration * equity * (1 + 1e-9)
