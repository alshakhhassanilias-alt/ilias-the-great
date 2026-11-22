"""Transactional persistence of trading state (orders, fills, positions, account, risk, events).

Design rules:
* One SQL transaction per logical unit (e.g. a fill + the position/account update it causes).
* Idempotency keys: ``orders.client_order_id``, ``fills.fill_id``, ``execution_events.event_id``,
  ``processed_signals.signal_id`` are primary keys; re-inserting is a no-op, so replays after a
  crash cannot duplicate.
* Everything needed to rebuild the in-memory engine is reloadable via :meth:`load_snapshot`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import pandas as pd
from sqlalchemy import and_, delete, select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Connection, Engine

from quant_engine.core.accounting import ClosedTrade, Ledger
from quant_engine.core.types import Fill, Order, OrderIntent, OrderStatus, OrderType, Position, Side
from quant_engine.data import database as db
from quant_engine.risk.circuit_breaker import RiskEvent, RiskState


def _ts(x: pd.Timestamp | None) -> str | None:
    return None if x is None else pd.Timestamp(x).isoformat()


def _pts(x: str | None) -> pd.Timestamp | None:
    return None if not x else pd.Timestamp(x)


@dataclass
class Snapshot:
    cash: float | None
    initial_capital: float | None
    positions: list[Position] = field(default_factory=list)
    open_orders: list[Order] = field(default_factory=list)
    risk_state: RiskState | None = None
    trade_count: int = 0
    fill_count: int = 0


class StateStore:
    def __init__(self, engine: Engine, mode: str) -> None:
        self.engine = engine
        self.mode = mode

    # ------------------------------------------------------------------ helpers
    def _upsert(self, conn: Connection, table: Any, row: dict[str, Any], keys: list[str]) -> None:
        stmt = sqlite_insert(table).values(**row)
        stmt = stmt.on_conflict_do_update(index_elements=keys, set_={k: v for k, v in row.items() if k not in keys})
        conn.execute(stmt)

    def _insert_ignore(self, conn: Connection, table: Any, row: dict[str, Any]) -> bool:
        res = conn.execute(sqlite_insert(table).values(**row).on_conflict_do_nothing())
        return bool(res.rowcount)

    # ------------------------------------------------------------------ orders / fills
    def order_row(self, o: Order) -> dict[str, Any]:
        now = db.utc_now_iso()
        return {
            "client_order_id": o.client_order_id,
            "exchange_order_id": o.exchange_order_id,
            "mode": self.mode,
            "symbol": o.symbol,
            "side": o.side.value,
            "order_type": o.order_type.value,
            "intent": o.intent.value,
            "strategy_id": o.strategy_id,
            "quantity": o.quantity,
            "price": o.price,
            "stop_price": o.stop_price,
            "reduce_only": o.reduce_only,
            "status": o.status.value,
            "filled_quantity": o.filled_quantity,
            "avg_fill_price": o.avg_fill_price,
            "fees_paid": o.fees_paid,
            "parent_id": o.parent_id,
            "signal_id": o.signal_id,
            "reject_reason": o.reject_reason,
            "created_at": _ts(o.created_at) or now,
            "updated_at": now,
        }

    def order_exists(self, client_order_id: str) -> bool:
        with self.engine.connect() as c:
            return (
                c.execute(select(db.orders.c.client_order_id).where(db.orders.c.client_order_id == client_order_id)).first()
                is not None
            )

    def get_order(self, client_order_id: str) -> Order | None:
        with self.engine.connect() as c:
            r = c.execute(select(db.orders).where(db.orders.c.client_order_id == client_order_id)).first()
        return self._row_to_order(r._mapping) if r else None

    def count_dead_protective(self, parent_id: str, intent: str) -> int:
        """Number of cancelled/rejected/expired protective orders for one position (revision counter)."""
        with self.engine.connect() as c:
            return len(
                c.execute(
                    select(db.orders.c.client_order_id).where(
                        and_(
                            db.orders.c.parent_id == parent_id,
                            db.orders.c.intent == intent,
                            db.orders.c.status.in_(
                                [OrderStatus.CANCELED.value, OrderStatus.REJECTED.value, OrderStatus.EXPIRED.value]
                            ),
                        )
                    )
                ).all()
            )

    def save_order(self, o: Order, conn: Connection | None = None) -> None:
        if conn is None:
            with db.transaction(self.engine) as c:
                self._upsert(c, db.orders, self.order_row(o), ["client_order_id"])
        else:
            self._upsert(conn, db.orders, self.order_row(o), ["client_order_id"])

    def record_fill(self, conn: Connection, f: Fill) -> bool:
        return self._insert_ignore(
            conn,
            db.fills,
            {
                "fill_id": f.fill_id,
                "client_order_id": f.client_order_id,
                "mode": self.mode,
                "symbol": f.symbol,
                "side": f.side.value,
                "quantity": f.quantity,
                "price": f.price,
                "fee": f.fee,
                "liquidity": f.liquidity,
                "slippage_bps": f.slippage_bps,
                "strategy_id": f.strategy_id,
                "intent": f.intent.value,
                "timestamp": _ts(f.timestamp),
            },
        )

    def fill_exists(self, fill_id: str) -> bool:
        with self.engine.connect() as c:
            return c.execute(select(db.fills.c.fill_id).where(db.fills.c.fill_id == fill_id)).first() is not None

    def save_trade(self, conn: Connection, t: ClosedTrade) -> None:
        self._insert_ignore(
            conn,
            db.trades,
            {
                "trade_id": f"{self.mode}-{t.trade_id}-{_ts(t.exit_time)}",
                "mode": self.mode,
                "strategy_id": t.strategy_id,
                "symbol": t.symbol,
                "direction": t.direction,
                "quantity": t.quantity,
                "entry_price": t.entry_price,
                "exit_price": t.exit_price,
                "entry_time": _ts(t.entry_time),
                "exit_time": _ts(t.exit_time),
                "pnl": t.pnl,
                "fees": t.fees,
                "funding": t.funding,
                "exit_reason": t.exit_reason,
            },
        )

    # ------------------------------------------------------------------ positions / account
    def save_ledger(
        self, conn: Connection, ledger: Ledger, initial_capital: float, hwm: float, day_start: float, day: str
    ) -> None:
        now = db.utc_now_iso()
        self._upsert(
            conn,
            db.account_state,
            {
                "mode": self.mode,
                "cash": ledger.cash,
                "initial_capital": initial_capital,
                "high_water_mark": hwm,
                "day_start_equity": day_start,
                "day": day,
                "updated_at": now,
            },
            ["mode"],
        )
        conn.execute(delete(db.positions).where(db.positions.c.mode == self.mode))
        for p in ledger.open_positions():
            conn.execute(
                sqlite_insert(db.positions).values(
                    mode=self.mode,
                    symbol=p.symbol,
                    strategy_id=p.strategy_id,
                    quantity=p.quantity,
                    avg_entry_price=p.avg_entry_price,
                    realized_pnl=p.realized_pnl,
                    stop_loss=p.stop_loss,
                    take_profit=p.take_profit,
                    trailing_stop_distance=p.trailing_stop_distance,
                    highest_price=p.highest_price,
                    lowest_price=p.lowest_price,
                    fees_paid=p.fees_paid,
                    funding_paid=p.funding_paid,
                    opened_at=_ts(p.opened_at),
                    entry_signal_id=p.entry_signal_id,
                    max_hold_until=_ts(p.max_hold_until),
                    updated_at=now,
                )
            )

    def save_equity(
        self, ts: pd.Timestamp, equity: float, cash: float, upnl: float, rpnl: float, gross: float, dd: float
    ) -> None:
        with db.transaction(self.engine) as c:
            c.execute(
                db.equity_snapshots.insert().values(
                    mode=self.mode,
                    timestamp=_ts(ts),
                    equity=equity,
                    cash=cash,
                    unrealized_pnl=upnl,
                    realized_pnl=rpnl,
                    gross_exposure=gross,
                    drawdown=dd,
                )
            )

    # ------------------------------------------------------------------ risk
    def save_risk_state(self, s: RiskState) -> None:
        with db.transaction(self.engine) as c:
            self._upsert(
                c,
                db.risk_state,
                {
                    "mode": self.mode,
                    "halted": s.halted,
                    "halt_reason": s.halt_reason,
                    "halted_at": s.halted_at,
                    "requires_authorization": s.requires_authorization,
                    "kill_switch": s.kill_switch,
                    "consecutive_errors": s.consecutive_errors,
                    "state_json": json.dumps(s.to_dict()),
                    "updated_at": db.utc_now_iso(),
                },
                ["mode"],
            )

    def load_risk_state(self) -> RiskState | None:
        with self.engine.connect() as c:
            r = c.execute(select(db.risk_state).where(db.risk_state.c.mode == self.mode)).first()
        if not r:
            return None
        st = RiskState.from_dict(json.loads(r.state_json or "{}"))
        # Column-level flags win: they may be set directly by the dashboard kill switch.
        st.halted = bool(r.halted) or st.halted
        st.kill_switch = bool(r.kill_switch) or st.kill_switch
        st.requires_authorization = bool(r.requires_authorization) or st.requires_authorization
        st.halt_reason = r.halt_reason or st.halt_reason
        return st

    def record_risk_event(self, ev: RiskEvent) -> None:
        with db.transaction(self.engine) as c:
            c.execute(
                db.risk_events.insert().values(
                    mode=self.mode,
                    timestamp=ev.timestamp,
                    severity=ev.severity,
                    event_type=ev.event_type,
                    message=ev.message,
                    details_json=json.dumps({**ev.details, "action": ev.action.value}, default=str),
                )
            )

    # ------------------------------------------------------------------ signals / events / commands
    def mark_signal(
        self, signal_id: str, strategy_id: str, symbol: str, ts: pd.Timestamp, decision: str, reasons: list[str]
    ) -> bool:
        """Returns False if this signal was already processed (duplicate protection)."""
        with db.transaction(self.engine) as c:
            return self._insert_ignore(
                c,
                db.processed_signals,
                {
                    "signal_id": signal_id,
                    "mode": self.mode,
                    "strategy_id": strategy_id,
                    "symbol": symbol,
                    "timestamp": _ts(ts),
                    "decision": decision,
                    "reasons": ",".join(reasons),
                },
            )

    def signal_processed(self, signal_id: str) -> bool:
        with self.engine.connect() as c:
            return (
                c.execute(select(db.processed_signals.c.signal_id).where(db.processed_signals.c.signal_id == signal_id)).first()
                is not None
            )

    def record_event(self, event_id: str, event_type: str, payload: dict[str, Any], conn: Connection | None = None) -> bool:
        row = {
            "event_id": event_id,
            "mode": self.mode,
            "timestamp": db.utc_now_iso(),
            "event_type": event_type,
            "payload_json": json.dumps(payload, default=str),
        }
        if conn is not None:
            return self._insert_ignore(conn, db.execution_events, row)
        with db.transaction(self.engine) as c:
            return self._insert_ignore(c, db.execution_events, row)

    def pending_commands(self) -> list[dict[str, Any]]:
        with self.engine.connect() as c:
            rows = c.execute(
                select(db.control_commands)
                .where(and_(db.control_commands.c.mode == self.mode, db.control_commands.c.status == "queued"))
                .order_by(db.control_commands.c.id)
            ).all()
        return [dict(r._mapping) for r in rows]

    def complete_command(self, cid: int, ok: bool, result: dict[str, Any]) -> None:
        with db.transaction(self.engine) as c:
            c.execute(
                update(db.control_commands)
                .where(db.control_commands.c.id == cid)
                .values(
                    status="done" if ok else "failed", result_json=json.dumps(result, default=str), completed_at=db.utc_now_iso()
                )
            )

    def heartbeat(self, status: str, details: dict[str, Any]) -> None:
        with db.transaction(self.engine) as c:
            self._upsert(
                c,
                db.engine_heartbeat,
                {
                    "mode": self.mode,
                    "timestamp": db.utc_now_iso(),
                    "status": status,
                    "details_json": json.dumps(details, default=str),
                },
                ["mode"],
            )

    def save_strategy_state(
        self, sid: str, status: str, weight: float, params: dict[str, Any], last_signal_ts: pd.Timestamp | None
    ) -> None:
        with db.transaction(self.engine) as c:
            self._upsert(
                c,
                db.strategy_state,
                {
                    "mode": self.mode,
                    "strategy_id": sid,
                    "status": status,
                    "weight": weight,
                    "params_json": json.dumps(params, default=str),
                    "last_signal_ts": _ts(last_signal_ts),
                    "updated_at": db.utc_now_iso(),
                },
                ["mode", "strategy_id"],
            )

    def save_config_version(self, version_hash: str, config: dict[str, Any]) -> None:
        with db.transaction(self.engine) as c:
            self._insert_ignore(
                c,
                db.config_versions,
                {"version_hash": version_hash, "created_at": db.utc_now_iso(), "config_json": json.dumps(config, default=str)},
            )

    def alert(self, severity: str, title: str, message: str) -> None:
        with db.transaction(self.engine) as c:
            c.execute(
                db.alerts.insert().values(
                    timestamp=db.utc_now_iso(), severity=severity, title=title, message=message, delivered=False
                )
            )

    # ------------------------------------------------------------------ reload
    @staticmethod
    def _row_to_order(m: Any) -> Order:
        return Order(
            m["client_order_id"],
            m["symbol"],
            Side(m["side"]),
            OrderType(m["order_type"]),
            m["quantity"],
            OrderIntent(m["intent"]),
            m["strategy_id"],
            pd.Timestamp(m["created_at"]),
            m["price"],
            m["stop_price"],
            bool(m["reduce_only"]),
            OrderStatus(m["status"]),
            m["filled_quantity"] or 0.0,
            m["avg_fill_price"] or 0.0,
            m["fees_paid"] or 0.0,
            m["exchange_order_id"],
            m["parent_id"],
            m["reject_reason"],
            m["signal_id"],
        )

    def load_snapshot(self) -> Snapshot:
        with self.engine.connect() as c:
            acct = c.execute(select(db.account_state).where(db.account_state.c.mode == self.mode)).first()
            prow = c.execute(select(db.positions).where(db.positions.c.mode == self.mode)).all()
            orows = c.execute(
                select(db.orders).where(
                    and_(
                        db.orders.c.mode == self.mode,
                        db.orders.c.status.in_(
                            [OrderStatus.OPEN.value, OrderStatus.PENDING.value, OrderStatus.PARTIALLY_FILLED.value]
                        ),
                    )
                )
            ).all()
            ntr = c.execute(select(db.trades.c.trade_id).where(db.trades.c.mode == self.mode)).all()
            nfi = c.execute(select(db.fills.c.fill_id).where(db.fills.c.mode == self.mode)).all()
        positions = [
            Position(
                symbol=r.symbol,
                quantity=r.quantity,
                avg_entry_price=r.avg_entry_price,
                realized_pnl=r.realized_pnl or 0.0,
                strategy_id=r.strategy_id,
                opened_at=_pts(r.opened_at),
                stop_loss=r.stop_loss,
                take_profit=r.take_profit,
                trailing_stop_distance=r.trailing_stop_distance,
                highest_price=r.highest_price,
                lowest_price=r.lowest_price,
                fees_paid=r.fees_paid or 0.0,
                funding_paid=r.funding_paid or 0.0,
                entry_signal_id=r.entry_signal_id,
                max_hold_until=_pts(r.max_hold_until),
            )
            for r in prow
        ]
        return Snapshot(
            acct.cash if acct else None,
            acct.initial_capital if acct else None,
            positions,
            [self._row_to_order(r._mapping) for r in orows],
            self.load_risk_state(),
            len(ntr),
            len(nfi),
        )

    def account_row(self) -> dict[str, Any] | None:
        with self.engine.connect() as c:
            r = c.execute(select(db.account_state).where(db.account_state.c.mode == self.mode)).first()
        return dict(r._mapping) if r else None
