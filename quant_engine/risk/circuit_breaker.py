"""Circuit breakers.

Policies by trigger:

=====================================  ===================================================
Trigger                                Action
=====================================  ===================================================
daily drawdown >= limit                HALT + cancel entries + flatten; human authorisation
total drawdown (from HWM) >= limit     HALT + cancel entries + flatten; human authorisation
kill switch                            HALT + cancel all + flatten; human authorisation
position discrepancy, invalid balance, HALT new orders; human authorisation (never
database failure, clock skew,          auto-resumes after an unexplained discrepancy)
repeated exchange errors,
abnormal slippage
stale market data, excessive latency   BLOCK new entries while the condition persists
                                       (transient; clears automatically when healthy)
=====================================  ===================================================

The halted state is persisted through the ``persist`` callback *before* any other action so a
crash mid-flatten restarts halted.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any

import pandas as pd

from quant_engine.config.settings import CircuitBreakerConfig


class BreakerAction(StrEnum):
    NONE = "none"
    BLOCK_ENTRIES = "block_entries"
    HALT = "halt"
    HALT_AND_FLATTEN = "halt_and_flatten"


@dataclass
class RiskEvent:
    timestamp: str
    severity: str
    event_type: str
    message: str
    action: BreakerAction = BreakerAction.NONE
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class RiskState:
    halted: bool = False
    halt_reason: str | None = None
    halted_at: str | None = None
    requires_authorization: bool = False
    kill_switch: bool = False
    high_water_mark: float = 0.0
    day_start_equity: float = 0.0
    day: str = ""
    consecutive_errors: int = 0
    transient_blocks: dict[str, str] = field(default_factory=dict)
    breach_count: dict[str, int] = field(default_factory=dict)
    flatten_pending: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> RiskState:
        known = {k: v for k, v in d.items() if k in cls.__dataclass_fields__}
        return cls(**known)

    @property
    def entries_blocked(self) -> bool:
        return self.halted or self.kill_switch or bool(self.transient_blocks)


class CircuitBreaker:
    def __init__(
        self,
        cfg: CircuitBreakerConfig,
        state: RiskState,
        persist: Callable[[RiskState], None] | None = None,
        on_event: Callable[[RiskEvent], None] | None = None,
    ) -> None:
        self.cfg = cfg
        self.state = state
        self._persist_cb = persist or (lambda s: None)
        self._on_event = on_event or (lambda e: None)
        self.persist_failures = 0

    def _persist(self, state: RiskState) -> None:
        """Persist state; a persistence failure never un-halts (in-memory state stays halted)."""
        try:
            self._persist_cb(state)
        except Exception:
            self.persist_failures += 1
            state.halted = True
            state.requires_authorization = True
            state.halt_reason = state.halt_reason or "risk_state_persistence_failure"

    # ------------------------------------------------------------------ helpers
    def _emit(self, ts: str, severity: str, etype: str, msg: str, action: BreakerAction, **details: Any) -> RiskEvent:
        ev = RiskEvent(ts, severity, etype, msg, action, details)
        try:
            self._on_event(ev)
        except Exception:  # event sinks (DB/alerts) must never break risk control
            self.persist_failures += 1
        return ev

    def halt(self, ts: str, reason: str, flatten: bool, kill_switch: bool = False) -> RiskEvent:
        s = self.state
        first = not s.halted
        s.halted = True
        s.requires_authorization = True
        s.kill_switch = s.kill_switch or kill_switch
        if first or kill_switch:
            s.halt_reason = reason
            s.halted_at = ts
        s.flatten_pending = s.flatten_pending or flatten
        s.breach_count[reason.split(":")[0]] = s.breach_count.get(reason.split(":")[0], 0) + 1
        self._persist(s)  # persist BEFORE acting
        action = BreakerAction.HALT_AND_FLATTEN if flatten else BreakerAction.HALT
        return self._emit(ts, "CRITICAL", "circuit_breaker", f"HALT: {reason}", action, reason=reason)

    def authorize_resume(self, ts: str, actor: str, *, unexplained_discrepancy: bool = False) -> RiskEvent:
        if unexplained_discrepancy:
            raise PermissionError("cannot resume while a state discrepancy is unexplained")
        if not actor:
            raise PermissionError("resume requires an identified human operator")
        s = self.state
        s.halted = False
        s.kill_switch = False
        s.requires_authorization = False
        s.halt_reason = None
        s.halted_at = None
        s.flatten_pending = False
        s.consecutive_errors = 0
        self._persist(s)
        return self._emit(ts, "WARNING", "resume_authorized", f"trading resumed by {actor}", BreakerAction.NONE, actor=actor)

    # ------------------------------------------------------------------ drawdown
    def update_equity(self, ts: pd.Timestamp, equity: float) -> list[RiskEvent]:
        s = self.state
        events: list[RiskEvent] = []
        iso = ts.isoformat()
        if equity <= 0 or not pd.notna(equity):
            events.append(self.halt(iso, "invalid_equity", flatten=False))
            return events
        day = ts.strftime("%Y-%m-%d")
        if s.day != day:
            s.day = day
            s.day_start_equity = equity
        s.high_water_mark = max(s.high_water_mark, equity)
        daily_dd = 1 - equity / s.day_start_equity if s.day_start_equity > 0 else 0.0
        total_dd = 1 - equity / s.high_water_mark if s.high_water_mark > 0 else 0.0
        if total_dd >= self.cfg.max_total_drawdown and not (s.halted and (s.halt_reason or "").startswith("total_drawdown")):
            events.append(self.halt(iso, f"total_drawdown:{total_dd:.4f}", flatten=True))
        elif daily_dd >= self.cfg.daily_drawdown_limit and not s.halted:
            events.append(self.halt(iso, f"daily_drawdown:{daily_dd:.4f}", flatten=True))
        return events

    def drawdowns(self, equity: float) -> tuple[float, float]:
        s = self.state
        d = 1 - equity / s.day_start_equity if s.day_start_equity > 0 else 0.0
        t = 1 - equity / s.high_water_mark if s.high_water_mark > 0 else 0.0
        return max(d, 0.0), max(t, 0.0)

    # ------------------------------------------------------------------ operational
    def record_exchange_error(self, ts: str, err: str) -> list[RiskEvent]:
        self.state.consecutive_errors += 1
        if self.state.consecutive_errors >= self.cfg.max_consecutive_exchange_errors:
            return [self.halt(ts, f"repeated_exchange_errors:{self.state.consecutive_errors}:{err[:80]}", flatten=False)]
        self._persist(self.state)
        return []

    def record_exchange_success(self) -> None:
        if self.state.consecutive_errors:
            self.state.consecutive_errors = 0
            self._persist(self.state)

    def _transient(self, ts: str, key: str, bad: bool, msg: str) -> list[RiskEvent]:
        blocks = self.state.transient_blocks
        if bad and key not in blocks:
            blocks[key] = msg
            self._persist(self.state)
            return [self._emit(ts, "WARNING", key, msg, BreakerAction.BLOCK_ENTRIES)]
        if not bad and key in blocks:
            del blocks[key]
            self._persist(self.state)
            return [self._emit(ts, "INFO", f"{key}_cleared", f"{key} condition cleared", BreakerAction.NONE)]
        return []

    def check_data_freshness(self, ts: str, age_seconds: float) -> list[RiskEvent]:
        return self._transient(
            ts, "stale_market_data", age_seconds > self.cfg.max_data_staleness_seconds, f"market data age {age_seconds:.0f}s"
        )

    def check_latency(self, ts: str, latency_ms: float) -> list[RiskEvent]:
        return self._transient(
            ts, "excessive_latency", latency_ms > self.cfg.max_api_latency_ms, f"API latency {latency_ms:.0f}ms"
        )

    def check_clock_skew(self, ts: str, skew_ms: float) -> list[RiskEvent]:
        if abs(skew_ms) > self.cfg.max_clock_skew_ms:
            return [self.halt(ts, f"clock_skew:{skew_ms:.0f}ms", flatten=False)]
        return []

    def check_position_discrepancy(
        self, ts: str, symbol: str, local_qty: float, exchange_qty: float, ref_qty: float
    ) -> list[RiskEvent]:
        tol = self.cfg.max_position_discrepancy_fraction * max(abs(ref_qty), 1e-9)
        if abs(local_qty - exchange_qty) > max(tol, 1e-9):
            return [self.halt(ts, f"position_discrepancy:{symbol}:local={local_qty}:exchange={exchange_qty}", flatten=False)]
        return []

    def check_balance(self, ts: str, balance: float | None) -> list[RiskEvent]:
        if balance is None or not pd.notna(balance) or balance < 0:
            return [self.halt(ts, f"invalid_balance:{balance}", flatten=False)]
        return []

    def check_slippage(self, ts: str, slippage_bps: float) -> list[RiskEvent]:
        if slippage_bps > self.cfg.max_abnormal_slippage_bps:
            return [self.halt(ts, f"abnormal_slippage:{slippage_bps:.1f}bps", flatten=False)]
        return []

    def database_failure(self, ts: str, err: str) -> list[RiskEvent]:
        return [self.halt(ts, f"database_failure:{err[:120]}", flatten=False)]
