"""Monte Carlo stress testing.

Inputs are *out-of-sample* results only: stitched OOS daily returns and OOS trades
(with per-trade return on equity and traded notional).  Outputs are distributions under
explicitly stated assumptions — they are not forecasts or guarantees.

Scenarios (each ``n_sims`` paths, seeded):

1. ``trade_bootstrap``      i.i.d. resampling of trade returns
2. ``block_bootstrap``      stationary block bootstrap of daily returns (serial dependence kept)
3. ``trade_shuffle``        random permutation of the realised trade sequence
4. ``consecutive_losses``   trade bootstrap with an injected streak of the worst observed losses
5. ``slippage_x3``          trade bootstrap with 3x the modelled slippage+spread charged per trade
6. ``fees_x2``              trade bootstrap with fees doubled
7. ``volatility_shock``     block bootstrap with 1.75x dispersion in randomly placed 30-day blocks
8. ``liquidity_crunch``     trade bootstrap with +25 bps extra cost per side on 20% of trades
9. ``gap_risk``             trade bootstrap where 3% of losing trades gap to 3x their loss

Definitions: *daily drawdown breach* = any simulated day with return <= -daily limit (or,
for trade paths, a single trade loss of that size); *total drawdown breach* = peak-to-trough
>= total limit; *ruin* = equity falling below ``ruin_level`` (default 50% of initial capital).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from quant_engine.backtest.metrics import stationary_bootstrap_indices


@dataclass
class MCConfig:
    n_sims: int = 2000
    block: int = 10
    seed: int = 20240601
    daily_dd_limit: float = 0.03
    total_dd_limit: float = 0.10
    ruin_level: float = 0.5
    horizon_days: int | None = None
    horizon_trades: int | None = None


def _path_stats(paths: np.ndarray, cfg: MCConfig, step_returns: np.ndarray) -> dict[str, Any]:
    eq = np.cumprod(1 + paths, axis=1)
    eq = np.concatenate([np.ones((eq.shape[0], 1)), eq], axis=1)
    peak = np.maximum.accumulate(eq, axis=1)
    mdd = (1 - eq / peak).max(axis=1)
    term = eq[:, -1]
    return {
        "terminal_equity_median": float(np.median(term)),
        "terminal_equity_p05": float(np.quantile(term, 0.05)),
        "terminal_equity_p95": float(np.quantile(term, 0.95)),
        "prob_loss": float(np.mean(term < 1.0)),
        "max_drawdown_median": float(np.median(mdd)),
        "max_drawdown_p95": float(np.quantile(mdd, 0.95)),
        "prob_daily_dd_breach": float(np.mean((step_returns <= -cfg.daily_dd_limit).any(axis=1))),
        "prob_total_dd_breach": float(np.mean(mdd >= cfg.total_dd_limit)),
        "prob_ruin": float(np.mean(eq.min(axis=1) <= cfg.ruin_level)),
        "_terminal": term,
        "_mdd": mdd,
    }


def run_monte_carlo(daily: pd.Series, trades: pd.DataFrame, cfg: MCConfig) -> dict[str, Any]:
    """``trades`` needs columns ``ret`` (pnl / equity before trade), ``cost_ret`` (slippage+spread
    cost / equity) and ``fee_ret`` (fees / equity)."""
    rng = np.random.default_rng(cfg.seed)
    out: dict[str, Any] = {"config": cfg.__dict__.copy(), "scenarios": {}}
    d = daily.dropna().to_numpy(dtype=float)
    t = trades["ret"].to_numpy(dtype=float) if len(trades) else np.array([])
    cost = trades["cost_ret"].to_numpy(dtype=float) if len(trades) else np.array([])
    fee = trades["fee_ret"].to_numpy(dtype=float) if len(trades) else np.array([])
    hd = cfg.horizon_days or len(d)
    ht = cfg.horizon_trades or len(t)

    def record(name: str, paths: np.ndarray, desc: str) -> None:
        st = _path_stats(paths, cfg, paths)
        st["description"] = desc
        out["scenarios"][name] = st

    if len(d) >= 30:
        idx = np.stack([stationary_bootstrap_indices(len(d), cfg.block, rng)[:hd] for _ in range(cfg.n_sims)])
        record("block_bootstrap", d[idx], f"stationary block bootstrap of {len(d)} OOS daily returns, mean block {cfg.block}")
        shocked = d[idx].copy()
        mu = d.mean()
        for row in shocked:
            start = rng.integers(0, max(len(row) - 30, 1))
            row[start:start + 30] = mu + (row[start:start + 30] - mu) * 1.75
        record("volatility_shock", shocked, "block bootstrap with 1.75x dispersion in one random 30-day block per path")
    if len(t) >= 20:
        n, m = cfg.n_sims, ht
        boot = rng.integers(0, len(t), size=(n, m))
        record("trade_bootstrap", t[boot], f"iid bootstrap of {len(t)} OOS trade returns")
        record("trade_shuffle", np.stack([rng.permutation(t)[:m] for _ in range(n)]), "random permutation of trade order")
        worst = np.sort(t)[: max(3, int(np.ceil(0.05 * len(t))))]
        streak = max(5, len(worst))
        cl = t[boot].copy()
        for row in cl:
            k = int(rng.integers(0, max(m - streak, 1)))
            n_inj = int(min(streak, m - k))
            row[k:k + n_inj] = worst[rng.integers(0, len(worst), size=n_inj)]
        record("consecutive_losses", cl, f"bootstrap with an injected streak of {streak} worst-5% losses")
        record("slippage_x3", t[boot] - 2.0 * cost[boot], "slippage+spread cost tripled (extra 2x charged)")
        record("fees_x2", t[boot] - fee[boot], "fees doubled")
        liq = t[boot].copy()
        mask = rng.random(liq.shape) < 0.2
        # fee_ret = 2 sides x notional/equity x fee_rate(0.10%)  =>  25 bps on both sides = 2.5 x fee_ret
        liq -= mask * 2.5 * np.abs(fee[boot])
        record("liquidity_crunch", liq, "+25 bps per side on a random 20% of trades")
        gap = t[boot].copy()
        gmask = (gap < 0) & (rng.random(gap.shape) < 0.03)
        gap[gmask] *= 3.0
        record("gap_risk", gap, "3% of losing trades gap through the stop to 3x their loss")
    return out


def summarize(mc: dict[str, Any]) -> dict[str, Any]:
    return {k: {kk: vv for kk, vv in v.items() if not kk.startswith("_")} for k, v in mc["scenarios"].items()}
