"""Validated configuration for the quant engine.

Two sources of configuration exist and are kept strictly apart:

* **Environment variables** (``.env``) hold secrets and the operating mode.  They are
  read by :class:`EnvSettings` and are never written to logs.
* **YAML files** in ``quant_engine/config`` hold research / risk / exchange parameters.
  They are version-controlled and hashed so every persisted run records the exact
  configuration that produced it.

PAPER mode is the default.  LIVE mode is never selected implicitly: see
:func:`resolve_trading_mode`.
"""

from __future__ import annotations

import hashlib
import json
from enum import StrEnum
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

CONFIG_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CONFIG_DIR.parent.parent

LIVE_ACKNOWLEDGEMENT_PHRASE = "I UNDERSTAND THIS TRADES REAL MONEY AND MAY LOSE ALL OF IT"


class TradingMode(StrEnum):
    PAPER = "PAPER"
    TESTNET = "TESTNET"
    LIVE = "LIVE"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


# --------------------------------------------------------------------------------------
# Risk configuration
# --------------------------------------------------------------------------------------
class PositionSizingConfig(_Strict):
    risk_per_trade: float = Field(0.01, ge=0.001, le=0.015)
    max_risk_per_trade: float = Field(0.015, ge=0.001, le=0.015)
    kelly_multiplier: float = Field(0.25, ge=0.0, le=0.25)
    kelly_min_trades: int = Field(100, ge=30)
    kelly_max_relative_se: float = Field(0.5, gt=0.0)
    use_kelly: bool = True

    @model_validator(mode="after")
    def _check(self) -> PositionSizingConfig:
        if self.risk_per_trade > self.max_risk_per_trade:
            raise ValueError("risk_per_trade cannot exceed max_risk_per_trade")
        return self


class ExposureLimitsConfig(_Strict):
    max_gross_exposure: float = Field(1.5, gt=0, le=5.0)
    max_net_exposure: float = Field(1.0, gt=0, le=5.0)
    max_leverage: float = Field(2.0, ge=1.0, le=5.0)
    max_asset_concentration: float = Field(0.6, gt=0, le=2.0)
    max_open_positions: int = Field(6, ge=1, le=50)
    correlation_threshold: float = Field(0.6, ge=0.0, le=1.0)
    correlation_lookback_bars: int = Field(240, ge=20)
    min_order_notional: float = Field(10.0, ge=0.0)


class CircuitBreakerConfig(_Strict):
    daily_drawdown_limit: float = Field(0.03, gt=0, le=0.2)
    max_total_drawdown: float = Field(0.10, gt=0, le=0.5)
    max_api_latency_ms: float = Field(5000, gt=0)
    max_consecutive_exchange_errors: int = Field(5, ge=1)
    max_data_staleness_seconds: float = Field(180, gt=0)
    max_clock_skew_ms: float = Field(2000, gt=0)
    max_position_discrepancy_fraction: float = Field(0.001, ge=0)
    max_abnormal_slippage_bps: float = Field(100, gt=0)
    backtest_resume_after_daily_breach: bool = True


class StopConfig(_Strict):
    require_protective_orders: bool = True
    min_stop_distance_atr: float = Field(0.5, gt=0)
    max_stop_distance_pct: float = Field(0.15, gt=0, le=0.5)


class RiskConfig(_Strict):
    sizing: PositionSizingConfig = PositionSizingConfig()
    exposure: ExposureLimitsConfig = ExposureLimitsConfig()
    circuit_breakers: CircuitBreakerConfig = CircuitBreakerConfig()
    stops: StopConfig = StopConfig()


# --------------------------------------------------------------------------------------
# Execution-cost assumptions (NOT claims about any exchange's actual fee schedule)
# --------------------------------------------------------------------------------------
class CostModelConfig(_Strict):
    taker_fee: float = Field(0.0010, ge=0)
    maker_fee: float = Field(0.0010, ge=0)
    spread_bps: dict[str, float] = Field(
        default_factory=lambda: {"BTC/USDT": 1.0, "ETH/USDT": 1.5, "SOL/USDT": 3.0}
    )
    default_spread_bps: float = 5.0
    base_slippage_bps: float = Field(1.0, ge=0)
    volatility_slippage_coef: float = Field(0.10, ge=0)
    impact_coef: float = Field(0.5, ge=0)
    max_participation: float = Field(0.05, gt=0, le=1.0)
    latency_ms: float = Field(250.0, ge=0)
    limit_penetration_bps: float = Field(2.0, ge=0)
    rejection_probability: float = Field(0.0, ge=0, le=1)
    unknown_funding_rate_8h: float = Field(0.0001, ge=0)
    maintenance_margin_rate: float = Field(0.005, ge=0, le=0.5)
    gap_stop_fill_at_open: bool = True


class BacktestConfig(_Strict):
    initial_capital: float = Field(100_000.0, gt=0)
    costs: CostModelConfig = CostModelConfig()
    allow_short: bool = True
    seed: int = 7


class WalkForwardConfig(_Strict):
    train_months: int = Field(12, ge=3)
    validation_months: int = Field(3, ge=1)
    test_months: int = Field(3, ge=1)
    step_months: int = Field(3, ge=1)
    embargo_days: int = Field(7, ge=0)
    final_holdout_months: int = Field(6, ge=0)
    top_k_from_training: int = Field(5, ge=1)
    min_trades_train: int = Field(10, ge=1)
    min_trades_validation: int = Field(3, ge=0)
    selection_metric: Literal["sharpe", "sortino", "calmar"] = "sharpe"


class PromotionCriteria(_Strict):
    min_oos_trades: int = 60
    min_oos_sharpe_ci_lower: float = 0.0
    min_deflated_sharpe_prob: float = 0.95
    max_pbo: float = 0.5
    max_oos_drawdown: float = 0.25
    min_positive_window_fraction: float = 0.5
    min_profit_factor: float = 1.1
    cost_stress_multiplier: float = 2.0
    must_survive_cost_stress: bool = True
    review_sharpe_threshold: float = 1.0


class ResearchConfig(_Strict):
    start: str = "2021-01-01"
    end: str | None = None
    symbols: list[str] = Field(default_factory=lambda: ["BTC/USDT", "ETH/USDT", "SOL/USDT"])
    timeframes: list[str] = Field(default_factory=lambda: ["15m", "1h", "4h", "1d"])
    walk_forward: WalkForwardConfig = WalkForwardConfig()
    promotion: PromotionCriteria = PromotionCriteria()
    monte_carlo_simulations: int = Field(2000, ge=1000)
    monte_carlo_block_size: int = Field(10, ge=1)
    bootstrap_samples: int = Field(2000, ge=200)
    annualization_days: float = 365.0


# --------------------------------------------------------------------------------------
# Strategy configuration
# --------------------------------------------------------------------------------------
class StrategyConfig(_Strict):
    enabled: bool = True
    timeframe: str
    symbols: list[str]
    max_weight: float = Field(0.4, gt=0, le=1.0)
    default_params: dict[str, Any] = Field(default_factory=dict)
    param_grid: dict[str, list[Any]] = Field(default_factory=dict)
    regime_affinity: dict[str, float] = Field(default_factory=dict)
    research_only: bool = False


class StrategiesFile(_Strict):
    strategies: dict[str, StrategyConfig]
    regime: dict[str, Any] = Field(default_factory=dict)
    allocation: dict[str, Any] = Field(default_factory=dict)


# --------------------------------------------------------------------------------------
# Exchange configuration
# --------------------------------------------------------------------------------------
class ExchangeConfig(_Strict):
    ccxt_id: str
    public_api_override: str | None = None
    sandbox_supported: bool = False
    supports_native_stop_orders: bool = False
    symbols: dict[str, str] = Field(default_factory=dict)
    swap_symbols: dict[str, str] = Field(default_factory=dict)
    ohlcv_limit: int = 1000
    rate_limit_ms: int = 100
    notes: str = ""


class ExchangesFile(_Strict):
    default: str
    market_data_primary: str
    exchanges: dict[str, ExchangeConfig]

    @field_validator("default", "market_data_primary")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.lower()


# --------------------------------------------------------------------------------------
# Environment (secrets + operating mode)
# --------------------------------------------------------------------------------------
class EnvSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    paper_mode: bool = True
    live_trading_enabled: bool = False
    testnet_mode: bool = False
    exchange: str = "binance"
    live_trading_acknowledgement: str = ""

    exchange_api_key: SecretStr = SecretStr("")
    exchange_api_secret: SecretStr = SecretStr("")
    exchange_api_passphrase: SecretStr = SecretStr("")

    database_url: str = f"sqlite:///{PROJECT_ROOT / 'var' / 'quant_engine.sqlite'}"
    market_data_dir: str = str(PROJECT_ROOT / "var" / "market_data")
    artifacts_dir: str = str(PROJECT_ROOT / "artifacts")
    log_dir: str = str(PROJECT_ROOT / "logs")

    dashboard_username: str = "operator"
    dashboard_password_hash: SecretStr = SecretStr("")
    dashboard_jwt_secret: SecretStr = SecretStr("")
    dashboard_token_ttl_minutes: int = 60
    dashboard_allowed_origins: str = "http://127.0.0.1:8000,http://localhost:8000,http://localhost:5173"
    dashboard_host: str = "127.0.0.1"
    dashboard_port: int = 8000

    alert_webhook_url: SecretStr = SecretStr("")
    initial_paper_capital: float = 100_000.0


def resolve_trading_mode(env: EnvSettings, deployment_gate_passed: bool = False) -> TradingMode:
    """Resolve the operating mode.  Fails closed: anything ambiguous yields PAPER.

    LIVE requires *all* of: ``PAPER_MODE=false``, ``LIVE_TRADING_ENABLED=true``, the exact
    acknowledgement phrase, and a passed deployment gate (a promoted, validated strategy
    report).  The platform never switches from PAPER to LIVE on its own.
    """
    if env.paper_mode:
        return TradingMode.PAPER
    if env.live_trading_enabled:
        if env.live_trading_acknowledgement != LIVE_ACKNOWLEDGEMENT_PHRASE:
            raise PermissionError("LIVE requested without the exact acknowledgement phrase; refusing.")
        if not deployment_gate_passed:
            raise PermissionError("LIVE requested but the deployment safety gate has not passed; refusing.")
        return TradingMode.LIVE
    if env.testnet_mode:
        return TradingMode.TESTNET
    return TradingMode.PAPER


# --------------------------------------------------------------------------------------
# Loading helpers
# --------------------------------------------------------------------------------------
def _load_yaml(name: str, config_dir: Path | None = None) -> dict[str, Any]:
    path = (config_dir or CONFIG_DIR) / name
    with path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a mapping")
    return data


class AppConfig(_Strict):
    risk: RiskConfig
    backtest: BacktestConfig
    research: ResearchConfig
    strategies: StrategiesFile
    exchanges: ExchangesFile

    def version_hash(self) -> str:
        payload = json.dumps(self.model_dump(mode="json"), sort_keys=True, default=str)
        return hashlib.sha256(payload.encode()).hexdigest()[:16]


def load_config(config_dir: Path | None = None) -> AppConfig:
    risk_raw = _load_yaml("risk.yaml", config_dir)
    strat_raw = _load_yaml("strategies.yaml", config_dir)
    exch_raw = _load_yaml("exchanges.yaml", config_dir)
    return AppConfig(
        risk=RiskConfig(**risk_raw.get("risk", {})),
        backtest=BacktestConfig(**risk_raw.get("backtest", {})),
        research=ResearchConfig(**risk_raw.get("research", {})),
        strategies=StrategiesFile(**strat_raw),
        exchanges=ExchangesFile(**exch_raw),
    )


@lru_cache(maxsize=1)
def get_config() -> AppConfig:
    return load_config()


def get_env() -> EnvSettings:
    return EnvSettings()
