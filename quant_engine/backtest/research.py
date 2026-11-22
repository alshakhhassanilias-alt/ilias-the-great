"""End-to-end research pipeline: walk-forward -> statistics -> tournament -> combined
portfolio -> promotion -> Monte Carlo -> frozen final holdout -> reports.

Run via ``python scripts/run_walk_forward.py``.  Everything is seeded and configuration-hashed.
"""

from __future__ import annotations

import logging
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from quant_engine.backtest import reporting as rp
from quant_engine.backtest.benchmarks import buy_and_hold_equity
from quant_engine.backtest.engine import BacktestEngine, StrategyRun
from quant_engine.backtest.metrics import (
    bootstrap_ci,
    daily_returns,
    deflated_sharpe,
    pbo_cscv,
    performance_summary,
    sharpe,
)
from quant_engine.backtest.monte_carlo import MCConfig, run_monte_carlo, summarize
from quant_engine.backtest.walk_forward import (
    WalkForwardRunner,
    Window,
    WindowResult,
    build_windows,
    equity_from_returns,
    log_holdout_access,
    parameter_stability,
    selection_window_for_holdout,
    sensitivity,
    stitch_daily,
    trial_matrix,
)
from quant_engine.config.settings import AppConfig, get_config, get_env
from quant_engine.data.loader import load_market_data
from quant_engine.portfolio.allocator import weight_arrays
from quant_engine.regime.allocation import RegimeAllocator, StrategyAllocationSpec, ValidationStatus
from quant_engine.regime.detector import RegimeDetector, RegimeParams
from quant_engine.strategies.base import MarketData
from quant_engine.strategies.registry import build_strategy
from quant_engine.strategies.tournament import evaluate_promotion, regime_performance, tournament_report

log = logging.getLogger(__name__)
SQRT365 = np.sqrt(365)


# ------------------------------------------------------------------------------ workers
def _wf_worker(args: tuple[str, list[Window]]) -> tuple[str, list[WindowResult]]:
    name, windows = args
    cfg, env = get_config(), get_env()
    md, _ = load_market_data(cfg, env)
    return name, WalkForwardRunner(cfg, md).run_strategy(name, windows)


# ------------------------------------------------------------------------------ helpers
def fit_regimes(cfg: AppConfig, md: MarketData, train_start: pd.Timestamp, train_end: pd.Timestamp,
                until: pd.Timestamp) -> dict[str, pd.DataFrame]:
    rcfg = cfg.strategies.regime
    tf = rcfg.get("timeframe", "4h")
    out = {}
    for s in cfg.research.symbols:
        det = RegimeDetector(RegimeParams.from_config(rcfg))
        df = md.get(s, tf)
        det.fit(df.loc[train_start:train_end])
        warm = pd.Timedelta(days=200)
        out[s] = det.classify(df.loc[train_start - warm:until])
    return out


def trade_returns_for_mc(windows: list[WindowResult]) -> pd.DataFrame:
    rows = []
    for w in windows:
        if w.test_trades.empty:
            continue
        eq = w.test_equity
        st = w.test_stats
        adverse = st["slippage_cost"] / st["traded_notional"] if st.get("traded_notional") else 0.0
        for _, t in w.test_trades.iterrows():
            e0 = float(eq.asof(pd.Timestamp(t["entry_time"]))) if len(eq) else 0.0
            e0 = e0 if np.isfinite(e0) and e0 > 0 else float(eq.iloc[0])
            notional = abs(t["quantity"]) * (t["entry_price"] + t["exit_price"])
            rows.append({"ret": t["pnl"] / e0, "cost_ret": notional * adverse / e0, "fee_ret": t["fees"] / e0})
    return pd.DataFrame(rows, columns=["ret", "cost_ret", "fee_ret"])


def aggregate_strategy(name: str, results: list[WindowResult], n_total_trials: int, cfg: AppConfig,
                       regimes_by_window: dict[int, dict[str, pd.DataFrame]]) -> dict[str, Any]:
    daily = stitch_daily(results)
    stress = stitch_daily(results, "stress_daily")
    eq = equity_from_returns(daily, 1.0)
    trades = pd.concat([r.test_trades.assign(window=r.window.index) for r in results if not r.test_trades.empty],
                       ignore_index=True) if any(not r.test_trades.empty for r in results) else pd.DataFrame(
        columns=["pnl", "symbol", "entry_time", "exit_time", "fees", "quantity", "entry_price", "exit_price"])
    stats_tot = {k: sum(r.test_stats.get(k, 0.0) for r in results) for k in ("fees", "slippage_cost", "funding", "traded_notional")}
    # Costs/turnover are dollar-denominated per window (each window starts at the initial capital).
    summary = performance_summary(eq * cfg.backtest.initial_capital, trades, None, None)
    cap = cfg.backtest.initial_capital
    summary.update({
        "fees": stats_tot["fees"], "slippage_cost": stats_tot["slippage_cost"], "funding": stats_tot["funding"],
        "trading_costs": stats_tot["fees"] + stats_tot["slippage_cost"] + stats_tot["funding"],
        "turnover_annualized": stats_tot["traded_notional"] / cap / max(len(daily) / 365, 1e-9),
        "exposure_time_fraction": float(np.mean([r.test_summary.get("exposure_time_fraction", 0.0) for r in results])),
        "avg_gross_exposure": float(np.mean([r.test_summary.get("avg_gross_exposure", 0.0) for r in results])),
    })
    _sr, lo, hi = bootstrap_ci(daily.to_numpy(), lambda x: sharpe(x), cfg.research.bootstrap_samples, 10, seed=11)
    trials = trial_matrix(results)
    trial_sr = trials.apply(lambda c: c.dropna().mean() / c.dropna().std() if c.dropna().std() > 0 else 0.0).to_numpy()
    # Selection-bias adjustment: the variance of OOS Sharpe across this strategy's grid, with the
    # number of trials = every configuration of every strategy tested in the research programme.
    dsr = deflated_sharpe(daily.to_numpy(), trial_sr)
    dsr_full = deflated_sharpe(daily.to_numpy(), trial_sr, n_trials=n_total_trials)
    pbo = pbo_cscv(trials, 16) if trials.shape[1] >= 2 else {"pbo": float("nan")}
    win_rets = [r.test_summary["net_return"] for r in results]
    summary.update({
        "sharpe_ci_lower": lo, "sharpe_ci_upper": hi, "dsr": dsr_full["dsr"], "dsr_detail": dsr_full,
        "dsr_strategy_grid_only": dsr["dsr"], "pbo": pbo["pbo"], "pbo_detail": pbo,
        "positive_window_fraction": float(np.mean([x > 0 for x in win_rets])) if win_rets else 0.0,
        "n_windows": len(results), "windows_flat_no_selection": sum(r.selected_params is None for r in results),
        "stress_net_return": float((1 + stress).prod() - 1) if len(stress) else 0.0,
        "stress_sharpe": sharpe(stress),
        "oos_days": len(daily),
    })
    # per-asset attribution
    per_asset = {}
    for sym, g in trades.groupby("symbol") if len(trades) else []:
        pnl = g["pnl"].astype(float)
        gl = -pnl[pnl <= 0].sum()
        per_asset[sym] = {"trades": len(g), "net_pnl": float(pnl.sum()),
                          "net_pnl_pct_of_capital_per_window": float(pnl.sum() / cap / max(len(results), 1)),
                          "win_rate": float((pnl > 0).mean()), "profit_factor": float(pnl[pnl > 0].sum() / gl) if gl > 0 else float("inf"),
                          "expectancy": float(pnl.mean()), "fees": float(g["fees"].sum())}
    # regime attribution (regime known at entry, detector fitted on each window's training data)
    reg_perf: dict[str, Any] = {}
    for r in results:
        if r.test_trades.empty:
            continue
        rp_w = regime_performance(r.test_trades, regimes_by_window[r.window.index])
        for k, v in rp_w.items():
            agg = reg_perf.setdefault(k, {"trades": 0, "net_pnl": 0.0})
            agg["trades"] += v["trades"]
            agg["net_pnl"] += v["net_pnl"]
    st = build_strategy(name, cfg)
    windows_table = [{"window": r.window.index, "test_start": str(r.window.test_start.date()),
                      "test_end": str(r.window.test_end.date()), "selected": r.selected_params is not None,
                      "params": {k: r.selected_params[k] for k in st.cfg.param_grid} if r.selected_params else None,
                      "net_return": r.test_summary["net_return"], "sharpe": r.test_summary["sharpe"],
                      "max_drawdown": r.test_summary["max_drawdown"], "trades": r.test_summary["total_trades"],
                      "stress_net_return": r.stress_summary["net_return"],
                      "train_best_sharpe": max((e.sharpe for e in r.train_evals), default=float("nan")),
                      "val_selected_sharpe": max((v.sharpe for v in r.val_evals), default=float("nan")),
                      "note": r.selection_note} for r in results]
    return {"summary": summary, "per_asset": per_asset, "regime_performance": reg_perf,
            "windows": windows_table, "parameter_stability": parameter_stability(results, list(st.cfg.param_grid)),
            "sensitivity": sensitivity(trials), "fitted_last_window": results[-1].fitted if results else {},
            "_daily": daily, "_stress_daily": stress, "_trades": trades}


def combined_window(cfg: AppConfig, md: MarketData, w: Window, selections: dict[str, dict[str, Any] | None],
                    statuses: dict[str, ValidationStatus], require_validation: bool,
                    regimes: dict[str, pd.DataFrame]) -> tuple[dict[str, Any], pd.Series, Any]:
    """Integrated portfolio run on the 15m clock with the real risk manager and circuit breakers."""
    specs = [StrategyAllocationSpec(n, cfg.strategies.strategies[n].max_weight,
                                    cfg.strategies.strategies[n].regime_affinity, statuses.get(n, ValidationStatus.UNVALIDATED))
             for n in selections]
    alloc_cfg = cfg.strategies.allocation
    allocator = RegimeAllocator(specs, alloc_cfg.get("crisis_exposure_multiplier", 0.5),
                                alloc_cfg.get("neutral_exposure_multiplier", 0.75), require_validation,
                                alloc_cfg.get("total_weight_cap", 1.0))
    clock_tf = "15m"
    bars = {s: md.get(s, clock_tf).loc[w.test_start - pd.Timedelta(days=10):w.test_end] for s in cfg.research.symbols}
    eng = BacktestEngine(cfg.backtest, cfg.risk, clock_tf, bars, md.funding, enforce_circuit_breakers=True)
    warr, regime_mix = weight_arrays(allocator, regimes, eng.index, list(selections))
    runs = []
    for name, params in selections.items():
        if params is None:
            continue
        st = build_strategy(name, cfg)
        st.fit(md.slice(w.train_start, w.train_end))
        warm = pd.Timedelta(days=200)
        frames = st.compute(md.slice(w.train_start - warm, w.test_end), params)
        runs.append(StrategyRun(name, st.timeframe, frames, weight=warr[name]))
    res = eng.run(runs, w.test_start, w.test_end)
    summ = performance_summary(res.equity, res.trades, res.gross_exposure, res.stats)
    summ["breaches"] = res.stats["breaches"]
    summ["halted_at_end"] = res.stats["halted_at_end"]
    summ["regime_mix"] = regime_mix.to_dict(orient="records")
    return summ, daily_returns(res.equity), res


# ------------------------------------------------------------------------------ pipeline
def run_research(out_dir: Path, workers: int = 4, strategies: list[str] | None = None) -> dict[str, Any]:
    cfg, env = get_config(), get_env()
    md, data_reports = load_market_data(cfg, env)
    failed = {k: v for k, v in data_reports.items() if not v["passed"]}
    if failed:
        raise RuntimeError(f"data integrity gate failed: {list(failed)}")
    names = strategies or [n for n, s in cfg.strategies.strategies.items() if s.enabled]
    first = max(md.get(s, "1d").index[0] for s in cfg.research.symbols)
    last = min(md.get(s, "15m").index[-1] for s in cfg.research.symbols)
    windows, holdout_start = build_windows(max(pd.Timestamp(cfg.research.start, tz="UTC"), first),
                                           last, cfg.research.walk_forward)
    log.info("research: %d windows, OOS %s..%s, holdout %s..%s", len(windows), windows[0].test_start,
             windows[-1].test_end, holdout_start, last)

    # 1. walk-forward per strategy (parallel processes)
    with ProcessPoolExecutor(max_workers=min(workers, len(names))) as ex:
        wf = dict(ex.map(_wf_worker, [(n, windows) for n in names]))

    # 2. regimes per window (fitted on each window's training data only)
    regimes_by_window = {w.index: fit_regimes(cfg, md, w.train_start, w.train_end, w.test_end) for w in windows}

    # 3. per-strategy aggregation + statistics
    n_total_trials = sum(len(build_strategy(n, cfg).param_grid()) for n in names)
    agg = {n: aggregate_strategy(n, wf[n], n_total_trials, cfg, regimes_by_window) for n in names}
    crit = cfg.research.promotion
    statuses: dict[str, ValidationStatus] = {}
    checks: dict[str, Any] = {}
    for n in names:
        statuses[n], checks[n] = evaluate_promotion(agg[n]["summary"], crit)

    # 4. tournament (correlation / diversification)
    tour = tournament_report({n: agg[n]["_daily"] for n in names})
    if "highly_correlated_pairs" in tour:
        for a, b, rho in tour["highly_correlated_pairs"]:
            weaker = a if agg[a]["summary"]["dsr"] < agg[b]["summary"]["dsr"] else b
            if statuses[weaker] is ValidationStatus.PROMOTED:
                statuses[weaker] = ValidationStatus.UNDER_REVIEW
                checks[weaker]["diversification"] = {"passed": False, "value": rho, "threshold": 0.7}

    # 5. combined portfolios per window (frozen per-window selections)
    combos: dict[str, Any] = {}
    # research_all_strategies: every strategy, regime-weighted (diagnostic only)
    # non_rejected_strategies: excludes REJECTED strategies (candidate portfolio, still NOT qualified)
    # promoted_only: the only deployable portfolio (exists only if something was promoted)
    non_rejected = [n for n in names if statuses[n] is not ValidationStatus.REJECTED]
    variants: dict[str, tuple[bool, list[str]]] = {"research_all_strategies": (False, names)}
    if non_rejected and len(non_rejected) < len(names):
        variants["non_rejected_strategies"] = (False, non_rejected)
    if any(s is ValidationStatus.PROMOTED for s in statuses.values()):
        variants["promoted_only"] = (True, names)
    for label, (req, members) in variants.items():
        rows, dailies, all_trades = [], [], []
        for w in windows:
            sel = {n: next(r.selected_params for r in wf[n] if r.window.index == w.index) for n in members}
            summ, d, res = combined_window(cfg, md, w, sel, statuses, req, regimes_by_window[w.index])
            rows.append({"window": w.index, "test_start": str(w.test_start.date()), **{k: summ[k] for k in (
                "net_return", "sharpe", "max_drawdown", "total_trades")}, "breaches": summ["breaches"]})
            dailies.append(d)
            if not res.trades.empty:
                all_trades.append(res.trades.assign(window=w.index))
        daily = pd.concat(dailies)
        daily = daily[~daily.index.duplicated()].sort_index()
        trades = pd.concat(all_trades, ignore_index=True) if all_trades else pd.DataFrame(columns=["pnl"])
        eq = equity_from_returns(daily, cfg.backtest.initial_capital)
        s = performance_summary(eq, trades)
        _sr, lo, hi = bootstrap_ci(daily.to_numpy(), lambda x: sharpe(x), cfg.research.bootstrap_samples, 10, seed=12)
        s.update({"sharpe_ci_lower": lo, "sharpe_ci_upper": hi,
                  "positive_window_fraction": float(np.mean([r["net_return"] > 0 for r in rows]))})
        combos[label] = {"summary": s, "windows": rows, "_daily": daily, "_trades": trades}

    # 6. benchmarks over the stitched OOS span and per window
    oos_start, oos_end = windows[0].test_start, windows[-1].test_end
    closes = {s: md.get(s, "1d")["close"] for s in cfg.research.symbols}
    bench_curves, bench_summ = {}, {}
    for sym, c in closes.items():
        parts = [daily_returns(buy_and_hold_equity(c, w.test_start, w.test_end, cfg.backtest.costs, sym)) for w in windows]
        bd = pd.concat(parts)
        bd = bd[~bd.index.duplicated()].sort_index()
        key = f"buy_hold_{sym.split('/')[0]}"
        bench_curves[key] = equity_from_returns(bd)
        bench_summ[key] = performance_summary(bench_curves[key], pd.DataFrame(columns=["pnl"]))
    bench_summ["cash"] = {"net_return": 0.0, "sharpe": 0.0, "max_drawdown": 0.0, "annualized_return": 0.0}
    bench_windows = {f"buy_hold_{s.split('/')[0]}": [float(buy_and_hold_equity(c, w.test_start, w.test_end, cfg.backtest.costs, s).pipe(
        lambda e: e.iloc[-1] / e.iloc[0] - 1)) for w in windows] for s, c in closes.items()}

    # 7. Monte Carlo on the qualified portfolio (or, if none qualifies, on the research portfolio, labelled)
    qualified = "promoted_only" in combos
    mc_label = "promoted_only" if qualified else (
        "non_rejected_strategies" if "non_rejected_strategies" in combos else "research_all_strategies")
    mc_members = {"promoted_only": [n for n in names if statuses[n] is ValidationStatus.PROMOTED],
                  "non_rejected_strategies": non_rejected}.get(mc_label, names)
    mc_windows_trades = [trade_returns_for_mc(wf[n]) for n in mc_members]
    mc_trades = pd.concat(mc_windows_trades, ignore_index=True) if mc_windows_trades else pd.DataFrame(columns=["ret", "cost_ret", "fee_ret"])
    if len(mc_members) > 1:
        # Standalone sleeves trade at full risk; in the portfolio each gets roughly 1/k of the risk budget.
        mc_trades = mc_trades * (1.0 / len(mc_members))
    mc_cfg = MCConfig(n_sims=cfg.research.monte_carlo_simulations, block=cfg.research.monte_carlo_block_size,
                      daily_dd_limit=cfg.risk.circuit_breakers.daily_drawdown_limit,
                      total_dd_limit=cfg.risk.circuit_breakers.max_total_drawdown,
                      horizon_days=365, horizon_trades=int(len(mc_trades) * 365 / max(len(combos[mc_label]["_daily"]), 1)) or None)
    mc = run_monte_carlo(combos[mc_label]["_daily"], mc_trades, mc_cfg)

    # 8. final holdout - evaluated ONCE with frozen decisions
    hw = selection_window_for_holdout(holdout_start, cfg.research.walk_forward)
    hw = Window(-1, hw.train_start, hw.train_end, hw.val_start, hw.val_end, holdout_start, last)
    runner = WalkForwardRunner(cfg, md)
    holdout: dict[str, Any] = {}
    hold_sel: dict[str, dict[str, Any] | None] = {}
    for n in names:
        r = runner.run_window(n, hw)
        hold_sel[n] = r.selected_params
        holdout[n] = {"selected_params": r.selected_params, "note": r.selection_note, **{k: r.test_summary[k] for k in (
            "net_return", "sharpe", "max_drawdown", "total_trades", "profit_factor", "win_rate")}}
    reg_h = fit_regimes(cfg, md, hw.train_start, hw.train_end, last)
    for label, (_req, members) in variants.items():
        if label == "promoted_only":
            continue
        hsumm, _, _ = combined_window(cfg, md, hw, {n: hold_sel[n] for n in members}, statuses, False, reg_h)
        holdout[f"portfolio:{label}"] = {k: hsumm[k] for k in ("net_return", "sharpe", "max_drawdown", "total_trades")}
    if "promoted_only" in variants:
        hsumm, _, _ = combined_window(cfg, md, hw, hold_sel, statuses, True, reg_h)
        holdout["portfolio:promoted_only"] = {k: hsumm[k] for k in ("net_return", "sharpe", "max_drawdown", "total_trades")}
    hold_bench = {f"buy_hold_{s.split('/')[0]}": float(buy_and_hold_equity(c, holdout_start, last, cfg.backtest.costs, s).pipe(
        lambda e: e.iloc[-1] / e.iloc[0] - 1)) for s, c in closes.items()}
    out_dir.mkdir(parents=True, exist_ok=True)
    access_n = log_holdout_access(out_dir / "holdout_access_log.json", "scripts/run_walk_forward.py",
                                  "final frozen evaluation", {"config_hash": cfg.version_hash(),
                                                              "holdout": [str(holdout_start), str(last)]})
    # holdout confirmation for promotion
    for n in names:
        if statuses[n] is ValidationStatus.PROMOTED:
            h = holdout[n]
            if not (h["net_return"] > 0 and h["max_drawdown"] <= crit.max_oos_drawdown):
                statuses[n] = ValidationStatus.UNDER_REVIEW
                checks[n]["holdout"] = {"passed": False, "value": h["net_return"], "threshold": 0.0}
            else:
                checks[n]["holdout"] = {"passed": True, "value": h["net_return"], "threshold": 0.0}

    result = {
        "generated_at": pd.Timestamp.now(tz="UTC").isoformat(), "config_hash": cfg.version_hash(),
        "data": {"first": str(first), "last": str(last), "oos_start": str(oos_start), "oos_end": str(oos_end),
                 "holdout_start": str(holdout_start), "holdout_end": str(last),
                 "oos_years": float((oos_end - oos_start) / pd.Timedelta(days=365)),
                 "integrity": {k: {kk: v[kk] for kk in ("rows", "completeness", "missing_bars", "passed")} for k, v in data_reports.items()}},
        "windows": [w.to_dict() for w in windows],
        "strategies": {n: {k: v for k, v in agg[n].items() if not k.startswith("_")} for n in names},
        "promotion": {n: {"status": statuses[n].value, "checks": checks[n]} for n in names},
        "tournament": {k: v for k, v in tour.items() if not k.startswith("_")},
        "combined": {k: {kk: vv for kk, vv in v.items() if not kk.startswith("_")} for k, v in combos.items()},
        "benchmarks": {"stitched_oos": bench_summ, "per_window": bench_windows},
        "monte_carlo": {"portfolio": mc_label, "members": mc_members, "qualified": qualified, "summary": summarize(mc),
                        "config": mc["config"]},
        "holdout": {"results": holdout, "benchmarks": hold_bench, "access_count": access_n,
                    "window": hw.to_dict()},
        "n_total_trials": n_total_trials,
        "deployable": [n for n in names if statuses[n] is ValidationStatus.PROMOTED],
    }
    rp.write_json(out_dir / "research_results.json", result)
    _write_artifacts(out_dir, cfg, names, agg, combos, bench_curves, tour, mc, result, windows, bench_windows)
    return result


def _write_artifacts(out: Path, cfg: AppConfig, names: list[str], agg: dict[str, Any], combos: dict[str, Any],
                     bench: dict[str, pd.Series], tour: dict[str, Any], mc: dict[str, Any], result: dict[str, Any],
                     windows: list[Window], bench_windows: dict[str, list[float]]) -> None:
    charts = out / "charts"
    curves = {n: equity_from_returns(agg[n]["_daily"]) for n in names}
    for k, v in combos.items():
        curves[f"portfolio:{k}"] = equity_from_returns(v["_daily"])
    curves.update(bench)
    rp.save_figure(rp.equity_chart(curves, "Stitched walk-forward OOS equity (net of modelled costs)"), charts, "oos_equity")
    rp.save_figure(rp.drawdown_chart({k: v for k, v in curves.items() if not k.startswith("buy_hold")},
                                     "OOS underwater (drawdown) curves"), charts, "oos_drawdown")
    rp.save_figure(rp.rolling_sharpe_chart({n: agg[n]["_daily"] for n in names} |
                                           {f"portfolio:{k}": v["_daily"] for k, v in combos.items()}, 90,
                                           "Rolling 90-day Sharpe (OOS)"), charts, "rolling_sharpe")
    if "correlation" in tour:
        rp.save_figure(rp.heatmap(pd.DataFrame(tour["correlation"]), "Strategy OOS daily-return correlation"),
                       charts, "strategy_correlation", 800, 650)
        rp.save_figure(rp.heatmap(pd.DataFrame(tour["drawdown_correlation"]), "Strategy drawdown correlation"),
                       charts, "drawdown_correlation", 800, 650)
        rp.save_figure(rp.rolling_corr_chart(tour["_rolling"], "Rolling 90-day strategy correlation"), charts,
                       "rolling_correlation")
    wt = pd.DataFrame({n: [r["net_return"] for r in agg[n]["windows"]] for n in names},
                      index=[w.test_start.date() for w in windows])
    for k, v in bench_windows.items():
        wt[k] = v
    rp.save_figure(rp.window_bar_chart(wt, "Net return per walk-forward OOS window"), charts, "window_returns", 1400, 600)
    rp.save_figure(rp.mc_distribution_chart(mc, f"Monte Carlo ({mc['config']['n_sims']} paths/scenario) — {result['monte_carlo']['portfolio']}"),
                   charts, "monte_carlo", 1400, 650)
    # data exports for the dashboard
    exp = out / "series"
    exp.mkdir(parents=True, exist_ok=True)
    pd.DataFrame({k: v for k, v in curves.items()}).to_csv(exp / "oos_equity_curves.csv")
    mc_hist = {name: {"terminal": np.round(sc["_terminal"], 5).tolist(), "max_drawdown": np.round(sc["_mdd"], 5).tolist()}
               for name, sc in mc["scenarios"].items()}
    rp.write_json(exp / "monte_carlo_paths_summary.json", {"portfolio": result["monte_carlo"]["portfolio"]})
    (exp / "monte_carlo_distributions.json").write_text(__import__("json").dumps(mc_hist))
    from quant_engine.backtest.report_markdown import write_markdown_reports

    write_markdown_reports(out, result)
