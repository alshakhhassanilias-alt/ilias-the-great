"""Regime-aware strategy allocation.

Weights are the product of a strategy's *regime affinity* (config) and its *validation
status*, then capped per strategy (``max_weight``), scaled down in crisis / neutral
regimes, and renormalised so the total never exceeds ``total_weight_cap`` (<= 100%).
Strategies without sufficient validation evidence receive zero weight when
``require_validation`` is set (the default for paper/live operation).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from quant_engine.regime.detector import Regime


class ValidationStatus(StrEnum):
    PROMOTED = "promoted"          # passed every OOS promotion criterion
    UNDER_REVIEW = "under_review"  # partial evidence; not deployable
    RESEARCH_ONLY = "research_only"
    REJECTED = "rejected"
    UNVALIDATED = "unvalidated"


@dataclass
class StrategyAllocationSpec:
    strategy_id: str
    max_weight: float
    regime_affinity: dict[str, float]
    status: ValidationStatus = ValidationStatus.UNVALIDATED


@dataclass
class AllocationResult:
    regime: str
    confidence: float
    weights: dict[str, float]
    exposure_multiplier: float
    excluded: dict[str, str] = field(default_factory=dict)

    @property
    def total(self) -> float:
        return sum(self.weights.values())


class RegimeAllocator:
    def __init__(
        self,
        specs: list[StrategyAllocationSpec],
        crisis_exposure_multiplier: float = 0.5,
        neutral_exposure_multiplier: float = 0.75,
        require_validation: bool = True,
        total_weight_cap: float = 1.0,
    ) -> None:
        if not 0 < total_weight_cap <= 1.0:
            raise ValueError("total_weight_cap must be in (0, 1]")
        self.specs = {s.strategy_id: s for s in specs}
        self.crisis_mult = crisis_exposure_multiplier
        self.neutral_mult = neutral_exposure_multiplier
        self.require_validation = require_validation
        self.total_cap = total_weight_cap

    def set_status(self, strategy_id: str, status: ValidationStatus) -> None:
        self.specs[strategy_id].status = status

    def allocate(self, regime: str, confidence: float = 1.0) -> AllocationResult:
        raw: dict[str, float] = {}
        excluded: dict[str, str] = {}
        for sid, spec in self.specs.items():
            if self.require_validation and spec.status is not ValidationStatus.PROMOTED:
                excluded[sid] = f"validation status {spec.status.value}"
                continue
            aff = float(spec.regime_affinity.get(regime, spec.regime_affinity.get(Regime.NEUTRAL.value, 0.0)))
            if aff <= 0:
                excluded[sid] = f"zero affinity for {regime}"
                continue
            raw[sid] = aff
        weights: dict[str, float] = {}
        if raw:
            tot = sum(raw.values())
            for sid, a in raw.items():
                weights[sid] = min(a / tot * self.total_cap, self.specs[sid].max_weight)
        mult = 1.0
        if regime == Regime.HIGH_VOL_CRISIS.value:
            mult = self.crisis_mult
        elif regime == Regime.NEUTRAL.value:
            mult = self.neutral_mult
        weights = {k: v * mult for k, v in weights.items()}
        s = sum(weights.values())
        if s > self.total_cap:  # numerical guard; caps can only reduce the total
            weights = {k: v * self.total_cap / s for k, v in weights.items()}
        return AllocationResult(regime, confidence, weights, mult, excluded)
