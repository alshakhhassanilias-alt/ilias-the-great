import logging

import pytest

from quant_engine.config.settings import LIVE_ACKNOWLEDGEMENT_PHRASE, EnvSettings, TradingMode, resolve_trading_mode
from quant_engine.core.types import OrderIntent, deterministic_client_order_id
from quant_engine.data.exchanges.factory import create_private_exchange
from quant_engine.execution.exchange_adapter import entry_params, protective_params
from quant_engine.monitoring.logging import RedactingFilter, redact


def env(**kw):
    return EnvSettings(_env_file=None, **kw)


def test_paper_is_default():
    assert resolve_trading_mode(env()) is TradingMode.PAPER


def test_live_requires_every_gate():
    with pytest.raises(PermissionError):
        resolve_trading_mode(env(paper_mode=False, live_trading_enabled=True))
    with pytest.raises(PermissionError):
        resolve_trading_mode(env(paper_mode=False, live_trading_enabled=True,
                                 live_trading_acknowledgement=LIVE_ACKNOWLEDGEMENT_PHRASE), deployment_gate_passed=False)
    assert resolve_trading_mode(env(paper_mode=False, live_trading_enabled=True,
                                    live_trading_acknowledgement=LIVE_ACKNOWLEDGEMENT_PHRASE), True) is TradingMode.LIVE
    # PAPER_MODE=true always wins, even with live flags set
    assert resolve_trading_mode(env(paper_mode=True, live_trading_enabled=True,
                                    live_trading_acknowledgement=LIVE_ACKNOWLEDGEMENT_PHRASE), True) is TradingMode.PAPER


def test_private_client_never_built_in_paper(cfg):
    with pytest.raises(PermissionError):
        create_private_exchange(cfg.exchanges.exchanges["binance"], env(), TradingMode.PAPER)
    with pytest.raises(PermissionError):  # no credentials
        create_private_exchange(cfg.exchanges.exchanges["binance"], env(), TradingMode.TESTNET)


def test_secret_redaction():
    s = redact('{"apiKey": "ABCDEF123456", "secret": "zzzzzzzzzzzz"} token=abc123def')
    assert "ABCDEF123456" not in s and "zzzzzzzzzzzz" not in s and "abc123def" not in s
    rec = logging.LogRecord("x", logging.INFO, "f", 1, "key api_key=SUPERSECRETVALUE", None, None)
    rec.password = "hunter2hunter2"
    RedactingFilter().filter(rec)
    assert "SUPERSECRETVALUE" not in rec.msg and rec.password == "***REDACTED***"


def test_client_order_ids_deterministic_and_exchange_safe():
    a = deterministic_client_order_id("sig", "entry")
    assert a == deterministic_client_order_id("sig", "entry") != deterministic_client_order_id("sig", "sl")
    assert len(a) <= 32 and a.isalnum()


@pytest.mark.parametrize("ex", ["binance", "okx", "bybit"])
def test_protective_params_are_reduce_only_with_client_ids(ex):
    p = protective_params(ex, OrderIntent.STOP_LOSS, 95.0, "qeabc")
    assert p.get("reduceOnly") is True and p.get("stopLossPrice") == 95.0
    assert any(k in p for k in ("newClientOrderId", "clOrdId", "orderLinkId"))
    assert entry_params(ex, "qeabc")


def test_binance_hedge_mode_uses_position_side():
    p = protective_params("binance", OrderIntent.STOP_LOSS, 95.0, "id", hedge_mode=True, position_side="LONG")
    assert p["positionSide"] == "LONG" and "reduceOnly" not in p


def test_risk_yaml_within_mandated_bounds(cfg):
    s = cfg.risk.sizing
    assert 0.01 <= s.risk_per_trade <= 0.015 and s.max_risk_per_trade <= 0.015 and s.kelly_multiplier <= 0.25
    assert cfg.risk.circuit_breakers.daily_drawdown_limit == 0.03
    assert cfg.risk.circuit_breakers.max_total_drawdown == 0.10
    assert cfg.backtest.costs.taker_fee == 0.001 and cfg.backtest.costs.maker_fee == 0.001
