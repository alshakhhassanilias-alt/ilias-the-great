"""Strategy interface.

Strategies are *pure signal generators*: they read closed bars and return proposals.
They have no access to brokers, order managers or account state and therefore cannot
submit orders; every proposal is routed through :class:`quant_engine.risk.manager.RiskManager`.

Contract
--------
``compute(data, params)`` returns, per symbol, a frame indexed by **bar-close time** on the
strategy timeframe with columns:

=================  ==========================================================
``entry``          +1 long / -1 short / 0 none, decided at that bar's close
``exit_long``      bool, strategy wants any long closed
``exit_short``     bool, strategy wants any short closed
``stop_dist``      protective stop distance in price units (> 0 when entry != 0)
``tp_dist``        take-profit distance in price units (NaN = none)
``trail_dist``     trailing-stop distance in price units (NaN = none)
``confidence``     0..1
``hold_bars``      expected holding period (strategy bars)
``close``          reference price (bar close)
=================  ==========================================================

Every value at row ``t`` must depend only on data with close time ``<= t``.  The test
``tests/unit/test_strategy_causality.py`` recomputes on truncated histories to enforce this.
"""

from __future__ import annotations

import itertools
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, ClassVar

import numpy as np
import pandas as pd

from quant_engine.config.settings import StrategyConfig
from quant_engine.core.types import Direction, Signal

SIGNAL_COLUMNS = ["entry", "exit_long", "exit_short", "stop_dist", "tp_dist", "trail_dist",
                  "confidence", "hold_bars", "close"]


@dataclass
class MarketData:
    """Closed bars, close-time indexed: ``bars[symbol][timeframe]``.

    ``funding[symbol]`` holds funding rates indexed by funding time (may be empty).
    ``orderbook[symbol]`` holds the latest *observed* order-book features (live only).
    """

    bars: dict[str, dict[str, pd.DataFrame]]
    funding: dict[str, pd.DataFrame] = field(default_factory=dict)
    orderbook: dict[str, dict[str, float]] = field(default_factory=dict)

    def get(self, symbol: str, tf: str) -> pd.DataFrame:
        return self.bars[symbol][tf]

    def slice(self, start: pd.Timestamp | None, end: pd.Timestamp | None) -> MarketData:
        """Restrict to bars with close time in [start, end]."""
        bars = {s: {tf: df.loc[start:end] for tf, df in d.items()} for s, d in self.bars.items()}
        fund = {s: (df.loc[start:end] if not df.empty else df) for s, df in self.funding.items()}
        return MarketData(bars, fund, dict(self.orderbook))


def empty_signal_frame(index: pd.DatetimeIndex, close: pd.Series) -> pd.DataFrame:
    df = pd.DataFrame(index=index)
    df["entry"] = 0
    df["exit_long"] = False
    df["exit_short"] = False
    df["stop_dist"] = np.nan
    df["tp_dist"] = np.nan
    df["trail_dist"] = np.nan
    df["confidence"] = 0.0
    df["hold_bars"] = 0
    df["close"] = close
    return df


class Strategy(ABC):
    strategy_id: ClassVar[str]
    description: ClassVar[str] = ""

    def __init__(self, cfg: StrategyConfig, params: dict[str, Any] | None = None) -> None:
        self.cfg = cfg
        self.timeframe = cfg.timeframe
        self.symbols = list(cfg.symbols)
        self.params: dict[str, Any] = {**cfg.default_params, **(params or {})}
        self.fitted: dict[str, Any] = {}

    # ---------------------------------------------------------------- research hooks
    def param_grid(self) -> list[dict[str, Any]]:
        grid = self.cfg.param_grid
        if not grid:
            return [dict(self.params)]
        keys = sorted(grid)
        return [{**self.params, **dict(zip(keys, vals, strict=True))}
                for vals in itertools.product(*(grid[k] for k in keys))]

    def with_params(self, params: dict[str, Any]) -> Strategy:
        clone = type(self)(self.cfg, params)
        clone.fitted = dict(self.fitted)
        return clone

    def fit(self, train: MarketData) -> dict[str, Any]:
        """Estimate training-only quantities (hedge ratios, thresholds).  Default: none."""
        self.fitted = {}
        return self.fitted

    @property
    def warmup_bars(self) -> int:
        nums = [int(v) for v in self.params.values() if isinstance(v, int | float) and not isinstance(v, bool)
                and float(v).is_integer() and 1 < v < 2000]
        return max([*nums, 50]) * 3

    def required_timeframes(self) -> list[str]:
        return [self.timeframe]

    @abstractmethod
    def compute(self, data: MarketData, params: dict[str, Any] | None = None) -> dict[str, pd.DataFrame]:
        """Vectorised, causal signal frames per symbol."""

    # ---------------------------------------------------------------- live adapter
    def signals_at(self, frames: dict[str, pd.DataFrame], ts: pd.Timestamp,
                   risk_fraction: float) -> list[Signal]:
        """Convert the rows at ``ts`` into :class:`Signal` proposals."""
        out: list[Signal] = []
        for sym, df in frames.items():
            if ts not in df.index:
                continue
            row = df.loc[ts]
            price = float(row["close"])
            if bool(row["exit_long"]) or bool(row["exit_short"]):
                d = Direction.LONG if bool(row["exit_long"]) else Direction.SHORT
                out.append(Signal(self.strategy_id, sym, ts, d, price, None, None, 1.0, 0, 0.0,
                                  self.timeframe, is_exit=True,
                                  metadata={"exit_long": bool(row["exit_long"]),
                                            "exit_short": bool(row["exit_short"])}))
            e = int(row["entry"])
            if e == 0 or not np.isfinite(row["stop_dist"]) or row["stop_dist"] <= 0:
                continue
            d = Direction(e)
            stop = price - e * float(row["stop_dist"])
            tp = price + e * float(row["tp_dist"]) if np.isfinite(row["tp_dist"]) else None
            trail = float(row["trail_dist"]) if np.isfinite(row["trail_dist"]) else None
            out.append(Signal(self.strategy_id, sym, ts, d, price, stop, tp, float(row["confidence"]),
                              int(row["hold_bars"]), risk_fraction, self.timeframe,
                              trailing_stop_distance=trail))
        return out
