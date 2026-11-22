#!/usr/bin/env python
"""Serve the authenticated command-center dashboard (binds to 127.0.0.1 by default).

If DASHBOARD_PASSWORD_HASH / DASHBOARD_JWT_SECRET are not configured, an ephemeral random
password and secret are generated for this process only and the password is printed once.
"""

from __future__ import annotations

import argparse
import secrets

import _bootstrap  # noqa: F401
import uvicorn

from quant_engine.config.settings import AppConfig, EnvSettings, TradingMode, get_config, get_env, resolve_trading_mode
from quant_engine.dashboard.backend.app import create_app
from quant_engine.dashboard.backend.security import hash_password
from quant_engine.monitoring.logging import setup_logging


def credentials(env: EnvSettings) -> tuple[str, str]:
    ph = env.dashboard_password_hash.get_secret_value()
    js = env.dashboard_jwt_secret.get_secret_value()
    if not ph:
        pw = secrets.token_urlsafe(18)
        ph = hash_password(pw)
        print(f"[dashboard] no DASHBOARD_PASSWORD_HASH configured; ephemeral credentials for this run: "
              f"user={env.dashboard_username} password={pw}", flush=True)
    if not js:
        js = secrets.token_hex(32)
    return ph, js


def build_server(cfg: AppConfig, env: EnvSettings, mode: TradingMode, port: int | None = None) -> uvicorn.Server:
    ph, js = credentials(env)
    app = create_app(cfg, env, mode, ph, js)
    if env.dashboard_host not in ("127.0.0.1", "localhost", "::1"):
        print("[dashboard] WARNING: binding to a non-loopback address. Put it behind TLS and a VPN/reverse proxy; "
              "never expose the trading dashboard directly to the internet.", flush=True)
    config = uvicorn.Config(app, host=env.dashboard_host, port=port or env.dashboard_port, log_level="warning",
                            proxy_headers=False, server_header=False)
    return uvicorn.Server(config)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=None)
    args = ap.parse_args()
    setup_logging("dashboard")
    cfg, env = get_config(), get_env()
    mode = resolve_trading_mode(env, False) if env.paper_mode else TradingMode(
        "LIVE" if env.live_trading_enabled else "TESTNET")
    build_server(cfg, env, mode, args.port).run()


if __name__ == "__main__":
    main()
