#!/usr/bin/env python
"""Run the paper-trading engine against live public market data (PAPER is the default and
the fail-closed fallback; LIVE needs explicit env flags, the acknowledgement phrase and a
passed deployment gate — it is never selected automatically).

Usage:
    python scripts/run_paper_trading.py [--duration 60] [--poll 5] [--diagnostic-probe]
                                        [--with-dashboard] [--allow-rejected-in-paper]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import signal

import _bootstrap  # noqa: F401

from quant_engine.config.settings import get_config, get_env
from quant_engine.execution.bootstrap import build_engine
from quant_engine.monitoring.logging import setup_logging


async def main_async(args: argparse.Namespace) -> dict:
    cfg, env = get_config(), get_env()
    engine = build_engine(cfg, env, diagnostic_probe=args.diagnostic_probe,
                          allow_rejected_in_paper=args.allow_rejected_in_paper,
                          probe_hold_seconds=args.probe_hold_seconds)
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, engine.stop)
    server_task = None
    if args.with_dashboard:
        from run_dashboard import build_server

        server = build_server(cfg, env, engine.mode)
        server_task = asyncio.create_task(server.serve())
    rep = await engine.startup()
    print(json.dumps({"event": "startup", "mode": engine.mode.value, "recovery": rep.__dict__,
                      "strategies": {s.strategy_id: engine.statuses.get(s.strategy_id, "unvalidated") for s in engine.strategies},
                      "halted": engine.risk.state.halted}, default=str))
    try:
        await engine.run(duration_s=args.duration, poll_seconds=args.poll)
    finally:
        await engine.feed.close()
        if server_task:
            server.should_exit = True
            await server_task
    summary = {
        "event": "shutdown", "mode": engine.mode.value, "steps": engine.step_count,
        "equity": engine.equity(), "open_positions": [(p.strategy_id, p.symbol, p.quantity) for p in engine.ledger.open_positions()],
        "open_orders": len(engine.broker.open_orders()), "decisions": engine.decisions[-20:],
        "probe": engine._probe_state, "halted": engine.risk.state.halted, "metrics": engine.metrics.summary(),
        "regimes": engine.regimes, "health": engine.last_health.to_dict() if engine.last_health else None,
    }
    print(json.dumps(summary, default=str, indent=1))
    return summary


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--duration", type=float, default=None, help="seconds to run (default: until SIGINT)")
    ap.add_argument("--poll", type=float, default=5.0)
    ap.add_argument("--diagnostic-probe", action="store_true",
                    help="place one tiny labelled probe trade to exercise the order path (smoke tests)")
    ap.add_argument("--probe-hold-seconds", type=float, default=20.0)
    ap.add_argument("--allow-rejected-in-paper", action="store_true")
    ap.add_argument("--with-dashboard", action="store_true")
    args = ap.parse_args()
    setup_logging("paper_trading")
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
