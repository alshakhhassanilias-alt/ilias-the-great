"""Strategy registry: name -> class, built from validated configuration."""

from __future__ import annotations

from typing import Any

from quant_engine.config.settings import AppConfig
from quant_engine.strategies.base import Strategy
from quant_engine.strategies.breakout import VolatilityBreakout
from quant_engine.strategies.mean_reversion import StatisticalMeanReversion
from quant_engine.strategies.momentum_flow import MomentumFlow
from quant_engine.strategies.pairs_rotation import PairsRotation

REGISTRY: dict[str, type[Strategy]] = {
    VolatilityBreakout.strategy_id: VolatilityBreakout,
    StatisticalMeanReversion.strategy_id: StatisticalMeanReversion,
    MomentumFlow.strategy_id: MomentumFlow,
    PairsRotation.strategy_id: PairsRotation,
}


def build_strategy(name: str, cfg: AppConfig, params: dict[str, Any] | None = None) -> Strategy:
    return REGISTRY[name](cfg.strategies.strategies[name], params)


def build_enabled(cfg: AppConfig) -> list[Strategy]:
    return [build_strategy(n, cfg) for n, sc in cfg.strategies.strategies.items() if sc.enabled and n in REGISTRY]
