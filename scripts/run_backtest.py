#!/usr/bin/env python
"""Single (non-walk-forward) backtest of one strategy with default or given parameters.

This is an exploratory tool: its results are IN-SAMPLE for any period used to design the
strategy.  Use scripts/run_walk_forward.py for validation.

Usage:
    python scripts/run_backtest.py --strategy breakout --start 2023-01-01 --end 2023-12-31 [--param donchian=20]
"""

from __future__ import annotations

import argparse
import json

import _bootstrap  # noqa: F401
import pandas as pd
import yaml

from quant_engine.backtest.engine import BacktestEngine, StrategyRun
from quant_engine.backtest.metrics import performance_summary
from quant_engine.config.settings import get_config, get_env
from quant_engine.data.loader import load_market_data
from quant_engine.strategies.registry import build_strategy


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strategy", required=True)
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", required=True)
    ap.add_argument("--param", action="append", default=[], help="key=value (YAML-parsed)")
    ap.add_argument("--cost-multiplier", type=float, default=1.0)
    ap.add_argument("--enforce-circuit-breakers", action="store_true")
    args = ap.parse_args()
    cfg, env = get_config(), get_env()
    md, _ = load_market_data(cfg, env)
    params = {k: yaml.safe_load(v) for k, v in (p.split("=", 1) for p in args.param)}
    st = build_strategy(args.strategy, cfg, params)
    start, end = pd.Timestamp(args.start, tz="UTC"), pd.Timestamp(args.end, tz="UTC")
    st.fit(md.slice(start - pd.DateOffset(months=12), start))
    frames = st.compute(md.slice(start - pd.Timedelta(days=300), end))
    eng = BacktestEngine(cfg.backtest, cfg.risk, st.timeframe, {s: md.get(s, st.timeframe) for s in st.symbols},
                         md.funding, enforce_circuit_breakers=args.enforce_circuit_breakers,
                         cost_multiplier=args.cost_multiplier, slippage_multiplier=args.cost_multiplier)
    res = eng.run([StrategyRun(st.strategy_id, st.timeframe, frames)], start, end)
    s = performance_summary(res.equity, res.trades, res.gross_exposure, res.stats)
    print(json.dumps({"warning": "exploratory single-period backtest; not out-of-sample validation",
                      "params": st.params, "summary": s, "stats": res.stats}, indent=1, default=str))


if __name__ == "__main__":
    main()
