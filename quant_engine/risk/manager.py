"""Independent risk manager: the only path from a strategy signal to an order.

``RiskManager.evaluate`` is wrapped so that *any* internal error produces a rejection
(fail closed).  Exits (risk-reducing) are always permitted, even while halted.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from quant_engine.config.settings import RiskConfig
from quant_engine.core.types import Direction, Signal
from quant_engine.risk.circuit_breaker import CircuitBreaker, RiskEvent, RiskState
from quant_engine.risk.limits import PortfolioView, cap_quantity
from quant_engine.risk.position_sizing import (
    KellyEstimate,
    base_risk_fraction,
    correlation_scale,
    quantity_for_risk,
)
from quant_engine.risk.stops import validate_protection

log = logging.getLogger(__name__)


@dataclass
class RiskDecision:
    approved: bool
    signal: Signal
    quantity: float = 0.0
    stop_loss: float | None = None
    take_profit: float | None = None
    risk_fraction: float = 0.0
    risk_amount: float = 0.0
    sizing_method: str = ""
    reasons: list[str] = field(default_factory=list)
    adjustments: dict[str, Any] = field(default_factory=dict)

    @property
    def decision(self) -> str:
        return "approved" if self.approved else "rejected"


class RiskManager:
    def __init__(
        self,
        cfg: RiskConfig,
        state: RiskState | None = None,
        persist: Callable[[RiskState], None] | None = None,
        on_event: Callable[[RiskEvent], None] | None = None,
    ) -> None:
        self.cfg = cfg
        self.state = state or RiskState()
        self.breaker = CircuitBreaker(cfg.circuit_breakers, self.state, persist, on_event)

    # ------------------------------------------------------------------ public API
    def evaluate(
        self,
        signal: Signal,
        view: PortfolioView,
        *,
        atr: float | None = None,
        weight: float = 1.0,
        corr_fn: Callable[[str, str], float | None] | None = None,
        kelly: KellyEstimate | None = None,
        data_age_seconds: float | None = None,
        confidence_scaling: bool = True,
    ) -> RiskDecision:
        try:
            return self._evaluate(signal, view, atr, weight, corr_fn, kelly, data_age_seconds, confidence_scaling)
        except Exception as exc:  # FAIL CLOSED
            log.exception("risk evaluation error; rejecting signal")
            return RiskDecision(False, signal, reasons=[f"risk_engine_error:{type(exc).__name__}"])

    def on_equity(self, ts: pd.Timestamp, equity: float) -> list[RiskEvent]:
        return self.breaker.update_equity(ts, equity)

    @property
    def entries_blocked(self) -> bool:
        return self.state.entries_blocked

    # ------------------------------------------------------------------ internals
    def _evaluate(
        self,
        sig: Signal,
        view: PortfolioView,
        atr: float | None,
        weight: float,
        corr_fn: Callable[[str, str], float | None] | None,
        kelly: KellyEstimate | None,
        data_age: float | None,
        confidence_scaling: bool,
    ) -> RiskDecision:
        if sig.is_exit:
            return RiskDecision(True, sig, reasons=["exit_always_permitted"])
        reasons: list[str] = []
        s = self.state
        if s.kill_switch:
            reasons.append("kill_switch_engaged")
        if s.halted:
            reasons.append(f"halted:{s.halt_reason}")
        if s.transient_blocks:
            reasons.extend(f"blocked:{k}" for k in s.transient_blocks)
        if data_age is not None and data_age > self.cfg.circuit_breakers.max_data_staleness_seconds:
            reasons.append("stale_market_data")
        if sig.direction is Direction.FLAT:
            reasons.append("flat_direction")
        if not (np.isfinite(sig.entry_price) and sig.entry_price > 0):
            reasons.append("invalid_entry_price")
        if weight <= 0:
            reasons.append("zero_strategy_weight")
        if reasons:
            return RiskDecision(False, sig, reasons=reasons)

        prot = validate_protection(sig.direction, sig.entry_price, sig.stop_loss, sig.take_profit, atr, self.cfg.stops)
        if prot:
            return RiskDecision(False, sig, reasons=prot)
        assert sig.stop_loss is not None

        frac, method = base_risk_fraction(self.cfg.sizing, sig.proposed_risk_fraction, kelly)
        adjustments: dict[str, Any] = {"base_fraction": frac, "weight": weight}
        frac *= min(max(weight, 0.0), 1.0)
        if confidence_scaling:
            cscale = 0.5 + 0.5 * float(np.clip(sig.confidence, 0.0, 1.0))
            frac *= cscale
            adjustments["confidence_scale"] = cscale
        frac = min(frac, self.cfg.sizing.max_risk_per_trade)
        if frac <= 0:
            return RiskDecision(False, sig, reasons=["non_positive_risk_fraction"], sizing_method=method)

        existing = [(sym, int(np.sign(q))) for _, sym, q in view.positions if abs(q) > 1e-12]
        cscale_corr, corr_notes = correlation_scale(
            sig.symbol, int(sig.direction), existing, corr_fn or (lambda a, b: None), self.cfg.exposure.correlation_threshold
        )
        frac *= cscale_corr
        adjustments["correlation_scale"] = cscale_corr
        if corr_notes:
            adjustments["correlated_with"] = corr_notes

        qty = quantity_for_risk(view.equity, frac, sig.entry_price, sig.stop_loss)
        capped, cap_notes = cap_quantity(view, sig.symbol, int(sig.direction), sig.entry_price, qty, self.cfg.exposure)
        if cap_notes:
            adjustments["caps"] = cap_notes
        if capped <= 0:
            return RiskDecision(False, sig, reasons=cap_notes or ["zero_quantity"], sizing_method=method, adjustments=adjustments)
        risk_amt = capped * abs(sig.entry_price - sig.stop_loss)
        # Final invariant: never exceed the hard per-trade risk ceiling.
        if risk_amt > self.cfg.sizing.max_risk_per_trade * view.equity * (1 + 1e-9):
            return RiskDecision(False, sig, reasons=["risk_ceiling_violation"], adjustments=adjustments)
        return RiskDecision(True, sig, capped, sig.stop_loss, sig.take_profit, frac, risk_amt, method, [], adjustments)
