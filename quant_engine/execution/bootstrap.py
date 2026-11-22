"""Assemble a trading engine from configuration (shared by scripts and tests)."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import pandas as pd

from quant_engine.config.settings import AppConfig, EnvSettings, TradingMode, resolve_trading_mode
from quant_engine.data.cache import ParquetCache
from quant_engine.data.database import get_engine
from quant_engine.data.exchanges.factory import create_async_public_exchange, create_private_exchange
from quant_engine.data.ingestion import LiveMarketFeed
from quant_engine.data.normalization import to_close_time_index
from quant_engine.execution.engine import TradingEngine
from quant_engine.execution.exchange_adapter import CCXTExchangeBroker
from quant_engine.execution.state_store import StateStore
from quant_engine.regime.allocation import ValidationStatus
from quant_engine.strategies.registry import build_enabled

log = logging.getLogger(__name__)


def deployment_gate_passed(artifacts_dir: Path) -> bool:
    """LIVE requires a research report with >=1 PROMOTED strategy and a signed-off gate file."""
    gate = artifacts_dir / "deployment_gate.json"
    res = artifacts_dir / "research" / "research_results.json"
    if not (gate.exists() and res.exists()):
        return False
    g = json.loads(gate.read_text())
    r = json.loads(res.read_text())
    return bool(g.get("approved_by")) and bool(r.get("deployable")) and g.get("config_hash") == r.get("config_hash")


def load_statuses(artifacts_dir: Path) -> tuple[dict[str, ValidationStatus], dict[str, dict[str, Any]]]:
    p = artifacts_dir / "research" / "research_results.json"
    if not p.exists():
        return {}, {}
    r = json.loads(p.read_text())
    statuses = {k: ValidationStatus(v["status"]) for k, v in r.get("promotion", {}).items()}
    params = {k: (v.get("holdout", {}) or {}) for k, v in r.get("strategies", {}).items()}
    hold = r.get("holdout", {}).get("results", {})
    frozen = {k: (hold.get(k, {}) or {}).get("selected_params") or {} for k in statuses}
    return statuses, frozen or params


def build_engine(
    cfg: AppConfig,
    env: EnvSettings,
    *,
    diagnostic_probe: bool = False,
    allow_rejected_in_paper: bool = False,
    probe_hold_seconds: float = 20.0,
) -> TradingEngine:
    art = Path(env.artifacts_dir)
    mode = resolve_trading_mode(env, deployment_gate_passed(art))
    store = StateStore(get_engine(env.database_url), mode.value)
    xcfg = cfg.exchanges.exchanges[env.exchange]
    statuses, frozen = load_statuses(art)
    strategies = []
    for st in build_enabled(cfg):
        params = frozen.get(st.strategy_id) or {}
        strategies.append(st.with_params({**st.params, **params}) if params else st)
    # regime history from the validated cache (training data for the live regime detector)
    cache = ParquetCache(env.market_data_dir)
    hist = {}
    for s in cfg.research.symbols:
        raw = cache.load(env.exchange, s, cfg.strategies.regime.get("timeframe", "4h"))
        if not raw.empty:
            hist[s] = to_close_time_index(raw, "4h").loc[pd.Timestamp.now(tz="UTC") - pd.Timedelta(days=400) :]
    broker = None
    if mode is not TradingMode.PAPER:
        ex = create_private_exchange(xcfg, env, mode)
        broker = CCXTExchangeBroker(ex, mode, xcfg.ccxt_id, swap_symbols=xcfg.swap_symbols)
    feed = LiveMarketFeed(create_async_public_exchange(xcfg), cfg.research.symbols, ["15m", "1h", "4h"])
    return TradingEngine(
        cfg,
        env,
        mode,
        store,
        feed,
        strategies,
        statuses,
        broker,
        allow_rejected_in_paper=allow_rejected_in_paper,
        diagnostic_probe=diagnostic_probe,
        probe_hold_seconds=probe_hold_seconds,
        regime_history=hist,
    )
