# Security and Operational Safety

## Operating modes

| Mode | How it is selected | Broker | Credentials |
|---|---|---|---|
| **PAPER** (default) | `PAPER_MODE=true` (default), or anything ambiguous | `PaperBroker`: live public data, simulated fills | none; constructing an authenticated client in PAPER raises `PermissionError` |
| TESTNET | `PAPER_MODE=false`, `TESTNET_MODE=true` | `CCXTExchangeBroker` + `set_sandbox_mode(True)` | testnet keys |
| LIVE | `PAPER_MODE=false` **and** `LIVE_TRADING_ENABLED=true` **and** exact `LIVE_TRADING_ACKNOWLEDGEMENT` phrase **and** a passed deployment gate | `CCXTExchangeBroker` | least-privilege live keys |

The deployment gate (`execution/bootstrap.deployment_gate_passed`) requires `artifacts/deployment_gate.json`
with an `approved_by` operator and a `config_hash` equal to the research report's, **and** at least one PROMOTED
strategy in `artifacts/research/research_results.json`. The platform never switches PAPER → LIVE by itself, and in
LIVE/TESTNET only PROMOTED strategies receive capital. No real trade was executed during development or testing.

## Secrets

* Secrets come only from environment variables / `.env` (git-ignored); `.env.example` contains placeholders only.
* API keys: trading permission only, IP-whitelisted, **never withdrawal permission**. The code never requests or
  uses withdrawal endpoints.
* `monitoring/logging.RedactingFilter` scrubs `api_key/secret/passphrase/password/token/signature/authorization`
  patterns and the literal values of secret-like environment variables from every log record (tested).

## Dashboard

* Bound to `127.0.0.1` by default; Docker publishes it on host loopback only. Do **not** expose it to the
  internet — use an SSH tunnel or VPN, or a TLS reverse proxy with additional authentication.
* Login with PBKDF2-SHA256 (390k iterations) password hash from env; JWT (HS256) sessions with expiry. If no hash is
  configured, `scripts/run_dashboard.py` generates an **ephemeral** password for that process only.
* All data and control endpoints require a Bearer token; WebSocket clients must authenticate in their first
  message (tokens are never placed in URLs); disallowed `Origin` headers are rejected.
* CORS restricted to `DASHBOARD_ALLOWED_ORIGINS`; security headers (CSP, `X-Frame-Options: DENY`, `nosniff`,
  `no-referrer`, `no-store` for API); OpenAPI/docs endpoints disabled.
* Rate limits per client: login 5/min, reads 240/min, controls 10/min.
* Input validation via Pydantic models; generic error messages (no stack traces to clients).
* Audit log (`audit_log` table) of every login, failed login and control action with actor and IP.

## Emergency controls

| Control | Effect |
|---|---|
| KILL SWITCH | Persist HALT + kill flag in DB immediately → engine cancels **all** orders → reduce-only flatten → verifies exposure → retries with idempotent ids; remains halted |
| EMERGENCY FLATTEN | Persist HALT → cancel entry orders → flatten → verify |
| CANCEL OPEN ORDERS | Cancels all open orders; positions left without protection are re-protected (new revision ids) on the next step or closed if protection cannot be verified |
| RESUME | Only an identified, authenticated operator; refused while a recovery state discrepancy is unexplained |

Each requires a typed confirmation phrase. No control can modify hard risk limits (they are only read from
version-controlled YAML at startup, validated by schema: risk per trade ≤ 1.5 %, Kelly multiplier ≤ 0.25).

## Circuit breakers (fail closed)

See `risk/circuit_breaker.py`. Drawdown breaches (daily 3 %, total 10 % from HWM) and the kill switch halt and
flatten. Position discrepancies, invalid balances, database failures, clock skew, repeated exchange errors and
abnormal slippage halt new orders and require authorisation. Stale data / high latency block entries while the
condition persists. A failure to persist risk state keeps the in-memory state halted. Any exception inside
`RiskManager.evaluate` rejects the signal.

## Protective orders

Every accepted entry receives a reduce-only stop-market and (if defined) a take-profit, OCO-linked. The engine then
calls `broker.verify_protection()`: in PAPER this inspects simulated resting orders (and says so: `source =
paper_simulation`); in TESTNET/LIVE it re-reads open orders **from the exchange**. If protection cannot be
established after one retry, the engine halts new exposure and closes the position. A locally recorded stop price is
never treated as exchange-side protection.

## Crash recovery

On start: load account/positions/open orders/risk state → `PRAGMA integrity_check` → replay the fill journal and
compare with stored positions and cash → reconcile with the broker → verify protection for every restored position.
Any unexplained discrepancy halts and requires an operator `resume` with `discrepancy_explained=true`.
Signals are deduplicated by `processed_signals.signal_id`; orders by client id; fills by fill id.

## Runbook

* Start paper + dashboard: `make paper` (or `docker compose up -d`).
* Health: dashboard header status (HEALTHY / DEGRADED / HALTED / DISCONNECTED / RECOVERING), `/api/health`,
  `logs/paper_trading.jsonl` (JSON lines), `risk_events` table.
* After a halt: inspect `risk_events` and `audit_log`, reconcile positions, then RESUME from the dashboard.
* Backups: stop the engine (graceful shutdown persists state) and copy `var/quant_engine.sqlite*`.
* Dependency audit: `make audit` (pip-audit, npm audit).
