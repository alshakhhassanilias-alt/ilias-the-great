#!/usr/bin/env python
"""Create / migrate the SQLite schema (idempotent) and run an integrity check."""

import _bootstrap  # noqa: F401

from quant_engine.config.settings import get_env
from quant_engine.data.database import init_database, integrity_check

if __name__ == "__main__":
    env = get_env()
    eng = init_database(env.database_url)
    ok, msg = integrity_check(eng)
    print(f"database: {env.database_url}  integrity: {msg}")
    raise SystemExit(0 if ok else 1)
