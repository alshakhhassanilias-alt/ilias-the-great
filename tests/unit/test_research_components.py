import itertools

import numpy as np
import pandas as pd
import pytest

from quant_engine.backtest.metrics import (
    average_drawdown,
    bootstrap_ci,
    cagr,
    deflated_sharpe,
    max_drawdown,
    pbo_cscv,
    probabilistic_sharpe,
    sharpe,
)
from quant_engine.backtest.monte_carlo import MCConfig, run_monte_carlo, summarize
from quant_engine.backtest.walk_forward import build_windows
from quant_engine.config.settings import WalkForwardConfig
from quant_engine.regime.allocation import RegimeAllocator, StrategyAllocationSpec, ValidationStatus
from quant_engine.regime.detector import Regime, RegimeDetector
from tests.conftest import make_ohlcv


def test_windows_are_chronological_embargoed_and_exclude_holdout():
    wf = WalkForwardConfig()
    ws, hold = build_windows(pd.Timestamp("2021-01-01", tz="UTC"), pd.Timestamp("2026-11-22", tz="UTC"), wf)
    assert len(ws) >= 8
    for w in ws:
        assert w.train_end + pd.Timedelta(days=7) == w.val_start
        assert w.val_end + pd.Timedelta(days=7) == w.test_start
        assert w.test_end <= hold
    for a, b in itertools.pairwise(ws):
        assert b.test_start >= a.test_start + pd.DateOffset(months=3) - pd.Timedelta(days=1)
        assert b.train_start > a.train_start
    assert hold == pd.Timestamp("2026-05-22", tz="UTC")


def test_insufficient_history_yields_no_windows():
    ws, _ = build_windows(pd.Timestamp("2025-01-01", tz="UTC"), pd.Timestamp("2026-01-01", tz="UTC"), WalkForwardConfig())
    assert ws == []


def test_drawdown_and_cagr():
    idx = pd.date_range("2024-01-01", periods=5, freq="D", tz="UTC")
    eq = pd.Series([100, 120, 90, 110, 80.0], index=idx)
    assert max_drawdown(eq) == pytest.approx(1 - 80 / 120)
    assert average_drawdown(eq) == pytest.approx(1 - 80 / 120)  # one episode
    eq2 = pd.Series([100.0, 110.0], index=[idx[0], idx[0] + pd.Timedelta(days=365)])
    assert cagr(eq2) == pytest.approx(0.10)


def test_sharpe_and_psr_behave():
    rng = np.random.default_rng(0)
    good = rng.normal(0.002, 0.01, 1000)
    noise = rng.normal(0.0, 0.01, 1000)
    assert sharpe(good) > 2 and abs(sharpe(noise)) < 1.5
    assert probabilistic_sharpe(good) > 0.99 > probabilistic_sharpe(noise)


def test_deflated_sharpe_penalises_many_trials():
    rng = np.random.default_rng(1)
    r = rng.normal(0.0008, 0.01, 500)
    trials = rng.normal(0, 0.03, 50)
    few = deflated_sharpe(r, trials, n_trials=2)["dsr"]
    many = deflated_sharpe(r, trials, n_trials=500)["dsr"]
    assert many < few


def test_pbo_near_half_for_pure_noise_and_low_for_real_edge():
    rng = np.random.default_rng(3)
    noise = pd.DataFrame(rng.normal(0, 0.01, (800, 10)))
    assert 0.2 < pbo_cscv(noise, 8)["pbo"] < 0.8
    edge = noise.copy()
    edge[0] += 0.004  # one configuration with a real, persistent edge
    assert pbo_cscv(edge, 8)["pbo"] < 0.1


def test_bootstrap_ci_contains_point_estimate():
    r = np.random.default_rng(2).normal(0.001, 0.01, 400)
    pt, lo, hi = bootstrap_ci(r, lambda x: float(np.mean(x)), 300, 5, seed=0)
    assert lo < pt < hi


def test_monte_carlo_reproducible_and_complete():
    rng = np.random.default_rng(5)
    idx = pd.date_range("2024-01-01", periods=400, freq="D", tz="UTC")
    daily = pd.Series(rng.normal(0.0005, 0.01, 400), index=idx)
    trades = pd.DataFrame({"ret": rng.normal(0.001, 0.01, 200), "cost_ret": 0.0002, "fee_ret": 0.0004})
    a = run_monte_carlo(daily, trades, MCConfig(n_sims=1000, seed=9))
    b = run_monte_carlo(daily, trades, MCConfig(n_sims=1000, seed=9))
    sa, sb = summarize(a), summarize(b)
    assert sa == sb
    expected = {"block_bootstrap", "volatility_shock", "trade_bootstrap", "trade_shuffle", "consecutive_losses",
                "slippage_x3", "fees_x2", "liquidity_crunch", "gap_risk"}
    assert set(sa) == expected
    for v in sa.values():
        assert v["terminal_equity_p05"] <= v["terminal_equity_median"] <= v["terminal_equity_p95"]
        assert 0 <= v["prob_ruin"] <= 1
    assert sa["fees_x2"]["terminal_equity_median"] < sa["trade_bootstrap"]["terminal_equity_median"]


def test_regime_requires_training_fit_and_detects_crisis():
    d = make_ohlcv(3000, "4h", seed=2, vol=0.01)
    det = RegimeDetector()
    with pytest.raises(RuntimeError):
        det.classify(d)
    det.fit(d.iloc[:1500])
    crash = d.copy()
    rng = np.random.default_rng(0)
    shock = np.exp(np.cumsum(rng.normal(-0.01, 0.06, 200)))
    seg = crash.iloc[2600:2800]
    crash.iloc[2600:2800, :4] = (seg[["open", "high", "low", "close"]].to_numpy() * shock[:, None])
    crash["high"] = crash[["open", "high", "low", "close"]].max(axis=1)
    crash["low"] = crash[["open", "high", "low", "close"]].min(axis=1)
    out = det.classify(crash)
    assert (out["regime"].iloc[2650:2800] == Regime.HIGH_VOL_CRISIS.value).mean() > 0.5


def test_regime_trend_detection_and_hysteresis():
    d = make_ohlcv(2000, "4h", seed=4, vol=0.008)
    det = RegimeDetector()
    det.fit(d.iloc[:1200])
    up = d.copy()
    trend = np.exp(np.linspace(0, 0.8, 400))
    up.iloc[1500:1900, :4] = up.iloc[1500:1900, :4].to_numpy() * trend[:, None]
    up["high"] = up[["open", "high", "low", "close"]].max(axis=1)
    up["low"] = up[["open", "high", "low", "close"]].min(axis=1)
    out = det.classify(up)
    assert (out["regime"].iloc[1600:1900] == Regime.TRENDING_BULL.value).mean() > 0.5
    switches = (out["regime"] != out["regime"].shift()).sum()
    raw_switches = (out["raw_regime"] != out["raw_regime"].shift()).sum()
    assert switches <= raw_switches  # hysteresis never adds oscillation


def test_allocator_caps_validation_and_crisis():
    specs = [StrategyAllocationSpec("a", 0.35, {"trending_bull": 1.0, "high_vol_crisis": 1.0}, ValidationStatus.PROMOTED),
             StrategyAllocationSpec("b", 0.30, {"trending_bull": 1.0, "high_vol_crisis": 1.0}, ValidationStatus.PROMOTED),
             StrategyAllocationSpec("c", 0.30, {"trending_bull": 1.0}, ValidationStatus.RESEARCH_ONLY)]
    al = RegimeAllocator(specs, crisis_exposure_multiplier=0.5)
    bull = al.allocate("trending_bull")
    assert "c" in bull.excluded and bull.total <= 1.0
    assert all(bull.weights[k] <= s.max_weight for k, s in al.specs.items() if k in bull.weights)
    crisis = al.allocate("high_vol_crisis")
    assert crisis.total == pytest.approx(bull.total * 0.5)
    open_al = RegimeAllocator(specs, require_validation=False)
    assert "c" in open_al.allocate("trending_bull").weights
