#!/usr/bin/env python
"""Re-render research charts (HTML + PNG) from saved series and results — no recomputation, no holdout access."""

from __future__ import annotations

import json
from pathlib import Path

import _bootstrap  # noqa: F401
import numpy as np
import pandas as pd

from quant_engine.backtest import reporting as rp
from quant_engine.config.settings import get_env


def main() -> None:
    art = Path(get_env().artifacts_dir) / "research"
    res = json.loads((art / "research_results.json").read_text())
    curves = pd.read_csv(art / "series" / "oos_equity_curves.csv", index_col=0, parse_dates=True)
    charts = art / "charts"
    cur = {c: curves[c].dropna() for c in curves.columns}
    rp.save_figure(rp.equity_chart(cur, "Stitched walk-forward OOS equity (net of modelled costs)"), charts, "oos_equity")
    rp.save_figure(
        rp.drawdown_chart({k: v for k, v in cur.items() if not k.startswith("buy_hold")}, "OOS underwater (drawdown) curves"),
        charts,
        "oos_drawdown",
    )
    daily = {k: v.resample("1D").last().pct_change().dropna() for k, v in cur.items() if not k.startswith("buy_hold")}
    rp.save_figure(rp.rolling_sharpe_chart(daily, 90, "Rolling 90-day Sharpe (OOS)"), charts, "rolling_sharpe")
    t = res["tournament"]
    rp.save_figure(
        rp.heatmap(pd.DataFrame(t["correlation"]), "Strategy OOS daily-return correlation"),
        charts,
        "strategy_correlation",
        800,
        650,
    )
    rp.save_figure(
        rp.heatmap(pd.DataFrame(t["drawdown_correlation"]), "Strategy drawdown correlation"),
        charts,
        "drawdown_correlation",
        800,
        650,
    )
    strat = pd.DataFrame({k: v for k, v in daily.items() if not k.startswith("portfolio") and k != "cash"})
    roll = {
        f"{a}|{b}": strat[a].rolling(90, min_periods=45).corr(strat[b])
        for i, a in enumerate(strat.columns)
        for b in strat.columns[i + 1 :]
    }
    rp.save_figure(rp.rolling_corr_chart(roll, "Rolling 90-day strategy correlation"), charts, "rolling_correlation")
    idx = [w["test_start"] for w in next(iter(res["strategies"].values()))["windows"]]
    wt = pd.DataFrame({n: [w["net_return"] for w in s["windows"]] for n, s in res["strategies"].items()}, index=idx)
    for k, v in res["benchmarks"]["per_window"].items():
        wt[k] = v
    rp.save_figure(rp.window_bar_chart(wt, "Net return per walk-forward OOS window"), charts, "window_returns", 1400, 600)
    dist = json.loads((art / "series" / "monte_carlo_distributions.json").read_text())
    mc = {
        "config": res["monte_carlo"]["config"],
        "scenarios": {k: {"_terminal": np.array(v["terminal"]), "_mdd": np.array(v["max_drawdown"])} for k, v in dist.items()},
    }
    rp.save_figure(
        rp.mc_distribution_chart(
            mc,
            f"Monte Carlo ({mc['config']['n_sims']} paths/scenario) — {res['monte_carlo']['portfolio']} (NOT QUALIFIED)"
            if not res["monte_carlo"]["qualified"]
            else "Monte Carlo",
        ),
        charts,
        "monte_carlo",
        1400,
        650,
    )
    print(sorted(p.name for p in charts.glob("*.png")))


if __name__ == "__main__":
    main()
