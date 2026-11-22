import numpy as np
import pandas as pd
import pytest

from quant_engine.data.normalization import normalize_symbol, ohlcv_to_frame, resample_ohlcv
from quant_engine.data.orderbook import book_metrics, impact_bps
from quant_engine.data.validation import clean_and_validate


def frame(n=10, start="2024-01-01"):
    idx = pd.date_range(start, periods=n, freq="1h", tz="UTC", name="open_time")
    c = np.linspace(100, 110, n)
    return pd.DataFrame({"open": c, "high": c + 1, "low": c - 1, "close": c, "volume": 10.0}, index=idx)


@pytest.mark.parametrize("raw,expected", [("BTCUSDT", "BTC/USDT"), ("BTC-USDT", "BTC/USDT"), ("BTC-USDT-SWAP", "BTC/USDT"),
                                          ("BTC/USDT:USDT", "BTC/USDT"), ("sol_usdt", "SOL/USDT"), ("ETH/USDT", "ETH/USDT")])
def test_symbol_normalization(raw, expected):
    assert normalize_symbol(raw) == expected


def test_duplicates_and_unsorted_are_repaired_and_counted():
    df = frame()
    messy = pd.concat([df.iloc[5:], df.iloc[:5], df.iloc[[3]]])
    clean, rep = clean_and_validate(messy, "BTC/USDT", "1h", now=pd.Timestamp("2030-01-01", tz="UTC"))
    assert rep.duplicates == 1 and clean.index.is_monotonic_increasing and len(clean) == 10


def test_gaps_are_reported_never_interpolated():
    df = frame().drop(frame().index[[4, 5]])
    clean, rep = clean_and_validate(df, "BTC/USDT", "1h", now=pd.Timestamp("2030-01-01", tz="UTC"))
    assert rep.missing_bars == 2 and len(clean) == 8 and len(rep.gaps) == 1
    assert not rep.passed  # 80% completeness fails the integrity gate


def test_invalid_ohlc_rows_flagged_and_removed():
    df = frame()
    df.iloc[2, df.columns.get_loc("high")] = 50.0   # high < close
    df.iloc[3, df.columns.get_loc("close")] = -1.0
    clean, rep = clean_and_validate(df, "BTC/USDT", "1h", now=pd.Timestamp("2030-01-01", tz="UTC"))
    assert rep.invalid_ohlc >= 1 and rep.nonpositive_prices == 1 and len(clean) == 8


def test_unfinished_last_candle_dropped():
    df = frame()
    now = df.index[-1] + pd.Timedelta(minutes=30)
    clean, rep = clean_and_validate(df, "BTC/USDT", "1h", now=now)
    assert rep.unfinished_last_bar_dropped and len(clean) == 9


def test_resample_drops_incomplete_higher_tf_bars():
    df = frame(10)  # 10 hourly bars from 00:00 -> 4h bars 00-04, 04-08 complete; 08-12 incomplete
    out = resample_ohlcv(df, "1h", "4h")
    assert len(out) == 2
    assert out.iloc[0]["high"] == pytest.approx(df.iloc[:4]["high"].max())
    assert out.iloc[0]["volume"] == pytest.approx(40.0)


def test_ohlcv_to_frame_utc():
    f = ohlcv_to_frame([[1704067200000, 1, 2, 0.5, 1.5, 10]])
    assert str(f.index.tz) == "UTC" and f.index[0] == pd.Timestamp("2024-01-01", tz="UTC")


def test_orderbook_metrics():
    bids = [(99.9, 10.0), (99.8, 10.0)]
    asks = [(100.1, 5.0), (100.2, 5.0)]
    m = book_metrics(bids, asks, band_bps=50, reference_notional=600)
    assert m.mid == pytest.approx(100.0) and m.spread_bps == pytest.approx(20.0)
    assert m.imbalance > 0  # more bid depth
    assert impact_bps(asks, 1e9, 100.0) is None  # book too thin -> None, never extrapolated
    with pytest.raises(ValueError):
        book_metrics([(101.0, 1.0)], [(100.0, 1.0)])  # crossed
