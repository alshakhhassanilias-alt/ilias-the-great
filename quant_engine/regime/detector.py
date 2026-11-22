"""Market regime detection.

Regimes: TRENDING_BULL, TRENDING_BEAR, LOW_VOL_RANGING, HIGH_VOL_CRISIS, plus NEUTRAL
when evidence is insufficient.

* Thresholds are calibrated with :meth:`RegimeDetector.fit` on **training data only** and
  then frozen; :meth:`classify` never looks at data beyond the decision bar.
* Each regime receives a score in [0, 1]; the confidence is the winning score. Below
  ``min_confidence`` the state is NEUTRAL.
* Hysteresis: a new non-crisis regime must win for ``min_persistence_bars`` consecutive
  bars before the state switches.  Crisis is entered immediately (safety first) but must
  also persist to be exited.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import StrEnum
from typing import Any

import numpy as np
import pandas as pd

from quant_engine.regime import indicators as ind


class Regime(StrEnum):
    TRENDING_BULL = "trending_bull"
    TRENDING_BEAR = "trending_bear"
    LOW_VOL_RANGING = "low_vol_ranging"
    HIGH_VOL_CRISIS = "high_vol_crisis"
    NEUTRAL = "neutral"


SCORED = [Regime.TRENDING_BULL, Regime.TRENDING_BEAR, Regime.LOW_VOL_RANGING, Regime.HIGH_VOL_CRISIS]


@dataclass(frozen=True)
class RegimeThresholds:
    crisis_vol: float
    low_vol: float
    trend_adx: float
    slope: float
    calibrated_on: tuple[str, str]
    n_obs: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class RegimeParams:
    adx_period: int = 14
    atr_period: int = 14
    ema_fast: int = 20
    ema_slow: int = 50
    slope_window: int = 6
    vol_window: int = 42
    hurst_window: int = 120
    hurst_max_lag: int = 20
    atr_pct_window: int = 500
    crisis_vol_q: float = 0.90
    low_vol_q: float = 0.40
    trend_adx_q: float = 0.60
    min_confidence: float = 0.55
    min_persistence_bars: int = 3

    @classmethod
    def from_config(cls, cfg: dict[str, Any]) -> RegimeParams:
        q = cfg.get("calibration_quantiles", {})
        known = {k: v for k, v in cfg.items() if k in cls.__dataclass_fields__}
        return cls(
            **known,
            crisis_vol_q=q.get("crisis_vol", 0.90),
            low_vol_q=q.get("low_vol", 0.40),
            trend_adx_q=q.get("trend_adx", 0.60),
        )


def _clip01(x: Any) -> Any:
    return np.clip(x, 0.0, 1.0)


class RegimeDetector:
    def __init__(self, params: RegimeParams | None = None) -> None:
        self.params = params or RegimeParams()
        self.thresholds: RegimeThresholds | None = None

    # ------------------------------------------------------------------ features
    def features(self, df: pd.DataFrame) -> pd.DataFrame:
        p = self.params
        c = df["close"]
        a = ind.adx(df, p.adx_period)
        atr_s = ind.atr(df, p.atr_period)
        f = pd.DataFrame(index=df.index)
        f["adx"] = a["adx"]
        f["atr_pct"] = atr_s / c
        f["atr_percentile"] = ind.rolling_percentile(f["atr_pct"], p.atr_pct_window, min_periods=100)
        f["rv"] = ind.realized_vol(c, p.vol_window)
        f["slope"] = ind.ema_slope(c, p.ema_fast, p.slope_window)
        ef, es = ind.ema(c, p.ema_fast), ind.ema(c, p.ema_slow)
        f["ema_gap"] = ef / es - 1
        f["above_slow"] = np.sign(c - es)
        f["hurst"] = ind.hurst_exponent(c, p.hurst_window, p.hurst_max_lag)
        f["rel_volume"] = ind.relative_volume(df["volume"], p.vol_window)
        roll_max = c.rolling(p.vol_window, min_periods=p.vol_window).max()
        f["drawdown"] = c / roll_max - 1
        return f

    # ------------------------------------------------------------------ calibration
    def fit(self, train_df: pd.DataFrame) -> RegimeThresholds:
        f = self.features(train_df).dropna()
        if len(f) < 200:
            raise ValueError(f"insufficient training data for regime calibration ({len(f)} rows)")
        p = self.params
        self.thresholds = RegimeThresholds(
            crisis_vol=float(f["rv"].quantile(p.crisis_vol_q)),
            low_vol=float(f["rv"].quantile(p.low_vol_q)),
            trend_adx=float(f["adx"].quantile(p.trend_adx_q)),
            slope=float(f["slope"].abs().quantile(0.6)),
            calibrated_on=(str(train_df.index[0]), str(train_df.index[-1])),
            n_obs=len(f),
        )
        return self.thresholds

    # ------------------------------------------------------------------ scoring
    def scores(self, f: pd.DataFrame) -> pd.DataFrame:
        if self.thresholds is None:
            raise RuntimeError("RegimeDetector.fit() must be called on training data first")
        t = self.thresholds
        vol_comp = _clip01((f["rv"] / t.crisis_vol - 0.85) / 0.30)
        volu_comp = _clip01((f["rel_volume"] - 1.0) / 2.0)
        dd_comp = _clip01(-f["drawdown"] / 0.15)
        s_crisis = vol_comp * (0.7 + 0.15 * volu_comp + 0.15 * dd_comp)

        trend_adx = _clip01((f["adx"] - 0.75 * t.trend_adx) / (0.5 * t.trend_adx))
        trend_h = _clip01((f["hurst"] - 0.45) / 0.10)
        trend_s = _clip01(f["slope"].abs() / max(t.slope, 1e-9))
        strength = (trend_adx + trend_h + trend_s) / 3.0
        direction = (np.sign(f["slope"]) + np.sign(f["ema_gap"]) + f["above_slow"]) / 3.0
        s_bull = strength * _clip01(direction)
        s_bear = strength * _clip01(-direction)

        calm = _clip01((1.5 * t.low_vol - f["rv"]) / max(t.low_vol, 1e-12))
        s_range = (1.0 - strength) * calm * (1.0 - vol_comp)
        out = pd.DataFrame(
            {
                Regime.TRENDING_BULL.value: s_bull,
                Regime.TRENDING_BEAR.value: s_bear,
                Regime.LOW_VOL_RANGING.value: s_range,
                Regime.HIGH_VOL_CRISIS.value: s_crisis,
            },
            index=f.index,
        )
        return out

    def classify(self, df: pd.DataFrame) -> pd.DataFrame:
        """Return columns ``regime``, ``confidence``, ``raw_regime`` plus per-regime scores."""
        sc = self.scores(self.features(df))
        p = self.params
        vals = sc.to_numpy()
        names = [r.value for r in SCORED]
        raw: list[str] = []
        conf = np.zeros(len(sc))
        for i, row in enumerate(vals):
            if not np.isfinite(row).all():
                raw.append(Regime.NEUTRAL.value)
                continue
            j = int(np.argmax(row))
            conf[i] = row[j]
            raw.append(names[j] if row[j] >= p.min_confidence else Regime.NEUTRAL.value)

        # Hysteresis state machine (causal).
        state = Regime.NEUTRAL.value
        candidate, run = state, 0
        final: list[str] = []
        for r in raw:
            if r == state:
                candidate, run = r, 0
            else:
                if r == candidate:
                    run += 1
                else:
                    candidate, run = r, 1
                if r == Regime.HIGH_VOL_CRISIS.value or run >= p.min_persistence_bars:
                    state, run = r, 0
            final.append(state)
        res = sc.copy()
        res["raw_regime"] = raw
        res["regime"] = final
        res["confidence"] = conf
        return res


def regime_at(regimes: pd.DataFrame, ts: pd.Timestamp) -> tuple[str, float]:
    """Regime known at ``ts`` (bar-close indexed frame; uses the last row <= ts)."""
    sub = regimes.loc[:ts]
    if sub.empty:
        return Regime.NEUTRAL.value, 0.0
    row = sub.iloc[-1]
    return str(row["regime"]), float(row["confidence"])
