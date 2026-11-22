"""CCXT exchange construction.

* Honours the environment's HTTPS proxy explicitly.  CCXT's synchronous client pins its
  own CA store and ignores ``HTTPS_PROXY`` unless ``httpsProxy`` is set; the async
  client needs ``aiohttp_trust_env``.
* Applies a public-API override (Binance's official market-data mirror
  ``data-api.binance.vision``) for read-only market data when configured.
* Authenticated clients are only built for TESTNET/LIVE, from env secrets, and never log them.
"""

from __future__ import annotations

import os
from typing import Any

import ccxt
import ccxt.async_support as accxt

from quant_engine.config.settings import EnvSettings, ExchangeConfig, TradingMode


def _proxy_options() -> dict[str, Any]:
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    return {"httpsProxy": proxy} if proxy else {}


def _base_options(cfg: ExchangeConfig, market_type: str) -> dict[str, Any]:
    opts: dict[str, Any] = {"enableRateLimit": True, "rateLimit": cfg.rate_limit_ms, "timeout": 20_000}
    if cfg.ccxt_id == "binance":
        # Only load the market families we need: fapi/dapi may be geo-restricted.
        opts["options"] = {"fetchMarkets": {"types": [market_type]}, "defaultType": market_type}
    elif cfg.ccxt_id in {"okx", "bybit"}:
        opts["options"] = {"defaultType": market_type}
    return opts


def create_public_exchange(cfg: ExchangeConfig, market_type: str = "spot") -> ccxt.Exchange:
    """Unauthenticated synchronous client for historical / public market data."""
    klass = getattr(ccxt, cfg.ccxt_id)
    ex = klass({**_base_options(cfg, market_type), **_proxy_options()})
    if cfg.public_api_override and market_type == "spot":
        ex.urls["api"]["public"] = cfg.public_api_override
    return ex


def create_async_public_exchange(cfg: ExchangeConfig, market_type: str = "spot") -> accxt.Exchange:
    klass = getattr(accxt, cfg.ccxt_id)
    ex = klass({**_base_options(cfg, market_type), "aiohttp_trust_env": True})
    if cfg.public_api_override and market_type == "spot":
        ex.urls["api"]["public"] = cfg.public_api_override
    return ex


def create_private_exchange(cfg: ExchangeConfig, env: EnvSettings, mode: TradingMode, market_type: str = "swap") -> ccxt.Exchange:
    """Authenticated client for TESTNET / LIVE.  Refuses PAPER and missing credentials."""
    if mode is TradingMode.PAPER:
        raise PermissionError("PAPER mode must never construct an authenticated exchange client")
    key = env.exchange_api_key.get_secret_value()
    secret = env.exchange_api_secret.get_secret_value()
    if not key or not secret:
        raise PermissionError("exchange credentials are not configured")
    klass = getattr(ccxt, cfg.ccxt_id)
    params: dict[str, Any] = {**_base_options(cfg, market_type), **_proxy_options(), "apiKey": key, "secret": secret}
    passphrase = env.exchange_api_passphrase.get_secret_value()
    if passphrase:
        params["password"] = passphrase
    ex = klass(params)
    if mode is TradingMode.TESTNET:
        if not cfg.sandbox_supported:
            raise PermissionError(f"{cfg.ccxt_id} has no supported sandbox; TESTNET unavailable")
        ex.set_sandbox_mode(True)
    return ex
