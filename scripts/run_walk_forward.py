#!/usr/bin/env python
"""Run the full walk-forward research pipeline and write reports to artifacts/research/.

Usage:
    python scripts/run_walk_forward.py [--workers 4] [--strategies breakout pairs_rotation]
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import _bootstrap  # noqa: F401

from quant_engine.backtest.research import run_research
from quant_engine.config.settings import get_env
from quant_engine.monitoring.logging import setup_logging


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--strategies", nargs="*", default=None)
    ap.add_argument("--out", default=str(Path(get_env().artifacts_dir) / "research"))
    args = ap.parse_args()
    setup_logging("walk_forward")
    t0 = time.time()
    res = run_research(Path(args.out), args.workers, args.strategies)
    print(json.dumps({
        "elapsed_s": round(time.time() - t0, 1),
        "windows": len(res["windows"]),
        "oos": [res["data"]["oos_start"], res["data"]["oos_end"]],
        "promotion": {k: v["status"] for k, v in res["promotion"].items()},
        "deployable": res["deployable"] or "NONE",
        "strategies": {k: {m: round(v["summary"][m], 4) for m in ("net_return", "sharpe", "max_drawdown", "dsr", "pbo")}
                       for k, v in res["strategies"].items()},
        "combined": {k: {m: round(v["summary"][m], 4) for m in ("net_return", "sharpe", "max_drawdown")}
                     for k, v in res["combined"].items()},
    }, indent=1, default=str))


if __name__ == "__main__":
    main()
