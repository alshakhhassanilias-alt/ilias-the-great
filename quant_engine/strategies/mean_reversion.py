"""Strategy B - Statistical Mean Reversion.

Long when price is stretched below its rolling mean (z-score < -z_entry, below the lower
Bollinger band) with RSI oversold, **and** the stretch has started to revert (z rising
versus the prior bar).  Shorts mirror.

Safeguards against fading strong trends (the classic failure mode):
* ADX must be below ``adx_max`` (no established trend),
* the slope of a long EMA must be flat (``|slope| < max_trend_slope`` per bar),
* the volatility percentile must be below 0.9 (no crisis-volatility fading),
* optional RSI divergence confirmation.

Exits: z-score crosses back through 0 (the mean), ATR stop, take-profit at the rolling
mean measured at entry, time stop.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from quant_engine.regime import indicators as ind
from quant_engine.strategies.base import MarketData, Strategy, empty_signal_frame


class StatisticalMeanReversion(Strategy):
    strategy_id = "mean_reversion"
    description = "Bollinger/z-score/RSI reversion gated to non-trending, non-crisis conditions"

    def compute(self, data: MarketData, params: dict[str, Any] | None = None) -> dict[str, pd.DataFrame]:
        p = {**self.params, **(params or {})}
        out: dict[str, pd.DataFrame] = {}
        n = int(p["bb_period"])
        for sym in self.symbols:
            df = data.get(sym, self.timeframe)
            c = df["close"]
            z = ind.zscore(c, n)
            bb = ind.bollinger(c, n, float(p["z_entry"]))
            r = ind.rsi(c, int(p["rsi_period"]))
            a = ind.atr(df, int(p["atr_period"]))
            adx = ind.adx(df, 14)["adx"]
            slope = ind.ema_slope(c, int(p["trend_ema"]), 24).abs()
            vol_pct = ind.rolling_percentile(a / c, 500, min_periods=100)

            calm = (adx < float(p["adx_max"])) & (slope < float(p["max_trend_slope"])) & (vol_pct < 0.9)
            turning_up = z > z.shift(1)
            turning_dn = z < z.shift(1)
            long_e = (z < -float(p["z_entry"])) & (c < bb["lower"]) & (r < float(p["rsi_low"])) & turning_up & calm
            short_e = (z > float(p["z_entry"])) & (c > bb["upper"]) & (r > float(p["rsi_high"])) & turning_dn & calm
            if bool(p.get("use_divergence", False)):
                div = ind.rsi_divergence(c, r, 14)
                recent_bull = div.eq(1).rolling(3, min_periods=1).max().astype(bool)
                recent_bear = div.eq(-1).rolling(3, min_periods=1).max().astype(bool)
                long_e &= recent_bull
                short_e &= recent_bear

            sf = empty_signal_frame(df.index, c)
            sf["entry"] = np.where(long_e, 1, np.where(short_e, -1, 0))
            sf["exit_long"] = (z >= 0).to_numpy()
            sf["exit_short"] = (z <= 0).to_numpy()
            sf["stop_dist"] = float(p["stop_atr"]) * a
            # take-profit at the rolling mean (distance from close to mid); at least 0.5 ATR
            sf["tp_dist"] = np.maximum((c - bb["mid"]).abs(), 0.5 * a)
            stretch = (z.abs() - float(p["z_entry"])).clip(lower=0)
            rsi_ext = np.where(sf["entry"] > 0, (float(p["rsi_low"]) - r) / 30.0, (r - float(p["rsi_high"])) / 30.0)
            conf = 0.5 * np.clip(stretch.to_numpy(), 0, 1) + 0.5 * np.clip(np.nan_to_num(rsi_ext), 0, 1)
            sf["confidence"] = np.where(sf["entry"] != 0, np.clip(conf + 0.1, 0.05, 1.0), 0.0)
            sf["hold_bars"] = int(p["max_hold_bars"])
            sf.loc[z.isna() | a.isna() | adx.isna() | slope.isna() | vol_pct.isna(), "entry"] = 0
            out[sym] = sf
        return out
