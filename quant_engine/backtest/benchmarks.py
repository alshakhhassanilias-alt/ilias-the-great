"""Passive benchmarks: buy-and-hold BTC/ETH/SOL (one round-trip of modelled costs) and cash (0%)."""

from __future__ import annotations

import pandas as pd

from quant_engine.backtest.metrics import performance_summary
from quant_engine.config.settings import CostModelConfig

EMPTY_TRADES = pd.DataFrame(columns=["pnl", "entry_time", "exit_time"])


def buy_and_hold_equity(
    close: pd.Series, start: pd.Timestamp, end: pd.Timestamp, costs: CostModelConfig, symbol: str, capital: float = 1.0
) -> pd.Series:
    px = close.loc[start:end]
    if px.empty:
        return pd.Series(dtype=float)
    half_spread = 0.5 * costs.spread_bps.get(symbol, costs.default_spread_bps) / 1e4
    entry_cost = costs.taker_fee + half_spread
    eq = capital * (1 - entry_cost) * px / px.iloc[0]
    eq.iloc[-1] *= 1 - entry_cost  # exit
    return eq


def cash_equity(index: pd.DatetimeIndex, capital: float = 1.0) -> pd.Series:
    return pd.Series(capital, index=index)


def benchmark_summaries(
    closes: dict[str, pd.Series], start: pd.Timestamp, end: pd.Timestamp, costs: CostModelConfig
) -> dict[str, dict]:
    out = {}
    idx = None
    for sym, c in closes.items():
        eq = buy_and_hold_equity(c, start, end, costs, sym)
        if eq.empty:
            continue
        idx = eq.index
        out[f"buy_hold_{sym.split('/')[0]}"] = performance_summary(eq, EMPTY_TRADES)
    if idx is not None:
        out["cash"] = performance_summary(cash_equity(idx), EMPTY_TRADES)
    return out
