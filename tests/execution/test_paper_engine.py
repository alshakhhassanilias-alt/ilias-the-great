"""Integration + adversarial tests of the paper engine, persistence, recovery and kill switch."""

import json

import ccxt
import pandas as pd
import pytest
from sqlalchemy import select, update

from quant_engine.config.settings import EnvSettings, TradingMode
from quant_engine.core.types import Direction, Order, OrderIntent, OrderStatus, OrderType, Side, Signal
from quant_engine.data import database as db
from quant_engine.execution.engine import TradingEngine
from quant_engine.execution.order_manager import OrderManager
from quant_engine.execution.state_store import StateStore
from tests.execution.fakes import FakeFeed

SYM = "BTC/USDT"


@pytest.fixture
def env(tmp_path):
    return EnvSettings(_env_file=None, database_url=f"sqlite:///{tmp_path}/t.sqlite", artifacts_dir=str(tmp_path),
                       initial_paper_capital=100_000.0)


def make_engine(cfg, env, feed=None, **kw):
    store = StateStore(db.get_engine(env.database_url), "PAPER")
    return TradingEngine(cfg, env, TradingMode.PAPER, store, feed or FakeFeed(), [], {}, **kw)


def sig(price=100.0, direction=Direction.LONG, ts="2024-01-01 00:15", sid="breakout", stop=None, tp=None):
    stop = stop if stop is not None else price * (0.95 if direction is Direction.LONG else 1.05)
    tp = tp if tp is not None else price * (1.10 if direction is Direction.LONG else 0.90)
    return Signal(sid, SYM, pd.Timestamp(ts, tz="UTC"), direction, price, stop, tp, 1.0, 10, 0.01, "15m")


async def started(cfg, env, feed=None, **kw):
    e = make_engine(cfg, env, feed, **kw)
    await e.startup()
    return e


@pytest.mark.asyncio
async def test_entry_fills_and_protective_orders_are_verified(cfg, env):
    e = await started(cfg, env)
    rec = e.handle_signal(sig(), weight=1.0)
    assert rec["decision"] == "approved" and rec["order_status"] == "filled" and rec["protected"]
    p = e.ledger.position("breakout", SYM)
    assert p.quantity > 0 and p.stop_loss == pytest.approx(95.0)
    intents = sorted(o.intent.value for o in e.broker.open_orders())
    assert intents == ["stop_loss", "take_profit"]
    with e.store.engine.connect() as c:
        assert c.execute(select(db.positions)).first() is not None
        assert len(c.execute(select(db.orders)).all()) == 3


@pytest.mark.asyncio
async def test_duplicate_signal_is_ignored(cfg, env):
    e = await started(cfg, env)
    e.handle_signal(sig(), weight=1.0)
    assert e.handle_signal(sig(), weight=1.0)["decision"] == "duplicate_ignored"
    with e.store.engine.connect() as c:
        assert len(c.execute(select(db.orders).where(db.orders.c.intent == "entry")).all()) == 1


@pytest.mark.asyncio
async def test_stop_loss_triggers_and_oco_cancels_take_profit(cfg, env):
    feed = FakeFeed()
    e = await started(cfg, env, feed)
    e.handle_signal(sig(), weight=1.0)
    feed.prices[SYM] = 94.0
    await e.step()
    assert not e.ledger.open_positions()
    assert e.ledger.closed_trades[-1].exit_reason == "stop_loss"
    assert not e.broker.open_orders()  # TP cancelled by OCO


@pytest.mark.asyncio
async def test_restart_recovers_state_without_duplicates(cfg, env):
    feed = FakeFeed()
    e1 = await started(cfg, env, feed)
    e1.handle_signal(sig(), weight=1.0)
    e1.handle_signal(sig(ts="2024-01-01 00:30", sid="mean_reversion", direction=Direction.SHORT), weight=1.0)
    feed.prices[SYM] = 101.0
    await e1.step()
    qty_before = {k: p.quantity for k, p in e1.ledger.positions.items() if p.quantity}
    cash_before = e1.ledger.cash
    # simulated crash: no graceful shutdown; a new process opens the same database
    e2 = await started(cfg, env, FakeFeed(price=101.0))
    assert not e2.recovery.fresh_start
    assert {k: p.quantity for k, p in e2.ledger.positions.items() if p.quantity} == qty_before
    assert e2.ledger.cash == pytest.approx(cash_before)
    assert e2.recovery.journal_ok and not e2.risk.state.halted
    assert len(e2.broker.open_orders()) == 4  # 2 positions x (SL + TP), restored not re-placed
    assert e2.handle_signal(sig(), weight=1.0)["decision"] == "duplicate_ignored"
    with e2.store.engine.connect() as c:
        assert len(c.execute(select(db.orders).where(db.orders.c.intent == "entry")).all()) == 2


@pytest.mark.asyncio
async def test_kill_switch_blocks_cancels_flattens_and_persists(cfg, env):
    e = await started(cfg, env)
    e.handle_signal(sig(), weight=1.0)
    with db.transaction(e.store.engine) as c:
        c.execute(db.control_commands.insert().values(mode="PAPER", command="kill_switch", requested_by="tester",
                                                      requested_at=db.utc_now_iso(), status="queued"))
    out = await e.step()
    assert out["commands"][0]["ok"]
    assert not e.ledger.open_positions() and not e.broker.open_orders()
    assert e.risk.state.halted and e.risk.state.kill_switch
    assert e.handle_signal(sig(ts="2024-01-02"), weight=1.0)["decision"] == "rejected"
    # persisted: a restarted engine is still halted
    e2 = await started(cfg, env)
    assert e2.risk.state.halted and e2.risk.state.kill_switch
    # resume requires an explicit, identified human command
    with db.transaction(e2.store.engine) as c:
        c.execute(db.control_commands.insert().values(mode="PAPER", command="resume", requested_by="alice",
                                                      requested_at=db.utc_now_iso(), status="queued"))
    await e2.step()
    assert not e2.risk.state.halted


@pytest.mark.asyncio
async def test_dashboard_halt_written_while_engine_offline_is_enforced(cfg, env):
    e = await started(cfg, env)
    e.handle_signal(sig(), weight=1.0)
    with db.transaction(e.store.engine) as c:  # what the dashboard does when the engine is down
        state = json.loads(c.execute(select(db.risk_state.c.state_json)).scalar() or "{}")
        state.update({"halted": True, "flatten_pending": True, "kill_switch": True})
        c.execute(update(db.risk_state).values(halted=True, kill_switch=True, state_json=json.dumps(state)))
    e2 = await started(cfg, env)
    assert e2.risk.state.halted
    await e2.step()
    assert not e2.ledger.open_positions()


@pytest.mark.asyncio
async def test_stale_market_data_blocks_entries(cfg, env):
    feed = FakeFeed()
    e = await started(cfg, env, feed)
    feed.stale_seconds = 10_000
    await e.step()
    rec = e.handle_signal(sig(), weight=1.0)
    assert rec["decision"] == "rejected" and any("stale" in r for r in rec["reasons"])


@pytest.mark.asyncio
async def test_feed_timeouts_counted_and_repeated_errors_halt(cfg, env):
    feed = FakeFeed()
    e = await started(cfg, env, feed)
    feed.fail_snapshots = 10
    for _ in range(5):
        await e.step()
    assert e.risk.state.halted and "repeated_exchange_errors" in e.risk.state.halt_reason


@pytest.mark.asyncio
async def test_partial_fill_on_thin_book_protects_filled_quantity(cfg, env):
    feed = FakeFeed(depth=50.0)  # 50 units at the touch only
    e = await started(cfg, env, feed)
    rec = e.handle_signal(sig(), weight=1.0)
    p = e.ledger.position("breakout", SYM)
    assert p.quantity == pytest.approx(50.0)
    stops = [o for o in e.broker.open_orders() if o.intent is OrderIntent.STOP_LOSS]
    assert stops and stops[0].quantity == pytest.approx(50.0)
    assert rec["order_status"] == "canceled"  # remainder cancelled


@pytest.mark.asyncio
async def test_rejected_stop_loss_halts_and_closes_position(cfg, env, monkeypatch):
    e = await started(cfg, env)
    real_submit = e.broker.submit

    def submit(order, snapshot=None):
        if order.intent is OrderIntent.STOP_LOSS:
            order.status = OrderStatus.REJECTED
            order.reject_reason = "simulated: stop rejected by exchange"
            return order
        return real_submit(order, snapshot)

    monkeypatch.setattr(e.broker, "submit", submit)
    rec = e.handle_signal(sig(), weight=1.0)
    assert rec["protected"] is False
    assert e.risk.state.halted and "protection_unverified" in e.risk.state.halt_reason
    assert not e.ledger.open_positions()


@pytest.mark.asyncio
async def test_unexpected_position_discrepancy_halts_on_restart(cfg, env):
    e = await started(cfg, env)
    e.handle_signal(sig(), weight=1.0)
    with db.transaction(e.store.engine) as c:  # corrupt state: position table no longer matches the fill journal
        c.execute(update(db.positions).values(quantity=999.0))
    e2 = await started(cfg, env)
    assert not e2.recovery.journal_ok
    assert e2.risk.state.halted and "recovery_state_discrepancy" in e2.risk.state.halt_reason
    with db.transaction(e2.store.engine) as c:
        c.execute(db.control_commands.insert().values(mode="PAPER", command="resume", requested_by="alice",
                                                      requested_at=db.utc_now_iso(), status="queued",
                                                      result_json=json.dumps({"discrepancy_explained": False})))
    out = await e2.step()
    assert not out["commands"][0]["ok"] and e2.risk.state.halted


@pytest.mark.asyncio
async def test_volatility_spike_breaches_daily_limit_and_flattens(cfg, env, monkeypatch):
    feed = FakeFeed()
    e = await started(cfg, env, feed)
    e.handle_signal(sig(stop=98.0), weight=1.0)   # 1% risk / 2.0 stop => 500 units (~50% equity notional)
    await e.step()
    # Isolate the drawdown breaker: remove protective orders and disable re-protection for this test.
    for o in list(e.broker.open_orders()):
        e.broker.cancel(o.client_order_id)
    monkeypatch.setattr(e, "_manage_positions", lambda: None)
    feed.prices[SYM] = 88.0                       # -12% gap => ~-6% equity > 3% daily limit
    await e.step()
    assert e.risk.state.halted and "daily_drawdown" in (e.risk.state.halt_reason or "")
    assert not e.ledger.open_positions()          # flattened in the same step
    assert e.ledger.closed_trades[-1].exit_reason == "flatten"


@pytest.mark.asyncio
async def test_database_failure_keeps_engine_halted(cfg, env, monkeypatch):
    e = await started(cfg, env)

    def broken(_state):
        raise OSError("database is locked")

    monkeypatch.setattr(e.risk.breaker, "_persist_cb", broken)
    e.risk.breaker.database_failure("t", "simulated outage")
    assert e.risk.state.halted
    assert e.handle_signal(sig(), weight=1.0)["decision"] == "rejected"


def test_order_manager_retries_transient_errors_without_duplicates(cfg, env):
    from quant_engine.risk.circuit_breaker import CircuitBreaker, RiskState

    calls = []

    class FlakyBroker:
        def submit(self, order, snapshot=None):
            calls.append(order.client_order_id)
            if len(calls) < 3:
                raise ccxt.RequestTimeout("timeout")
            order.status = OrderStatus.FILLED
            return order

    store = StateStore(db.get_engine(env.database_url), "PAPER")
    om = OrderManager(FlakyBroker(), store, CircuitBreaker(cfg.risk.circuit_breakers, RiskState()), sleep=lambda s: None)
    o = Order("cid1", SYM, Side.BUY, OrderType.MARKET, 1.0, OrderIntent.ENTRY, "s", pd.Timestamp.now(tz="UTC"))
    assert om.submit(o).status is OrderStatus.FILLED
    assert om.submit(o).status is OrderStatus.FILLED  # second call served from cache
    assert calls == ["cid1"] * 3


def test_order_manager_rate_limit_exhaustion_rejects_and_counts(cfg, env):
    from quant_engine.risk.circuit_breaker import CircuitBreaker, RiskState

    class RateLimited:
        def submit(self, order, snapshot=None):
            raise ccxt.RateLimitExceeded("429")

    br = CircuitBreaker(cfg.risk.circuit_breakers, RiskState())
    om = OrderManager(RateLimited(), StateStore(db.get_engine(env.database_url), "PAPER"), br, sleep=lambda s: None)
    o = Order("cid2", SYM, Side.BUY, OrderType.MARKET, 1.0, OrderIntent.ENTRY, "s", pd.Timestamp.now(tz="UTC"))
    assert om.submit(o).status is OrderStatus.REJECTED
    assert br.state.consecutive_errors == 3


@pytest.mark.asyncio
async def test_missing_market_data_rejects_market_order(cfg, env):
    e = make_engine(cfg, env)  # never started: no snapshots
    o = Order("cid3", SYM, Side.BUY, OrderType.MARKET, 1.0, OrderIntent.ENTRY, "s", pd.Timestamp.now(tz="UTC"))
    res = e.broker.submit(o, None)
    assert res.status is OrderStatus.REJECTED and res.reject_reason == "no_market_data"
