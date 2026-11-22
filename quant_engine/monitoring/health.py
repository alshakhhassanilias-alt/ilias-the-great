"""System health classification: HEALTHY / DEGRADED / HALTED / DISCONNECTED / RECOVERING."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from quant_engine.core.types import SystemStatus


@dataclass
class HealthSnapshot:
    status: SystemStatus
    reasons: list[str] = field(default_factory=list)
    data_age_seconds: float | None = None
    api_latency_ms: float | None = None
    consecutive_errors: int = 0
    db_ok: bool = True
    clock_offset_ms: float | None = None
    halted: bool = False
    recovering: bool = False

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["status"] = self.status.value
        return d


def classify(
    *,
    halted: bool,
    recovering: bool,
    connected: bool,
    data_age_s: float | None,
    latency_ms: float | None,
    consecutive_errors: int,
    db_ok: bool,
    clock_offset_ms: float | None,
    max_age_s: float,
    max_latency_ms: float,
    max_clock_skew_ms: float,
    transient_blocks: dict[str, str] | None = None,
) -> HealthSnapshot:
    reasons: list[str] = []
    if recovering:
        status = SystemStatus.RECOVERING
        reasons.append("restart recovery in progress")
    elif halted:
        status = SystemStatus.HALTED
        reasons.append("trading halted by risk controls")
    elif not connected:
        status = SystemStatus.DISCONNECTED
        reasons.append("no successful market-data request")
    else:
        status = SystemStatus.HEALTHY
    degraded = []
    if data_age_s is not None and data_age_s > max_age_s:
        degraded.append(f"stale market data ({data_age_s:.0f}s)")
    if latency_ms is not None and latency_ms > max_latency_ms:
        degraded.append(f"high API latency ({latency_ms:.0f}ms)")
    if consecutive_errors:
        degraded.append(f"{consecutive_errors} consecutive exchange errors")
    if not db_ok:
        degraded.append("database unhealthy")
    if clock_offset_ms is not None and abs(clock_offset_ms) > max_clock_skew_ms:
        degraded.append(f"clock skew {clock_offset_ms:.0f}ms")
    degraded += [f"blocked: {k}" for k in (transient_blocks or {})]
    if degraded and status is SystemStatus.HEALTHY:
        status = SystemStatus.DEGRADED
    return HealthSnapshot(
        status, reasons + degraded, data_age_s, latency_ms, consecutive_errors, db_ok, clock_offset_ms, halted, recovering
    )
