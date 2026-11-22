"""Strategy C - Multi-Timeframe Momentum and Flow.

Entry on the 15m close when:
* 15m momentum (ROC over ``roc_period`` bars) exceeds ``roc_threshold`` in the trade direction,
* relative volume >= ``rel_volume`` (participation / flow confirmation),
* the latest *closed* 1h bar is above (below) its EMA with a rising (falling) EMA,
* the latest *closed* 4h bar is above (below) its EMA.

Optional flow inputs, never fabricated:
* **Funding**: crowded-positioning filter.  Longs are skipped when the last *known* funding
  rate exceeds the training-data ``funding_extreme_q`` quantile; shorts when it is below the
  ``1 - q`` quantile.  If funding data or the training calibration is missing, the filter
  is disabled (fallback) and ``funding_available`` is recorded as False.
* **Order-book imbalance**: only applied to the live decision bar, only when a fresh observed
  snapshot is supplied.  Historical order books are not available, so backtests run without
  it (documented; this is a live/backtest difference).
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from quant_engine.regime import indicators as ind
from quant_engine.strategies.base import MarketData, Strategy, empty_signal_frame


def align_backward(src: pd.DataFrame | pd.Series, target: pd.DatetimeIndex) -> Any:
    """Value of ``src`` known at each ``target`` time (last row with index <= target)."""
    if len(src) == 0:
        return src.reindex(target)
    return src.reindex(src.index.union(target)).ffill().reindex(target)


class MomentumFlow(Strategy):
    strategy_id = "momentum_flow"
    description = "15m momentum aligned with 1h/4h trend, volume-confirmed, funding/order-book aware"

    def required_timeframes(self) -> list[str]:
        return ["15m", "1h", "4h"]

    def fit(self, train: MarketData) -> dict[str, Any]:
        q = float(self.params.get("funding_extreme_q", 0.9))
        thr: dict[str, tuple[float, float]] = {}
        for sym in self.symbols:
            f = train.funding.get(sym)
            if f is not None and not f.empty and len(f) >= 90:
                thr[sym] = (float(f["funding_rate"].quantile(q)), float(f["funding_rate"].quantile(1 - q)))
        self.fitted = {"funding_thresholds": thr}
        return self.fitted

    def compute(self, data: MarketData, params: dict[str, Any] | None = None) -> dict[str, pd.DataFrame]:
        p = {**self.params, **(params or {})}
        out: dict[str, pd.DataFrame] = {}
        thresholds = self.fitted.get("funding_thresholds", {})
        for sym in self.symbols:
            df = data.get(sym, "15m")
            c = df["close"]
            idx = df.index
            mom = ind.roc(c, int(p["roc_period"]))
            rv = ind.relative_volume(df["volume"], int(p["rel_volume_window"]))
            a = ind.atr(df, int(p["atr_period"]))

            h1 = data.get(sym, "1h")
            h1_ema = ind.ema(h1["close"], int(p["h1_ema"]))
            h1_up = align_backward((h1["close"] > h1_ema) & (h1_ema.diff(3) > 0), idx).fillna(False).astype(bool)
            h1_dn = align_backward((h1["close"] < h1_ema) & (h1_ema.diff(3) < 0), idx).fillna(False).astype(bool)
            h4 = data.get(sym, "4h")
            h4_ema = ind.ema(h4["close"], int(p["h4_ema"]))
            h4_up = align_backward(h4["close"] > h4_ema, idx).fillna(False).astype(bool)
            h4_dn = align_backward(h4["close"] < h4_ema, idx).fillna(False).astype(bool)
            h_valid = align_backward(h4_ema.notna(), idx).fillna(False).astype(bool) & \
                align_backward(h1_ema.notna(), idx).fillna(False).astype(bool)

            thr = float(p["roc_threshold"])
            vol_ok = rv >= float(p["rel_volume"])
            # Cost awareness: the take-profit distance must cover the assumed round-trip taker
            # cost (2 x 0.10%) by ``min_tp_cost_multiple``; otherwise expected edge < costs.
            rt_cost = 2 * float(p.get("assumed_taker_fee", 0.001))
            cost_ok = (float(p["tp_atr"]) * a / c) >= float(p.get("min_tp_cost_multiple", 6.0)) * rt_cost
            vol_ok = vol_ok & cost_ok
            long_e = (mom > thr) & vol_ok & h1_up & h4_up & h_valid
            short_e = (mom < -thr) & vol_ok & h1_dn & h4_dn & h_valid

            funding = data.funding.get(sym)
            funding_available = funding is not None and not funding.empty and sym in thresholds
            if funding_available:
                assert funding is not None
                fr = align_backward(funding["funding_rate"], idx)
                hi, lo = thresholds[sym]
                long_e &= ~(fr > hi).fillna(False)
                short_e &= ~(fr < lo).fillna(False)

            sf = empty_signal_frame(idx, c)
            sf["entry"] = np.where(long_e, 1, np.where(short_e, -1, 0))
            # Exit when momentum reverses through zero against the position.
            sf["exit_long"] = (mom < 0).to_numpy() & h1_dn.to_numpy()
            sf["exit_short"] = (mom > 0).to_numpy() & h1_up.to_numpy()
            sf["stop_dist"] = float(p["stop_atr"]) * a
            sf["tp_dist"] = float(p["tp_atr"]) * a
            conf = 0.5 * np.clip(np.abs(np.nan_to_num(mom.to_numpy())) / (3 * thr), 0, 1) + \
                0.5 * np.clip(np.nan_to_num(rv.to_numpy()) / (2 * float(p["rel_volume"])), 0, 1)
            sf["confidence"] = np.where(sf["entry"] != 0, np.clip(conf, 0.05, 1.0), 0.0)
            sf["hold_bars"] = int(p["max_hold_bars"])
            sf.loc[a.isna() | mom.isna() | rv.isna(), "entry"] = 0
            sf["funding_available"] = funding_available

            # Live-only order-book confirmation on the decision bar.
            ob = data.orderbook.get(sym)
            sf["orderbook_used"] = False
            if ob and ob.get("fresh") and len(sf):
                imb = float(ob.get("imbalance", 0.0))
                last = sf.index[-1]
                e = int(sf.at[last, "entry"])
                min_imb = float(p["ob_imbalance_min"])
                if e != 0 and (np.sign(imb) != e and abs(imb) >= min_imb):
                    sf.at[last, "entry"] = 0  # book leans against the trade
                sf.at[last, "orderbook_used"] = True
            out[sym] = sf
        return out
