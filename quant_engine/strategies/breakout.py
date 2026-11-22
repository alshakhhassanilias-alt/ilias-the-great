"""Strategy A - Volatility Breakout Trend Follower.

Long when the *closed* bar breaks above the prior Donchian high **and** above an ATR
(Keltner-style) volatility channel, with volume confirmation, a trend filter (price vs a
long EMA whose slope agrees) and volatility expansion (ATR above its trailing mean).
Shorts mirror.  Exits: protective ATR stop, ATR trailing stop, wide ATR take-profit,
Turtle-style opposite half-channel exit, and a time stop.  Only completed candles are used
(the engine never passes a forming bar; the Donchian channel excludes the current bar).
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from quant_engine.regime import indicators as ind
from quant_engine.strategies.base import MarketData, Strategy, empty_signal_frame


class VolatilityBreakout(Strategy):
    strategy_id = "breakout"
    description = "Donchian + ATR-channel breakout with volume, trend and volatility-expansion confirmation"

    def compute(self, data: MarketData, params: dict[str, Any] | None = None) -> dict[str, pd.DataFrame]:
        p = {**self.params, **(params or {})}
        out: dict[str, pd.DataFrame] = {}
        n = int(p["donchian"])
        for sym in self.symbols:
            df = data.get(sym, self.timeframe)
            c = df["close"]
            a = ind.atr(df, int(p["atr_period"]))
            dc = ind.donchian(df, n)
            exit_dc = ind.donchian(df, max(n // 2, 5))
            mid = ind.ema(c, 20)
            kelt_up, kelt_dn = mid + 1.5 * a, mid - 1.5 * a
            trend = ind.ema(c, int(p["trend_ema"]))
            trend_slope = trend.diff(5)
            rel_vol = ind.relative_volume(df["volume"], 30)
            expansion = a / a.rolling(int(p["expansion_lookback"]), min_periods=20).mean().shift(1)

            vol_ok = rel_vol >= float(p["volume_ratio"])
            exp_ok = expansion > 1.0
            long_e = (c > dc["upper"]) & (c > kelt_up) & (c > trend) & (trend_slope > 0) & vol_ok & exp_ok
            short_e = (c < dc["lower"]) & (c < kelt_dn) & (c < trend) & (trend_slope < 0) & vol_ok & exp_ok

            sf = empty_signal_frame(df.index, c)
            sf["entry"] = np.where(long_e, 1, np.where(short_e, -1, 0))
            sf["exit_long"] = (c < exit_dc["lower"]).to_numpy()
            sf["exit_short"] = (c > exit_dc["upper"]).to_numpy()
            sf["stop_dist"] = float(p["stop_atr"]) * a
            sf["tp_dist"] = float(p["tp_atr"]) * a
            sf["trail_dist"] = float(p["trail_atr"]) * a
            brk = np.where(long_e, (c - dc["upper"]) / a, np.where(short_e, (dc["lower"] - c) / a, 0.0))
            conf = (
                0.4 * np.clip(np.nan_to_num(brk), 0, 1)
                + 0.3 * np.clip(np.nan_to_num(rel_vol.to_numpy()) / 3.0, 0, 1)
                + 0.3 * np.clip(np.nan_to_num(expansion.to_numpy()) - 1.0, 0, 1)
            )
            sf["confidence"] = np.where(sf["entry"] != 0, np.clip(conf, 0.05, 1.0), 0.0)
            sf["hold_bars"] = int(p["max_hold_bars"])
            sf.loc[a.isna() | dc["upper"].isna() | trend.isna(), "entry"] = 0
            out[sym] = sf
        return out
