# System Architecture

## Layers and data flow

```
                 ┌──────────────── research path (offline) ────────────────┐
 Binance spot    │                                                          │
 (data-api.      │  data/historical ─► Parquet cache ─► data/loader         │
 binance.vision) │        │              + SQLite index      │              │
 Binance USD-M ──┤        ▼                                  ▼              │
 funding archive │  data/validation (integrity gate)   strategies/* (causal, vectorised signal frames)
 OKX funding ────┘                                           │              │
                                                             ▼              │
                    backtest/walk_forward ─► backtest/engine (event-driven) ◄─ risk/manager (same code as live)
                              │                     │ execution_simulator (fees, spread, impact, latency,
                              │                     │ partial fills, gaps, stop-before-TP)
                              ▼                     ▼
                    metrics (Sharpe CI, DSR, PBO) ► strategies/tournament (promotion, correlation)
                              │
                              ▼
                    backtest/monte_carlo ─► reporting ─► artifacts/research/*  ─► deployment gate
                                                                                  
                 ┌──────────────── live / paper path ─────────────────────┐
 live public  ─► data/ingestion (tickers, observed order books, closed candles, latency, clock)
 market data       │
                   ▼
            execution/engine.TradingEngine.step()
              ├─ monitoring/health  ─► risk/circuit_breaker (stale data, latency, clock, DB, errors)
              ├─ paper_broker.on_market (resting SL/TP, OCO)       ┐
              ├─ operator commands (DB queue from dashboard)      │ every state change:
              ├─ position mgmt (trailing, time stops, protection) │ StateStore transaction
              ├─ strategies ─► Signal ─► RiskManager ─► OrderManager ─► Broker (Paper | CCXT)
              └─ mark-to-market ─► drawdown breakers ─► flatten  ┘
                   │
                   ▼
            SQLite (WAL): orders, fills (journal), positions, account, trades, risk_state, risk_events,
                          processed_signals, execution_events, control_commands, audit_log, heartbeat
                   ▲
 dashboard/backend (FastAPI, JWT, rate limits, WS) ◄──► dashboard/frontend (React + TS + Plotly)
```

## Key design decisions

| Decision | Rationale |
|---|---|
| **Bar-close timestamp convention** (`core/types.py`): research frames are indexed by bar *close* time; orders decided at close `t` fill at the next bar's open. | Makes causality mechanical; enforced by `tests/unit/test_strategy_causality.py` (recompute on truncated history must equal full-history values). |
| **Vectorised causal signals + event-driven execution** | Signals are computed once per parameter set (fast grid search); fills, stops, funding, risk and circuit breakers are simulated bar-by-bar in strict event order. Live trading reuses the same `compute()` on a trailing window and reads only the last closed row. |
| **One RiskManager for backtest and live** | Research results reflect the exact sizing and limits that would apply live. Every entry path calls `RiskManager.evaluate`, which fails closed on any exception. |
| **One Ledger for backtest and paper** | Identical PnL / fee / funding arithmetic in research and paper trading. |
| **Per-strategy sub-accounts in one cash pool** | Attribution per strategy; exposure limits aggregate per symbol. Exchange reconciliation compares *net* per-symbol quantities (one-way mode). |
| **Deterministic client order ids** (`sha256(intent)`), with a revision counter for protective orders | Retries after timeouts can never duplicate orders; a cancelled/rejected stop can still be replaced. |
| **Fill journal is the source of truth**; positions table is a cache | Restart recovery replays the append-only fills table and halts on any mismatch (`execution/reconciliation.py`). |
| **Halt persisted before acting**; dashboard writes the halt directly to the DB | A kill switch is effective even if the engine is down; the engine adopts any externally persisted halt each step and can only clear it via an audited, identified `resume`. |
| **Regime thresholds calibrated on training data only** | `RegimeDetector.fit()` freezes quantile thresholds; `classify()` is causal with hysteresis and a NEUTRAL state. |
| **In-house indicators** instead of `pandas-ta` | `pandas-ta` maintenance is uncertain; all formulas are standard (Wilder smoothing) and unit-tested. |
| **Capped inverse-vol / regime allocation, no mean-variance** | OOS return estimates are too noisy for mean-variance; caps prevent concentration. |
| **SQLite (WAL, `synchronous=FULL`)** | Sufficient for a single-node engine; all writes transactional. Postgres would be the next step for multi-process scale. |
| **Polling (REST) market data** rather than exchange WebSockets | The development proxy does not support WebSocket upgrades to exchanges; polling at 5 s is adequate for 15m+ strategies. |
| **Instrument model: linear USDT perpetual priced on spot OHLCV** | Allows symmetric long/short with real funding; spot–perp basis is not modelled (documented limitation). |

## Module map

| Package | Responsibility |
|---|---|
| `config/` | Pydantic-validated YAML (risk, strategies, exchanges) + env secrets; config hash; fail-closed mode resolution |
| `data/` | CCXT factory (proxy-aware), paginated/incremental downloads, Parquet cache + SQLite index, integrity validation, order-book analytics, live feed, DB schema |
| `regime/` | indicators, regime detector, regime-aware allocator, optional GMM cross-check |
| `strategies/` | interface, 4 alpha engines, registry, tournament/promotion |
| `portfolio/` | correlation diagnostics, risk contributions, capped inverse-vol, regime weight arrays |
| `backtest/` | event engine, execution simulator, walk-forward, metrics/DSR/PBO, Monte Carlo, benchmarks, reports |
| `risk/` | sizing (fixed-fractional, volatility-adjusted, gated fractional Kelly, correlation-aware), limits, stops, circuit breakers, kill switch, manager |
| `execution/` | broker abstraction, paper broker, CCXT broker, order manager, state store, reconciliation, recovery, trading engine |
| `dashboard/` | FastAPI backend (auth, controls, WS) and React frontend |
| `monitoring/` | structured JSON logging with secret redaction, health states, alerts, runtime metrics |

## Strategy interface

`Strategy.compute(MarketData, params) -> {symbol: frame}` with columns
`entry, exit_long, exit_short, stop_dist, tp_dist, trail_dist, confidence, hold_bars, close`.
`Strategy.fit(train)` estimates training-only quantities (funding thresholds, hedge ratios, cointegration
diagnostics). `Strategy.signals_at()` converts a row into `Signal` proposals. Strategies have no access to
brokers, account state or the order manager.
