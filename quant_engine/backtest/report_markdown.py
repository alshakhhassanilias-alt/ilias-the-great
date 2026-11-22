"""Markdown research reports generated from ``research_results.json`` content."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from quant_engine.backtest.reporting import md_table

PCT = "{:.2%}"
METRIC_ROWS = [
    ("net_return", PCT), ("annualized_return", PCT), ("annualized_volatility", PCT), ("sharpe", "{:.2f}"),
    ("sharpe_ci_lower", "{:.2f}"), ("sharpe_ci_upper", "{:.2f}"), ("sortino", "{:.2f}"), ("calmar", "{:.2f}"),
    ("max_drawdown", PCT), ("average_drawdown", PCT), ("win_rate", PCT), ("profit_factor", "{:.2f}"),
    ("avg_win", "{:,.0f}"), ("avg_loss", "{:,.0f}"), ("expectancy", "{:,.0f}"), ("total_trades", "{}"),
    ("turnover_annualized", "{:.1f}x"), ("exposure_time_fraction", PCT), ("avg_gross_exposure", "{:.2f}"),
    ("avg_holding_hours", "{:.1f}"), ("trading_costs", "{:,.0f}"), ("fees", "{:,.0f}"), ("slippage_cost", "{:,.0f}"),
    ("funding", "{:,.0f}"), ("recovery_factor", "{:.2f}"), ("dsr", "{:.3f}"), ("pbo", "{:.3f}"),
    ("positive_window_fraction", PCT), ("stress_net_return", PCT), ("oos_days", "{}"),
]


def _fmt(v: Any, f: str) -> str:
    if v is None:
        return "n/a"
    try:
        return f.format(v)
    except (ValueError, TypeError):
        return str(v)


def write_markdown_reports(out: Path, r: dict[str, Any]) -> None:
    names = list(r["strategies"])
    d = r["data"]
    L: list[str] = []
    L.append("# Walk-Forward Out-of-Sample Performance Report\n")
    L.append(f"Generated {r['generated_at']} · config hash `{r['config_hash']}` · "
             f"total configurations tested across all strategies: **{r['n_total_trials']}**\n")
    L.append("> All figures are **out-of-sample**, net of modelled fees (0.10% taker/maker assumption), spread, "
             "volatility/impact slippage and funding. Each walk-forward window starts from a flat book with the same "
             "capital; windows are stitched by compounding daily returns. Annualisation uses 365 days. These are "
             "simulations under stated assumptions, not predictions.\n")
    L.append("## Data and windows\n")
    L.append(f"* Data: {d['first']} → {d['last']} (Binance spot OHLCV via data-api.binance.vision; funding from Binance "
             f"USD-M archives + OKX for the current month).\n* Stitched OOS span: {d['oos_start']} → {d['oos_end']} "
             f"(**{d['oos_years']:.2f} years**, {len(r['windows'])} windows).\n* Final holdout (untouched until decisions "
             f"were frozen): {d['holdout_start']} → {d['holdout_end']}; evaluated {r['holdout']['access_count']} time(s).\n")
    L.append("## Promotion decisions\n")
    rows = []
    for n in names:
        p = r["promotion"][n]
        failed = [k for k, v in p["checks"].items() if not v["passed"]]
        rows.append({"strategy": n, "status": p["status"].upper(), "failed checks": ", ".join(failed) or "none"})
    L.append(md_table(rows, ["strategy", "status", "failed checks"]))
    dep = r["deployable"]
    L.append(f"\n**Deployable (PROMOTED) strategies: {', '.join(dep) if dep else 'NONE — no validated deployable strategy exists.'}**\n")

    L.append("\n## Strategy OOS metrics (stitched)\n")
    head = "| metric | " + " | ".join(names) + " |\n|---|" + "---|" * len(names) + "\n"
    body = "".join(f"| {m} | " + " | ".join(_fmt(r["strategies"][n]["summary"].get(m), f) for n in names) + " |\n"
                   for m, f in METRIC_ROWS)
    L.append(head + body)

    L.append("\n## Combined portfolio (integrated 15m simulation, regime allocator, circuit breakers enforced)\n")
    for k, v in r["combined"].items():
        s = v["summary"]
        L.append(f"**{k}** — net {s['net_return']:.2%}, CAGR {s['annualized_return']:.2%}, Sharpe {s['sharpe']:.2f} "
                 f"(95% CI {s['sharpe_ci_lower']:.2f}…{s['sharpe_ci_upper']:.2f}), max DD {s['max_drawdown']:.2%}, "
                 f"trades {s['total_trades']}, positive windows {s['positive_window_fraction']:.0%}.\n")
        L.append(md_table([{**w, "breaches": str(w["breaches"] or "-")} for w in v["windows"]],
                          ["window", "test_start", "net_return", "sharpe", "max_drawdown", "total_trades", "breaches"],
                          {"net_return": PCT, "max_drawdown": PCT, "sharpe": "{:.2f}"}))

    L.append("\n## Benchmarks over the same stitched OOS windows\n")
    brow = [{"benchmark": k, **{m: v.get(m) for m in ("net_return", "annualized_return", "sharpe", "max_drawdown")}}
            for k, v in r["benchmarks"]["stitched_oos"].items()]
    L.append(md_table(brow, ["benchmark", "net_return", "annualized_return", "sharpe", "max_drawdown"],
                      {"net_return": PCT, "annualized_return": PCT, "max_drawdown": PCT, "sharpe": "{:.2f}"}))

    for n in names:
        S = r["strategies"][n]
        L.append(f"\n## {n}: per-window results\n")
        L.append(md_table(S["windows"], ["window", "test_start", "test_end", "selected", "net_return", "sharpe",
                                          "max_drawdown", "trades", "stress_net_return", "train_best_sharpe",
                                          "val_selected_sharpe"],
                          {"net_return": PCT, "max_drawdown": PCT, "stress_net_return": PCT, "sharpe": "{:.2f}",
                           "train_best_sharpe": "{:.2f}", "val_selected_sharpe": "{:.2f}"}))
        if S["per_asset"]:
            L.append(f"\n**{n} per-asset attribution (OOS trades)**\n")
            L.append(md_table([{"asset": a, **v} for a, v in S["per_asset"].items()],
                              ["asset", "trades", "net_pnl", "win_rate", "profit_factor", "expectancy", "fees"],
                              {"net_pnl": "{:,.0f}", "win_rate": PCT, "profit_factor": "{:.2f}",
                               "expectancy": "{:,.0f}", "fees": "{:,.0f}"}))
        if S["regime_performance"]:
            L.append(f"\n**{n} OOS PnL by regime at entry**\n")
            L.append(md_table([{"regime": k, **v} for k, v in S["regime_performance"].items()],
                              ["regime", "trades", "net_pnl"], {"net_pnl": "{:,.0f}"}))
        ps = S["parameter_stability"]
        sens = S["sensitivity"]
        L.append(f"\nParameter stability: selected in {ps['windows_with_selection']}/{len(S['windows'])} windows, "
                 f"churn rate {ps['churn_rate']:.0%}; selection frequency `{ps['selection_frequency']}`.  "
                 f"Grid sensitivity: median OOS Sharpe across all configs {sens.get('median', float('nan')):.2f}, "
                 f"fraction of configs with positive OOS Sharpe {sens.get('fraction_positive', float('nan')):.0%}.\n")
        chk = r["promotion"][n]["checks"]
        L.append(md_table([{"check": k, **v} for k, v in chk.items()], ["check", "passed", "value", "threshold"]))

    L.append("\n## Final holdout (single frozen evaluation)\n")
    hr = [{"strategy": k, **{m: v.get(m) for m in ("net_return", "sharpe", "max_drawdown", "total_trades")}}
          for k, v in r["holdout"]["results"].items()]
    L.append(md_table(hr, ["strategy", "net_return", "sharpe", "max_drawdown", "total_trades"],
                      {"net_return": PCT, "max_drawdown": PCT, "sharpe": "{:.2f}"}))
    L.append("Benchmarks over the holdout: " + ", ".join(f"{k} {v:.2%}" for k, v in r["holdout"]["benchmarks"].items()) + "\n")
    L.append("\n## Charts\n\n![equity](charts/oos_equity.png)\n![drawdown](charts/oos_drawdown.png)\n"
             "![rolling sharpe](charts/rolling_sharpe.png)\n![windows](charts/window_returns.png)\n")
    (out / "OOS_REPORT.md").write_text("\n".join(L))

    # ---------------- Monte Carlo
    mc = r["monte_carlo"]
    M = ["# Monte Carlo Stress-Test Report\n",
         f"Portfolio simulated: **{mc['portfolio']}** = {', '.join(mc.get('members', []))} "
         f"({'QUALIFIED' if mc['qualified'] else 'NOT QUALIFIED — no strategy was promoted; simulated to characterise risk only'}).\n",
         f"Paths per scenario: {mc['config']['n_sims']}, seed {mc['config']['seed']}, horizon ≈ 1 year "
         f"({mc['config']['horizon_days']} days / {mc['config']['horizon_trades']} trades). Ruin = equity ≤ "
         f"{mc['config']['ruin_level']:.0%} of start; daily breach = a day (or trade) losing ≥ {mc['config']['daily_dd_limit']:.0%}; "
         f"total breach = drawdown ≥ {mc['config']['total_dd_limit']:.0%}.\n",
         "> Monte Carlo resamples *historical OOS* outcomes under explicit assumptions. It does not guarantee future results.\n"]
    rows = [{"scenario": k, **v} for k, v in mc["summary"].items()]
    M.append(md_table(rows, ["scenario", "terminal_equity_median", "terminal_equity_p05", "terminal_equity_p95",
                             "max_drawdown_median", "max_drawdown_p95", "prob_daily_dd_breach", "prob_total_dd_breach",
                             "prob_ruin", "prob_loss"],
                      {"terminal_equity_median": "{:.3f}", "terminal_equity_p05": "{:.3f}", "terminal_equity_p95": "{:.3f}",
                       "max_drawdown_median": PCT, "max_drawdown_p95": PCT, "prob_daily_dd_breach": PCT,
                       "prob_total_dd_breach": PCT, "prob_ruin": PCT, "prob_loss": PCT}))
    M.append("\nScenario definitions:\n" + "".join(f"* **{k}** — {v['description']}\n" for k, v in mc["summary"].items()))
    M.append("\n![monte carlo](charts/monte_carlo.png)\n")
    (out / "MONTE_CARLO_REPORT.md").write_text("\n".join(M))

    # ---------------- correlation
    t = r["tournament"]
    C = ["# Strategy Correlation & Diversification Report\n",
         "Correlations are computed on stitched OOS daily returns (days with no position count as 0 return). "
         "Different indicators do **not** imply low correlation; this report measures it.\n"]
    if "correlation" in t:
        for key, title in (("correlation", "Daily return correlation"), ("drawdown_correlation", "Drawdown correlation"),
                           ("downside_correlation", "Correlation on down days of the equal-weight portfolio")):
            m = t[key]
            cols = list(m)
            C.append(f"\n### {title}\n")
            C.append("| | " + " | ".join(cols) + " |\n|---|" + "---|" * len(cols))
            for a in cols:
                C.append(f"| {a} | " + " | ".join(_fmt(m[a].get(b), "{:.2f}") for b in cols) + " |")
        C.append("\n### Risk contribution (equal weights)\n")
        C.append(md_table([{"strategy": k, "share_of_variance": v} for k, v in t["risk_contribution_equal_weight"].items()],
                          ["strategy", "share_of_variance"], {"share_of_variance": PCT}))
        C.append("\n### Rolling 90-day correlation summary\n")
        C.append(md_table([{"pair": k, **v} for k, v in t["rolling_correlation_summary"].items()],
                          ["pair", "mean", "min", "max", "last"]))
        C.append(f"\nHighly correlated pairs (ρ > 0.7): {t['highly_correlated_pairs'] or 'none'}\n")
        C.append("\n![corr](charts/strategy_correlation.png)\n![ddcorr](charts/drawdown_correlation.png)\n"
                 "![rolling](charts/rolling_correlation.png)\n")
    (out / "STRATEGY_CORRELATION_REPORT.md").write_text("\n".join(C))
