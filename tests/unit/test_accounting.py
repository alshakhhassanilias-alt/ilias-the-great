import pandas as pd
import pytest

from quant_engine.core.accounting import Ledger
from quant_engine.core.types import Fill, OrderIntent, Side

T = pd.Timestamp("2024-01-01", tz="UTC")


def fill(side, qty, px, fee=0.0, sid="s", sym="BTC/USDT", intent=OrderIntent.ENTRY):
    return Fill(f"f{side}{qty}{px}", "c", sym, side, qty, px, fee, T, "taker", 0.0, sid, intent)


def test_long_round_trip_pnl_and_fees():
    led = Ledger(cash=10_000)
    assert led.apply_fill(fill(Side.BUY, 2, 100, fee=0.2)) is None
    assert led.equity({"BTC/USDT": 110}) == pytest.approx(10_000 - 0.2 + 20)
    tr = led.apply_fill(fill(Side.SELL, 2, 110, fee=0.22, intent=OrderIntent.EXIT), "exit")
    assert tr is not None
    assert tr.gross_pnl == pytest.approx(20)
    assert tr.pnl == pytest.approx(20 - 0.42)
    assert led.cash == pytest.approx(10_000 + 20 - 0.42)
    assert not led.open_positions()


def test_short_pnl_and_partial_close():
    led = Ledger(cash=1_000)
    led.apply_fill(fill(Side.SELL, 4, 50))
    assert led.equity({"BTC/USDT": 45}) == pytest.approx(1_020)
    assert led.apply_fill(fill(Side.BUY, 1, 45)) is None  # partial
    assert led.position("s", "BTC/USDT").quantity == pytest.approx(-3)
    tr = led.apply_fill(fill(Side.BUY, 3, 40))
    assert tr.gross_pnl == pytest.approx(5 + 30)
    assert tr.direction == -1


def test_flip_creates_new_position_at_fill_price():
    led = Ledger(cash=1_000)
    led.apply_fill(fill(Side.BUY, 1, 100))
    tr = led.apply_fill(fill(Side.SELL, 3, 90))
    assert tr.gross_pnl == pytest.approx(-10)
    p = led.position("s", "BTC/USDT")
    assert p.quantity == pytest.approx(-2) and p.avg_entry_price == pytest.approx(90)


def test_average_entry_on_increase():
    led = Ledger(cash=1_000)
    led.apply_fill(fill(Side.BUY, 1, 100))
    led.apply_fill(fill(Side.BUY, 1, 120))
    assert led.position("s", "BTC/USDT").avg_entry_price == pytest.approx(110)


def test_funding_sign_convention():
    led = Ledger(cash=1_000)
    led.apply_fill(fill(Side.BUY, 1, 100, sid="a"))
    led.apply_fill(fill(Side.SELL, 1, 100, sid="b"))
    paid = led.apply_funding("BTC/USDT", 0.001, 100)
    assert paid == pytest.approx(0.0)  # long pays 0.1, short receives 0.1
    assert led.position("a", "BTC/USDT").funding_paid == pytest.approx(0.1)
    assert led.position("b", "BTC/USDT").funding_paid == pytest.approx(-0.1)


def test_separate_strategy_subaccounts():
    led = Ledger(cash=1_000)
    led.apply_fill(fill(Side.BUY, 1, 100, sid="a"))
    led.apply_fill(fill(Side.SELL, 1, 100, sid="b"))
    assert len(led.open_positions()) == 2
    assert led.net_exposure({"BTC/USDT": 100}) == pytest.approx(0)
    assert led.gross_exposure({"BTC/USDT": 100}) == pytest.approx(200)
