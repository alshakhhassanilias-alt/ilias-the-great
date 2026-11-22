#!/usr/bin/env python
"""Generate DASHBOARD_PASSWORD_HASH for .env (PBKDF2-SHA256)."""

import getpass

import _bootstrap  # noqa: F401

from quant_engine.dashboard.backend.security import hash_password

if __name__ == "__main__":
    pw = getpass.getpass("Dashboard password (>= 12 chars): ")
    if pw != getpass.getpass("Repeat: "):
        raise SystemExit("passwords do not match")
    print(f"DASHBOARD_PASSWORD_HASH={hash_password(pw)}")
