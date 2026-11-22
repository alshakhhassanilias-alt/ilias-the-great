"""Strict walk-forward optimisation.

Window layout (configurable; defaults 12m train / 3m validation / 3m test, step 3m)::

    |------ train ------|emb|-- val --|emb|-- test --|
                              step ->  |------ train ------|emb|-- val --|emb|-- test --|

* The final ``final_holdout_months`` of data are excluded from every walk-forward window and
  touched exactly once, after all research decisions are frozen (:func:`evaluate_holdout`).
  Each access is appended to ``holdout_access_log.json``.
* ``embargo_days`` separate segments so trades / overlapping features in one segment cannot
  inform the next (each segment is also simulated from a flat book).
* Per window: ``fit`` on train only -> grid on train -> top-K by train Sharpe -> select by
  validation Sharpe (minimum trade counts enforced) -> **freeze** -> evaluate on test.
* Every grid configuration is also evaluated on each test segment.  These OOS "trial"
  returns feed the Deflated Sharpe Ratio (selection-bias adjustment) and CSCV-PBO; they are
  never used for selection.
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from quant_engine.backtest.engine import BacktestEngine, BacktestResult, StrategyRun
from quant_engine.backtest.metrics import daily_returns, performance_summary, sharpe
from quant_engine.config.settings import AppConfig, WalkForwardConfig
from quant_engine.core.types import timeframe_delta
from quant_engine.strategies.base import MarketData, Strategy
from quant_engine.strategies.registry import build_strategy

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Window:
    index: int
    train_start: pd.Timestamp
    train_end: pd.Timestamp
    val_start: pd.Timestamp
    val_end: pd.Timestamp
    test_start: pd.Timestamp
    test_end: pd.Timestamp

    def to_dict(self) -> dict[str, str | int]:
        return {k: (str(v) if isinstance(v, pd.Timestamp) else v) for k, v in asdict(self).items()}


def build_windows(data_start: pd.Timestamp, data_end: pd.Timestamp, wf: WalkForwardConfig) -> tuple[list[Window], pd.Timestamp]:
    """Return (windows, holdout_start).  Windows never extend into the holdout."""
    holdout_start = (data_end - pd.DateOffset(months=wf.final_holdout_months)).normalize()
    emb = pd.Timedelta(days=wf.embargo_days)
    windows: list[Window] = []
    k = 0
    cur = data_start.normalize()
    while True:
        tr_s = cur
        tr_e = tr_s + pd.DateOffset(months=wf.train_months)
        va_s = tr_e + emb
        va_e = va_s + pd.DateOffset(months=wf.validation_months)
        te_s = va_e + emb
        te_e = te_s + pd.DateOffset(months=wf.test_months)
        if te_e > holdout_start:
            break
        windows.append(Window(k, tr_s, tr_e, va_s, va_e, te_s, te_e))
        k += 1
        cur = cur + pd.DateOffset(months=wf.step_months)
    return windows, holdout_start


@dataclass
class SegmentEval:
    params: dict[str, Any]
    sharpe: float
    net_return: float
    trades: int
    daily: pd.Series = field(repr=False, default_factory=lambda: pd.Series(dtype=float))


@dataclass
class WindowResult:
    window: Window
    fitted: dict[str, Any]
    selected_params: dict[str, Any] | None
    selection_note: str
    train_evals: list[SegmentEval]
    val_evals: list[SegmentEval]
    test_summary: dict[str, Any]
    test_daily: pd.Series
    test_equity: pd.Series
    test_trades: pd.DataFrame
    test_stats: dict[str, Any]
    stress_summary: dict[str, Any]
    stress_daily: pd.Series
    trial_test_daily: dict[str, pd.Series]  # param-key -> OOS daily returns (all configs)


def param_key(p: dict[str, Any], grid_keys: list[str]) -> str:
    return ",".join(f"{k}={p[k]}" for k in sorted(grid_keys))


class WalkForwardRunner:
    def __init__(self, cfg: AppConfig, md: MarketData) -> None:
        self.cfg = cfg
        self.md = md
        self.wf = cfg.research.walk_forward

    # ------------------------------------------------------------------ helpers
    def _engine(
        self, st: Strategy, start: pd.Timestamp, end: pd.Timestamp, cost_mult: float = 1.0, enforce: bool = False
    ) -> BacktestEngine:
        bars = {s: self.md.get(s, st.timeframe).loc[start:end] for s in st.symbols}
        return BacktestEngine(
            self.cfg.backtest,
            self.cfg.risk,
            st.timeframe,
            bars,
            self.md.funding,
            enforce_circuit_breakers=enforce,
            cost_multiplier=cost_mult,
            slippage_multiplier=cost_mult,
        )

    def _data_until(self, st: Strategy, start: pd.Timestamp, end: pd.Timestamp) -> MarketData:
        warm = timeframe_delta("4h") * max(st.warmup_bars, 600)
        return self.md.slice(start - warm, end)

    @staticmethod
    def _eval(res: BacktestResult, params: dict[str, Any]) -> SegmentEval:
        d = daily_returns(res.equity)
        return SegmentEval(params, sharpe(d), float(res.equity.iloc[-1] / res.equity.iloc[0] - 1), len(res.trades), d)

    # ------------------------------------------------------------------ main
    def run_window(self, name: str, w: Window) -> WindowResult:
        st = build_strategy(name, self.cfg)
        fitted = st.fit(self.md.slice(w.train_start, w.train_end))
        data = self._data_until(st, w.train_start, w.test_end)
        grid = st.param_grid()
        grid_keys = list(st.cfg.param_grid)
        eng_all = self._engine(st, w.train_start - timeframe_delta(st.timeframe) * 300, w.test_end)
        eng_stress = self._engine(
            st,
            w.train_start - timeframe_delta(st.timeframe) * 300,
            w.test_end,
            cost_mult=self.cfg.research.promotion.cost_stress_multiplier,
        )
        frames_by_key: dict[str, dict[str, pd.DataFrame]] = {}
        train_evals: list[SegmentEval] = []
        trial_test: dict[str, pd.Series] = {}
        for p in grid:
            k = param_key(p, grid_keys)
            frames = st.compute(data, p)
            frames_by_key[k] = frames
            run = [StrategyRun(name, st.timeframe, frames)]
            train_evals.append(self._eval(eng_all.run(run, w.train_start, w.train_end), p))
            trial_test[k] = self._eval(eng_all.run(run, w.test_start, w.test_end), p).daily

        eligible = [e for e in train_evals if e.trades >= self.wf.min_trades_train]
        eligible.sort(key=lambda e: e.sharpe, reverse=True)
        top = eligible[: self.wf.top_k_from_training]
        val_evals = [
            self._eval(
                eng_all.run(
                    [StrategyRun(name, st.timeframe, frames_by_key[param_key(e.params, grid_keys)])], w.val_start, w.val_end
                ),
                e.params,
            )
            for e in top
        ]
        val_ok = [v for v in val_evals if v.trades >= self.wf.min_trades_validation]
        selected: dict[str, Any] | None = None
        note = ""
        if not top:
            note = "no configuration met the minimum training trade count; strategy flat in OOS"
        elif not val_ok:
            note = "no top-K configuration met the minimum validation trade count; strategy flat in OOS"
        else:
            best = max(val_ok, key=lambda v: (v.sharpe, -top.index(next(t for t in top if t.params == v.params))))
            selected = best.params
            note = "selected by validation Sharpe among top-K training configurations"

        if selected is not None:
            frames = frames_by_key[param_key(selected, grid_keys)]
            res = eng_all.run([StrategyRun(name, st.timeframe, frames)], w.test_start, w.test_end)
            stress = eng_stress.run([StrategyRun(name, st.timeframe, frames)], w.test_start, w.test_end)
        else:
            res = eng_all.run([], w.test_start, w.test_end)
            stress = res
        summary = performance_summary(res.equity, res.trades, res.gross_exposure, res.stats)
        return WindowResult(
            w,
            _jsonable(fitted),
            selected,
            note,
            train_evals,
            val_evals,
            summary,
            daily_returns(res.equity),
            res.equity,
            res.trades,
            res.stats,
            performance_summary(stress.equity, stress.trades, stress.gross_exposure, stress.stats),
            daily_returns(stress.equity),
            trial_test,
        )

    def run_strategy(self, name: str, windows: list[Window]) -> list[WindowResult]:
        out = []
        for w in windows:
            r = self.run_window(name, w)
            log.info(
                "WF %s window %d test %s..%s selected=%s sharpe=%.2f ret=%.3f trades=%d",
                name,
                w.index,
                w.test_start.date(),
                w.test_end.date(),
                r.selected_params is not None,
                r.test_summary["sharpe"],
                r.test_summary["net_return"],
                r.test_summary["total_trades"],
            )
            out.append(r)
        return out


def _jsonable(obj: Any) -> Any:
    return json.loads(json.dumps(obj, default=lambda o: o.tolist() if hasattr(o, "tolist") else str(o)))


def stitch_daily(results: list[WindowResult], attr: str = "test_daily") -> pd.Series:
    parts = [getattr(r, attr) for r in results if len(getattr(r, attr))]
    if not parts:
        return pd.Series(dtype=float)
    s = pd.concat(parts)
    return s[~s.index.duplicated(keep="first")].sort_index()


def equity_from_returns(r: pd.Series, initial: float = 1.0) -> pd.Series:
    return initial * (1 + r).cumprod()


def trial_matrix(results: list[WindowResult]) -> pd.DataFrame:
    keys = sorted({k for r in results for k in r.trial_test_daily})
    cols = {}
    for k in keys:
        parts = [r.trial_test_daily[k] for r in results if k in r.trial_test_daily]
        s = pd.concat(parts)
        cols[k] = s[~s.index.duplicated(keep="first")]
    return pd.DataFrame(cols).sort_index()


def log_holdout_access(path: Path, who: str, purpose: str, details: dict[str, Any]) -> int:
    """Append-only record of every final-holdout evaluation; returns the access count."""
    entries: list[dict[str, Any]] = []
    if path.exists():
        entries = json.loads(path.read_text())
    entries.append({"timestamp": pd.Timestamp.now(tz="UTC").isoformat(), "who": who, "purpose": purpose, **details})
    path.write_text(json.dumps(entries, indent=2, default=str))
    return len(entries)


def selection_window_for_holdout(holdout_start: pd.Timestamp, wf: WalkForwardConfig) -> Window:
    """Final frozen-decision window: train/validation immediately before the holdout."""
    emb = pd.Timedelta(days=wf.embargo_days)
    va_e = holdout_start - emb
    va_s = va_e - pd.DateOffset(months=wf.validation_months)
    tr_e = va_s - emb
    tr_s = tr_e - pd.DateOffset(months=wf.train_months)
    return Window(-1, tr_s, tr_e, va_s, va_e, holdout_start, holdout_start)


def parameter_stability(results: list[WindowResult], grid_keys: list[str]) -> dict[str, Any]:
    """How often each parameter value is selected, and selection churn between windows."""
    sel = [r.selected_params for r in results]
    freq: dict[str, dict[str, int]] = {k: {} for k in grid_keys}
    changes = 0
    prev = None
    for p in sel:
        if p is None:
            continue
        for k in grid_keys:
            freq[k][str(p[k])] = freq[k].get(str(p[k]), 0) + 1
        if prev is not None and any(prev[k] != p[k] for k in grid_keys):
            changes += 1
        prev = p
    n = sum(1 for p in sel if p is not None)
    return {
        "selection_frequency": freq,
        "windows_with_selection": n,
        "selection_changes": changes,
        "churn_rate": changes / max(n - 1, 1),
    }


def sensitivity(trials: pd.DataFrame) -> dict[str, Any]:
    """Dispersion of OOS Sharpe across the whole grid (robustness to parameter choice)."""
    if trials.empty:
        return {}
    sr = trials.apply(lambda c: sharpe(c.dropna()))
    return {
        "oos_sharpe_by_config": sr.round(3).to_dict(),
        "median": float(sr.median()),
        "fraction_positive": float((sr > 0).mean()),
        "iqr": float(sr.quantile(0.75) - sr.quantile(0.25)),
        "min": float(sr.min()),
        "max": float(sr.max()),
    }


_ = np  # keep numpy import for downstream users
