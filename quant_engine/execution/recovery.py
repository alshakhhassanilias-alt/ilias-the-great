"""Crash recovery: rebuild in-memory state from the database, verify it, and decide whether
trading may continue.  Never resumes automatically after an unexplained discrepancy."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from quant_engine.core.accounting import Ledger
from quant_engine.data.database import integrity_check
from quant_engine.execution.reconciliation import reconcile_with_broker, verify_against_journal
from quant_engine.execution.state_store import StateStore
from quant_engine.risk.circuit_breaker import CircuitBreaker, RiskState

log = logging.getLogger(__name__)


@dataclass
class RecoveryReport:
    fresh_start: bool
    restored_positions: int = 0
    restored_open_orders: int = 0
    restored_trades: int = 0
    restored_fills: int = 0
    risk_state_restored: bool = False
    halted: bool = False
    db_integrity: str = ""
    journal_ok: bool = True
    broker_ok: bool = True
    discrepancies: list[str] = field(default_factory=list)


def restore_ledger(store: StateStore, initial_capital: float) -> tuple[Ledger, RecoveryReport, RiskState | None, list]:
    snap = store.load_snapshot()
    if snap.cash is None:
        return Ledger(cash=initial_capital), RecoveryReport(fresh_start=True), snap.risk_state, []
    led = Ledger(cash=snap.cash)
    for p in snap.positions:
        led.positions[(p.strategy_id, p.symbol)] = p
    rep = RecoveryReport(
        False, len(snap.positions), len(snap.open_orders), snap.trade_count, snap.fill_count, snap.risk_state is not None
    )
    return led, rep, snap.risk_state, snap.open_orders


def post_restore_checks(
    store: StateStore, ledger: Ledger, broker, breaker: CircuitBreaker, initial_capital: float, rep: RecoveryReport
) -> RecoveryReport:
    ok, msg = integrity_check(store.engine)
    rep.db_integrity = msg
    ts = __import__("pandas").Timestamp.now(tz="UTC").isoformat()
    if not ok:
        breaker.database_failure(ts, msg)
    if not rep.fresh_start:
        j = verify_against_journal(ledger, store, initial_capital)
        rep.journal_ok = j.ok
        rep.discrepancies += j.discrepancies
        b = reconcile_with_broker(ledger, broker)
        rep.broker_ok = b.ok
        rep.discrepancies += b.discrepancies
        if not (j.ok and b.ok):
            breaker.halt(ts, "recovery_state_discrepancy:" + "; ".join(rep.discrepancies)[:300], flatten=False)
    rep.halted = breaker.state.halted
    log.info("recovery: %s", rep)
    return rep
