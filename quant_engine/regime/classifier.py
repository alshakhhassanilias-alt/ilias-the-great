"""Optional unsupervised regime classifier (research diagnostic only).

A Gaussian mixture is fitted to the detector's causal features on **training data** and
its components are mapped to named regimes by their mean feature profile.  It is used to
cross-check the rule-based detector; it is not wired into trading decisions because it
has not demonstrated incremental value (see docs/ARCHITECTURE.md).
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.mixture import GaussianMixture
from sklearn.preprocessing import StandardScaler

from quant_engine.regime.detector import Regime, RegimeDetector

FEATURES = ["adx", "rv", "slope", "hurst", "ema_gap"]


class GMMRegimeClassifier:
    def __init__(self, detector: RegimeDetector, n_components: int = 4, seed: int = 0) -> None:
        self.detector = detector
        self.gmm = GaussianMixture(n_components=n_components, random_state=seed, covariance_type="full")
        self.scaler = StandardScaler()
        self.mapping: dict[int, str] = {}

    def fit(self, train_df: pd.DataFrame) -> GMMRegimeClassifier:
        f = self.detector.features(train_df)[FEATURES].dropna()
        x = self.scaler.fit_transform(f.to_numpy())
        self.gmm.fit(x)
        means = pd.DataFrame(self.scaler.inverse_transform(self.gmm.means_), columns=FEATURES)
        crisis = int(means["rv"].idxmax())
        rest = means.drop(index=crisis)
        bull = int(rest["slope"].idxmax())
        bear = int(rest["slope"].idxmin())
        self.mapping = {crisis: Regime.HIGH_VOL_CRISIS.value, bull: Regime.TRENDING_BULL.value, bear: Regime.TRENDING_BEAR.value}
        for k in range(len(means)):
            self.mapping.setdefault(k, Regime.LOW_VOL_RANGING.value)
        return self

    def predict(self, df: pd.DataFrame) -> pd.Series:
        f = self.detector.features(df)[FEATURES]
        out = pd.Series(Regime.NEUTRAL.value, index=f.index, dtype=object)
        ok = f.notna().all(axis=1)
        if ok.any():
            lab = self.gmm.predict(self.scaler.transform(f[ok].to_numpy()))
            out[ok] = [self.mapping[int(k)] for k in lab]
        return out

    def agreement(self, df: pd.DataFrame, rule_regimes: pd.Series) -> float:
        pred = self.predict(df)
        common = pred.index.intersection(rule_regimes.index)
        mask = rule_regimes.loc[common] != Regime.NEUTRAL.value
        if mask.sum() == 0:
            return float("nan")
        return float(np.mean(pred.loc[common][mask] == rule_regimes.loc[common][mask]))
