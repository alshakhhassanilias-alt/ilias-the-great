"""Reconciliation of local state against the broker and against the persisted fill journal."""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd
from sqlalchemy import select

from quant_engine.core.accounting import Ledger
from quant_engine.core.types import Fill, OrderIntent, Side
from quant_engine.data import database as db
from quant_engine.execution.exchange_adapter import Broker
from quant_engine.execution.state_store import StateStore


@dataclass
class ReconciliationReport:
    ok: bool
    discrepancies: list[str] = field(default_factory=list)
    local_positions: dict[str, float] = field(default_factory=dict)
    broker_positions: dict[str, float] = field(default_factory=dict)
    replay_cash: float | None = None
    stored_cash: float | None = None


def local_net_positions(ledger: Ledger) -> dict[str, float]:
    out: dict[str, float] = {}
    for p in ledger.open_positions():
        out[p.symbol] = out.get(p.symbol, 0.0) + p.quantity
    return out


def reconcile_with_broker(ledger: Ledger, broker: Broker, tol_fraction: float = 1e-3) -> ReconciliationReport:
    local = local_net_positions(ledger)
    remote = {k: v for k, v in broker.net_positions().items() if abs(v) > 1e-12}
    rep = ReconciliationReport(True, [], local, remote)
    for sym in set(local) | set(remote):
        lq, rq = local.get(sym, 0.0), remote.get(sym, 0.0)
        if abs(lq - rq) > max(tol_fraction * max(abs(lq), abs(rq)), 1e-9):
            rep.ok = False
            rep.discrepancies.append(f"{sym}: local={lq} broker={rq}")
    return rep


def replay_fill_journal(store: StateStore, initial_capital: float) -> Ledger:
    """Rebuild a ledger purely from the append-only fills table (chronological)."""
    led = Ledger(cash=initial_capital)
    with store.engine.connect() as c:
        rows = c.execute(
            select(db.fills).where(db.fills.c.mode == store.mode).order_by(db.fills.c.timestamp, db.fills.c.fill_id)
        ).all()
    for r in rows:
        led.apply_fill(
            Fill(
                r.fill_id,
                r.client_order_id,
                r.symbol,
                Side(r.side),
                r.quantity,
                r.price,
                r.fee,
                pd.Timestamp(r.timestamp),
                r.liquidity or "taker",
                r.slippage_bps or 0.0,
                r.strategy_id or "",
                OrderIntent(r.intent or "entry"),
            )
        )
    return led


def verify_against_journal(ledger: Ledger, store: StateStore, initial_capital: float, tol: float = 1e-6) -> ReconciliationReport:
    replay = replay_fill_journal(store, initial_capital)
    rep = ReconciliationReport(True, [], local_net_positions(ledger), local_net_positions(replay), replay.cash, ledger.cash)
    if abs(replay.cash - ledger.cash) > max(tol * abs(initial_capital), 1e-6):
        rep.ok = False
        rep.discrepancies.append(f"cash: stored={ledger.cash:.6f} journal={replay.cash:.6f}")
    for key in set(ledger.positions) | set(replay.positions):
        a = ledger.positions.get(key)
        b = replay.positions.get(key)
        qa, qb = (a.quantity if a else 0.0), (b.quantity if b else 0.0)
        if abs(qa - qb) > 1e-9:
            rep.ok = False
            rep.discrepancies.append(f"{key}: stored={qa} journal={qb}")
    return rep
