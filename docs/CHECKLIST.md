# Development Checklist

Legend: ✅ done & verified · 🟡 implemented, unverified (reason given) · ❌ not done

## Phase 1–2 · Environment, architecture, configuration
- ✅ Environment inspected (Python 3.13, uv, Node 22, Chromium/Playwright); exchange reachability probed (Binance main/futures HTTP 451, Bybit 403, Binance public mirror + archive + OKX OK)
- ✅ Package layout per spec (frontend moved to `dashboard/frontend/`, a Node project outside the Python package)
- ✅ Pydantic-validated YAML config + env secrets; config hash recorded per run; fail-closed mode resolution
- ✅ SQLite schema (WAL, synchronous=FULL), transactional state store, `scripts/init_db.py`
- ✅ Pinned dependencies (`uv.lock`, exact npm versions + lockfile)

## Phase 3 · Market data
- ✅ Unified CCXT factory (proxy-aware), Binance via official public mirror, OKX; 🟡 Bybit (geo-blocked)
- ✅ Paginated, retried, incremental OHLCV download (15m/1h/4h/1d) ≥ 3 years (5.9 years obtained)
- ✅ Validation: ordering, duplicates, gaps (never interpolated), OHLC sanity, anomalies, unfinished-bar removal
- ✅ Parquet cache + SQLite index with content hashes; coverage report
- ✅ Funding history (Binance archive + OKX current month, source-labelled)
- ✅ Order-book analytics (spread, mid, imbalance, depth, impact) from observed books
- 🟡 yfinance supplementary provider: deliberately not implemented (exchange-grade data available; avoids silent substitution)

## Phase 4 · Indicators, regimes, strategies
- ✅ Causal indicators (tested vs hand calculations + truncation tests); in-house instead of pandas-ta (documented)
- ✅ Regime detector (ADX, ATR pct, realised vol, EMA slope, Hurst, structure, volume), train-only calibration, confidence, NEUTRAL, hysteresis
- ✅ Regime-aware allocator (caps, ≤100%, crisis reduction, validation gating); optional GMM cross-check
- ✅ Strategies A–D with stop/TP/confidence/holding period/size proposal; no order access
- ✅ Leakage tests for all strategies

## Phase 5 · Portfolio & risk
- ✅ Correlation / drawdown-correlation / risk contribution; capped inverse-vol
- ✅ Risk manager: vol-adjusted fixed-fractional, gated fractional Kelly (≤0.25), 1–1.5% schema bounds, exposure/leverage/concentration/position-count caps, correlation-aware sizing, fail-closed
- ✅ Circuit breakers (3% daily, 10% total, operational triggers), kill switch with idempotent flatten + verification + retries

## Phase 6–7 · Backtesting & research
- ✅ Event-driven engine (market/limit, maker/taker, spread, impact slippage, partial fills, rejections, latency, funding, liquidation, stop-before-TP, gaps)
- ✅ Walk-forward 12/3/3 with embargo, top-K → validation selection, frozen params, untouched holdout + access log
- ✅ DSR, PBO (CSCV), bootstrap CIs, parameter stability, grid sensitivity, cost stress
- ✅ Monte Carlo (9 scenarios × 2,000 paths, seeded)
- ✅ OOS / Monte Carlo / correlation reports + charts; benchmarks

## Phase 8 · Execution, persistence, recovery
- ✅ Paper broker on live public data (observed-book fills, resting SL/TP, OCO)
- 🟡 CCXT TESTNET/LIVE broker with exchange-specific protective params and on-exchange verification (no credentials; geo-blocks)
- ✅ Idempotent client ids (with protective-order revisions), signal dedupe, fill-journal replay, reconciliation, restart recovery
- ✅ Signal expiry for stale bars; startup evaluation of the latest closed bar

## Phase 9 · Dashboard & monitoring
- ✅ FastAPI (JWT, PBKDF2, rate limits, CORS, CSP, audit log), authenticated WebSocket
- ✅ React + TS + Plotly frontend (equity, underwater, rolling Sharpe, strategy comparison, Monte Carlo, positions, orders, trades, weights, regimes, risk, emergency controls with typed confirmation)
- ✅ Structured JSON logs with secret redaction; health states; alerts; runtime metrics

## Phase 10–12 · Verification & fixes
- ✅ Tests 1–8 executed (see README table); defects found and fixed during verification:
  - risk state (HWM/day-start) only persisted on events → now persisted periodically, with external-halt adoption
  - cancelled protective orders could not be re-placed (idempotent id collision) → revisioned ids
  - real strategies not evaluated in short runs → startup evaluation + stale-signal expiry
  - dashboard bind failure crashed the engine after start → socket pre-bound before engine start
  - probe positions not re-protected after cancel; UI rendered `[object Object]` → fixed, re-verified
  - Playwright Python/browser version mismatch for PNG charts → executable fallback
- ✅ pip-audit / npm audit: 0 known vulnerabilities
- ❌ Multi-day paper run (out of scope for this session)
- 🟡 Docker image build (files written, build not executed)
