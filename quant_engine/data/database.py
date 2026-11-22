"""SQLite persistence (SQLAlchemy Core).

One database holds both the market-data cache index and all transactional trading
state.  Every state mutation in the execution path goes through :func:`transaction`
so that an order, its fills and the resulting position update commit atomically.
"""

from __future__ import annotations

import contextlib
import json
import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pandas as pd
from sqlalchemy import (
    Boolean,
    Column,
    Float,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
    create_engine,
    event,
    text,
)
from sqlalchemy.engine import Connection, Engine

metadata = MetaData()

# ---------------------------------------------------------------- market-data cache index
data_cache_index = Table(
    "data_cache_index",
    metadata,
    Column("exchange", String(32), primary_key=True),
    Column("symbol", String(32), primary_key=True),
    Column("timeframe", String(8), primary_key=True),
    Column("path", Text, nullable=False),
    Column("first_open_ms", Integer),
    Column("last_open_ms", Integer),
    Column("rows", Integer),
    Column("missing_bars", Integer),
    Column("duplicates_removed", Integer),
    Column("sha256", String(64)),
    Column("updated_at", String(40)),
    Column("validation_json", Text),
)

# ---------------------------------------------------------------- trading state
orders = Table(
    "orders",
    metadata,
    Column("client_order_id", String(64), primary_key=True),
    Column("exchange_order_id", String(64)),
    Column("mode", String(10), nullable=False),
    Column("symbol", String(32), nullable=False),
    Column("side", String(4), nullable=False),
    Column("order_type", String(24), nullable=False),
    Column("intent", String(16), nullable=False),
    Column("strategy_id", String(48), nullable=False),
    Column("quantity", Float, nullable=False),
    Column("price", Float),
    Column("stop_price", Float),
    Column("reduce_only", Boolean, default=False),
    Column("status", String(20), nullable=False),
    Column("filled_quantity", Float, default=0.0),
    Column("avg_fill_price", Float, default=0.0),
    Column("fees_paid", Float, default=0.0),
    Column("parent_id", String(64)),
    Column("signal_id", String(64)),
    Column("reject_reason", Text),
    Column("created_at", String(40), nullable=False),
    Column("updated_at", String(40), nullable=False),
)
Index("ix_orders_status", orders.c.status)

fills = Table(
    "fills",
    metadata,
    Column("fill_id", String(64), primary_key=True),
    Column("client_order_id", String(64), nullable=False),
    Column("mode", String(10), nullable=False),
    Column("symbol", String(32), nullable=False),
    Column("side", String(4), nullable=False),
    Column("quantity", Float, nullable=False),
    Column("price", Float, nullable=False),
    Column("fee", Float, nullable=False),
    Column("liquidity", String(8)),
    Column("slippage_bps", Float),
    Column("strategy_id", String(48)),
    Column("intent", String(16)),
    Column("timestamp", String(40), nullable=False),
)

positions = Table(
    "positions",
    metadata,
    Column("mode", String(10), primary_key=True),
    Column("symbol", String(32), primary_key=True),
    Column("strategy_id", String(48), primary_key=True),
    Column("quantity", Float, nullable=False),
    Column("avg_entry_price", Float, nullable=False),
    Column("realized_pnl", Float, default=0.0),
    Column("stop_loss", Float),
    Column("take_profit", Float),
    Column("trailing_stop_distance", Float),
    Column("highest_price", Float),
    Column("lowest_price", Float),
    Column("fees_paid", Float, default=0.0),
    Column("funding_paid", Float, default=0.0),
    Column("opened_at", String(40)),
    Column("entry_signal_id", String(64)),
    Column("max_hold_until", String(40)),
    Column("updated_at", String(40), nullable=False),
)

account_state = Table(
    "account_state",
    metadata,
    Column("mode", String(10), primary_key=True),
    Column("cash", Float, nullable=False),
    Column("initial_capital", Float, nullable=False),
    Column("high_water_mark", Float, nullable=False),
    Column("day_start_equity", Float, nullable=False),
    Column("day", String(10), nullable=False),
    Column("updated_at", String(40), nullable=False),
)

equity_snapshots = Table(
    "equity_snapshots",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("mode", String(10), nullable=False),
    Column("timestamp", String(40), nullable=False),
    Column("equity", Float, nullable=False),
    Column("cash", Float, nullable=False),
    Column("unrealized_pnl", Float, nullable=False),
    Column("realized_pnl", Float, nullable=False),
    Column("gross_exposure", Float, nullable=False),
    Column("drawdown", Float, nullable=False),
)
Index("ix_equity_mode_ts", equity_snapshots.c.mode, equity_snapshots.c.timestamp)

trades = Table(
    "trades",
    metadata,
    Column("trade_id", String(64), primary_key=True),
    Column("mode", String(10), nullable=False),
    Column("strategy_id", String(48), nullable=False),
    Column("symbol", String(32), nullable=False),
    Column("direction", Integer, nullable=False),
    Column("quantity", Float, nullable=False),
    Column("entry_price", Float, nullable=False),
    Column("exit_price", Float, nullable=False),
    Column("entry_time", String(40), nullable=False),
    Column("exit_time", String(40), nullable=False),
    Column("pnl", Float, nullable=False),
    Column("fees", Float, nullable=False),
    Column("funding", Float, nullable=False),
    Column("exit_reason", String(32)),
)

risk_state = Table(
    "risk_state",
    metadata,
    Column("mode", String(10), primary_key=True),
    Column("halted", Boolean, nullable=False, default=False),
    Column("halt_reason", Text),
    Column("halted_at", String(40)),
    Column("requires_authorization", Boolean, nullable=False, default=False),
    Column("kill_switch", Boolean, nullable=False, default=False),
    Column("consecutive_errors", Integer, default=0),
    Column("state_json", Text),
    Column("updated_at", String(40), nullable=False),
)

risk_events = Table(
    "risk_events",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("mode", String(10), nullable=False),
    Column("timestamp", String(40), nullable=False),
    Column("severity", String(10), nullable=False),
    Column("event_type", String(48), nullable=False),
    Column("message", Text, nullable=False),
    Column("details_json", Text),
)

strategy_state = Table(
    "strategy_state",
    metadata,
    Column("mode", String(10), primary_key=True),
    Column("strategy_id", String(48), primary_key=True),
    Column("status", String(24), nullable=False),
    Column("weight", Float, nullable=False, default=0.0),
    Column("params_json", Text),
    Column("last_signal_ts", String(40)),
    Column("updated_at", String(40), nullable=False),
)

execution_events = Table(
    "execution_events",
    metadata,
    Column("event_id", String(64), primary_key=True),  # dedupe key
    Column("mode", String(10), nullable=False),
    Column("timestamp", String(40), nullable=False),
    Column("event_type", String(32), nullable=False),
    Column("payload_json", Text),
)

processed_signals = Table(
    "processed_signals",
    metadata,
    Column("signal_id", String(64), primary_key=True),
    Column("mode", String(10), nullable=False),
    Column("strategy_id", String(48)),
    Column("symbol", String(32)),
    Column("timestamp", String(40)),
    Column("decision", String(16)),
    Column("reasons", Text),
)

control_commands = Table(
    "control_commands",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("mode", String(10), nullable=False),
    Column("command", String(32), nullable=False),
    Column("requested_by", String(64), nullable=False),
    Column("requested_at", String(40), nullable=False),
    Column("status", String(16), nullable=False),  # queued | done | failed
    Column("result_json", Text),
    Column("completed_at", String(40)),
)

audit_log = Table(
    "audit_log",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("timestamp", String(40), nullable=False),
    Column("actor", String(64), nullable=False),
    Column("action", String(64), nullable=False),
    Column("details_json", Text),
    Column("ip", String(64)),
)

config_versions = Table(
    "config_versions",
    metadata,
    Column("version_hash", String(32), primary_key=True),
    Column("created_at", String(40), nullable=False),
    Column("config_json", Text, nullable=False),
)

engine_heartbeat = Table(
    "engine_heartbeat",
    metadata,
    Column("mode", String(10), primary_key=True),
    Column("timestamp", String(40), nullable=False),
    Column("status", String(16), nullable=False),
    Column("details_json", Text),
    UniqueConstraint("mode"),
)

alerts = Table(
    "alerts",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("timestamp", String(40), nullable=False),
    Column("severity", String(10), nullable=False),
    Column("title", String(128), nullable=False),
    Column("message", Text, nullable=False),
    Column("delivered", Boolean, default=False),
)


_engines: dict[str, Engine] = {}
_lock = threading.Lock()


def _sqlite_pragmas(dbapi_conn: Any, _record: Any) -> None:
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=FULL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA busy_timeout=5000")
    cur.close()


def get_engine(url: str) -> Engine:
    """Return a (cached) engine and make sure the schema exists."""
    with _lock:
        if url in _engines:
            return _engines[url]
        if url.startswith("sqlite:///") and ":memory:" not in url:
            Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
        eng = create_engine(url, future=True, pool_pre_ping=True)
        if url.startswith("sqlite"):
            event.listen(eng, "connect", _sqlite_pragmas)
        metadata.create_all(eng)
        _engines[url] = eng
        return eng


def dispose_engine(url: str) -> None:
    with _lock:
        eng = _engines.pop(url, None)
    if eng is not None:
        eng.dispose()


@contextlib.contextmanager
def transaction(engine: Engine) -> Iterator[Connection]:
    """Atomic unit of work: commits on success, rolls back on any exception."""
    with engine.begin() as conn:
        yield conn


def integrity_check(engine: Engine) -> tuple[bool, str]:
    try:
        with engine.connect() as conn:
            res = conn.execute(text("PRAGMA integrity_check")).scalar()
        return res == "ok", str(res)
    except Exception as exc:  # fail closed
        return False, f"{type(exc).__name__}: {exc}"


def utc_now_iso() -> str:
    return pd.Timestamp.now(tz="UTC").isoformat()


def to_json(obj: Any) -> str:
    return json.dumps(obj, default=str, sort_keys=True)


def init_database(url: str) -> Engine:
    """Create all tables (idempotent).  Used by ``scripts/init_db.py``."""
    return get_engine(url)
