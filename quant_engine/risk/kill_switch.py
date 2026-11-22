"""Emergency kill switch and controlled flattening.

Sequence (also used for drawdown circuit-breaker breaches):

1. Persist HALTED (+ kill-switch flag) *first*, so a crash mid-procedure restarts halted.
2. Stop new orders (risk manager rejects every entry while halted).
3. Cancel outstanding orders (entries; all orders for the kill switch).
4. Submit reduce-only flatten orders with deterministic client ids (retries cannot duplicate).
5. Verify remaining exposure through the execution layer.
6. If exposure remains, keep the halt, escalate, and retry with backoff.
7. Resumption requires :meth:`CircuitBreaker.authorize_resume` by an identified human.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Protocol

import pandas as pd

from quant_engine.risk.circuit_breaker import CircuitBreaker

log = logging.getLogger(__name__)


class ExecutionControl(Protocol):
    def cancel_orders(self, entries_only: bool) -> int: ...
    def flatten_all(self, reason: str, attempt_key: str) -> int: ...
    def remaining_exposure(self) -> dict[str, float]: ...


@dataclass
class EmergencyReport:
    reason: str
    started_at: str
    canceled_orders: int = 0
    flatten_orders: int = 0
    attempts: int = 0
    remaining_exposure: dict[str, float] = field(default_factory=dict)
    success: bool = False
    errors: list[str] = field(default_factory=list)


def run_emergency_procedure(
    breaker: CircuitBreaker,
    execution: ExecutionControl,
    reason: str,
    *,
    kill_switch: bool,
    max_attempts: int = 5,
    backoff_s: float = 0.5,
    sleep=time.sleep,
) -> EmergencyReport:
    now = pd.Timestamp.now(tz="UTC").isoformat()
    breaker.halt(now, reason, flatten=True, kill_switch=kill_switch)
    rep = EmergencyReport(reason=reason, started_at=now)
    try:
        rep.canceled_orders = execution.cancel_orders(entries_only=not kill_switch)
    except Exception as exc:
        rep.errors.append(f"cancel_failed:{type(exc).__name__}:{exc}")
    halt_key = breaker.state.halted_at or now
    for attempt in range(1, max_attempts + 1):
        rep.attempts = attempt
        try:
            # Same attempt_key across retries of one halt -> deterministic client ids -> no duplicates.
            rep.flatten_orders += execution.flatten_all(reason, attempt_key=f"{halt_key}")
            exposure = execution.remaining_exposure()
            rep.remaining_exposure = {k: v for k, v in exposure.items() if abs(v) > 1e-12}
            if not rep.remaining_exposure:
                rep.success = True
                break
        except Exception as exc:
            rep.errors.append(f"flatten_attempt_{attempt}:{type(exc).__name__}:{exc}")
        log.error("flatten incomplete (attempt %d): %s", attempt, rep.remaining_exposure or rep.errors[-1:])
        sleep(backoff_s * 2 ** (attempt - 1))
    breaker.state.flatten_pending = not rep.success
    breaker._persist(breaker.state)
    if not rep.success:
        breaker._emit(
            pd.Timestamp.now(tz="UTC").isoformat(),
            "CRITICAL",
            "flatten_failed",
            f"flatten incomplete after {rep.attempts} attempts; system remains HALTED",
            breaker_action_halt(),
            remaining=rep.remaining_exposure,
            errors=rep.errors,
        )
    return rep


def breaker_action_halt():  # small indirection keeps the import local
    from quant_engine.risk.circuit_breaker import BreakerAction

    return BreakerAction.HALT
