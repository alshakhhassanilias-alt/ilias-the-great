# quant_engine: crypto research, walk-forward validation and paper trading

A complete algorithmic-trading research and execution platform for BTC/USDT, ETH/USDT and SOL/USDT:
exchange data ingestion with integrity checks, regime detection, four independent alpha engines, an
event-driven backtester with realistic costs, strict walk-forward optimisation with Deflated Sharpe and PBO,
Monte Carlo stress testing, an independent fail-closed risk engine, a paper broker running on live public
market data, crash recovery, and an authenticated React/Plotly command-center dashboard.

> **Quantitative verdict: there is NO validated deployable strategy.** One strategy (volatility breakout) shows
> positive, cost-robust out-of-sample evidence, but it fails the pre-registered Deflated Sharpe threshold, so it is
> **research-only** (paper forward-testing allowed, live capital not). The other three are rejected.
> LIVE trading is gated off. See [OOS report](artifacts/research/OOS_REPORT.md).

## Three separate questions

| Question | Status |
|---|---|
| **Engineering complete?** | Yes for the documented scope: all modules implemented. 150 automated tests pass (147 offline + 3 live-network). Ruff and mypy are clean. 0 known dependency vulnerabilities. The TESTNET/LIVE exchange paths are implemented but **unverified** (see [limitations](docs/KNOWN_LIMITATIONS.md)). |
| **Paper-trading ready?** | Yes for short supervised runs. Verified on live public Binance data: 60–75 s smoke tests, hard-kill crash recovery, kill switch and browser-level dashboard checks. No multi-day reliability run has been done. |
| **Quantitatively validated strategy?** | **No.** No strategy passed every promotion criterion plus the frozen holdout. |

## Results (out-of-sample, net of modelled fees, spread, slippage and funding)

Data: Binance spot OHLCV, 2021-01-01 → 2026-11-22 (15m/1h/4h/1d, 99.97–100% complete; [coverage](artifacts/DATA_COVERAGE.md)).
Walk-forward: 16 windows of 12 months train → 3 months validation → 3 months test, with 7-day embargoes.
Stitched OOS span **2022-04-16 → 2026-04-16 (4.0 years)**. Final holdout **2026-05-22 → 2026-11-22**, kept untouched
until all decisions were frozen. 96 parameter configurations were tested in total, and all of them count in the
Deflated Sharpe calculation.

| Strategy | Net | CAGR | Sharpe [95% CI] | Max DD | Trades | PF | DSR | PBO | +windows | 2× costs | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A · Volatility breakout (4h) | +74.6% | 14.9% | 1.28 [0.25, 2.20] | 8.6% | 397 | 1.53 | 0.881 | 0.04 | 88% | +47.2% | **RESEARCH ONLY** (fails DSR ≥ 0.95) |
| B · Mean reversion (1h) | −25.4% | −7.0% | −1.46 [−2.64, −0.26] | 31.5% | 128 | 0.53 | 0.000 | 0.17 | 19% | −36.2% | REJECTED |
| C · MTF momentum/flow (15m) | −95.0% | −52.6% | −2.85 [−4.00, −1.76] | 95.1% | 2,500 | 0.73 | 0.000 | 0.00 | 6% | −99.9% | REJECTED (cost-dominated) |
| D · Relative strength / pairs (4h) | −4.6% | −1.2% | −0.26 [−1.18, 0.58] | 12.7% | 240 | 0.94 | 0.001 | 0.53 | 31% | −14.9% | REJECTED |
| Portfolio: non-rejected (A, regime-weighted) | +21.0% | 4.9% | 1.27 [0.26, 2.19] | 2.8% | 398 | | | | 81% | | not qualified |
| Portfolio: all four (diagnostic) | −41.3% | −12.5% | −2.00 [−3.37, −0.86] | 42.9%¹ | 3,329 | | | | 25% | | n/a |
| Buy & hold BTC / ETH / SOL | +81.4% / −23.7% / −17.7% | | 0.55 / 0.25 / 0.43 | 62.0% / 67.9% / 91.1% | | | | | | | benchmark |

¹ Each window restarts its circuit breakers. In continuous live operation the 10% total-drawdown breaker would have halted this portfolio.

**Final holdout** (single frozen evaluation): breakout +5.69% (Sharpe 1.02, DD 6.75%, 56 trades) while BTC −22.5%,
ETH −21.1%, SOL −19.6%; mean reversion −3.76%; momentum −42.1%; pairs +0.02%. The holdout was evaluated twice:
the original run, plus a code-only reproducibility re-run. Both accesses are logged in
`artifacts/research/holdout_access_log.json`, and the second run reproduced all 204 compared metrics exactly.

Strategy return correlations are low (|ρ| ≤ 0.19). No pair was cointegrated on training data, so the
spread-reversion mode correctly stayed off ([correlation report](artifacts/research/STRATEGY_CORRELATION_REPORT.md)).
The Monte Carlo has 2,000 paths × 9 scenarios on the non-rejected portfolio, labelled NOT QUALIFIED
([report](artifacts/research/MONTE_CARLO_REPORT.md)).

![OOS equity](artifacts/research/charts/oos_equity.png)

### Why nothing is deployed
Breakout passes 7 of 8 OOS checks: trades, Sharpe CI > 0, PBO, drawdown, positive windows, profit factor and
cost stress. Its Deflated Sharpe probability (0.881) is below the pre-registered 0.95. The DSR counts only the 96
grid configurations, not the design iterations, so even 0.881 is optimistic. Lowering the threshold after seeing
the result would defeat its purpose.

## Installation

Requirements: Python ≥ 3.12 (tested on 3.13), [uv](https://docs.astral.sh/uv/), Node 22 (for the dashboard build).

```bash
uv sync --frozen                            # pinned Python deps from uv.lock
cd dashboard/frontend && npm ci && npm run build && cd -
cp .env.example .env                        # PAPER by default; fill in dashboard credentials
uv run python scripts/hash_password.py      # -> DASHBOARD_PASSWORD_HASH
uv run python scripts/init_db.py            # create/verify the SQLite schema
```

## Reproduce everything

```bash
uv run python scripts/download_data.py      # ≥3y OHLCV (15m/1h/4h/1d) + funding, incremental, coverage report
uv run pytest -q                            # 150 tests (use -m "not network" offline)
uv run python scripts/run_walk_forward.py   # walk-forward + DSR/PBO + tournament + portfolios + Monte Carlo + holdout
uv run python scripts/generate_report.py    # rebuild Markdown reports from JSON (no recomputation)
uv run python scripts/render_charts.py      # rebuild charts (HTML + PNG) from saved series
uv run python scripts/run_paper_trading.py --duration 60 --poll 5 --diagnostic-probe   # paper smoke test
uv run python scripts/run_paper_trading.py --with-dashboard                            # paper + dashboard on 127.0.0.1:8000
uv run python scripts/run_backtest.py --strategy breakout --start 2023-01-01 --end 2023-12-31  # exploratory only
```
Or with `make`: `make data test walk-forward paper-smoke paper`. With Docker: `docker compose up -d`
(dashboard bound to host loopback only; the image build was not executed in this environment).

Note: `run_walk_forward.py` touches the final holdout and appends to its access log. Re-running it is a
reproducibility check, not a licence to tune.

## Verification performed (evidence in `artifacts/verification/` and `artifacts/screenshots/`)

| Test | Result |
|---|---|
| 1 · `pytest` | **150 passed**: unit, causality/leakage, property-based (Hypothesis), engine hand-calculation, risk, execution integration, adversarial, dashboard API security, live-data integration |
| 2 · Historical data | 5.9 years per symbol/timeframe; integrity gate passed for all 12 series; gaps reported, never interpolated |
| 3 · Walk-forward | Completed (16 windows × 4 strategies + portfolios + holdout); reproducible bit-for-bit across two runs |
| 4 · Monte Carlo | 2,000 paths × 9 scenarios, seeded; outputs and charts saved |
| 5 · Paper smoke test | Live Binance public data; 4 strategies evaluated on closed bars; risk decision → simulated fill on the observed book → simulated SL/TP verified → persisted; HEALTHY |
| 6 · Crash recovery | `kill -9` with an open position → restart restored position, protective orders (same IDs), cash and risk state; fill-journal replay matched; no duplicate orders |
| 7 · Kill switch | Via authenticated API: cancelled 2 orders, flattened 1 position, verified zero exposure, halt persisted; restart stayed halted and rejected entries; only an authenticated, audited resume cleared it |
| 8 · Dashboard (Playwright) | 1440/1024/390 px: 0 console errors, no horizontal overflow, charts, Monte Carlo, positions, controls; 2 defects found and fixed (re-verified) |

## Repository layout

```
quant_engine/   config · data (+exchanges) · regime · strategies · portfolio · backtest · risk · execution · dashboard/backend · monitoring
dashboard/frontend/   React + TypeScript + Plotly command center (Vite)
scripts/        download_data · run_walk_forward · run_backtest · run_paper_trading · run_dashboard · generate_report · render_charts · init_db · hash_password
tests/          unit · backtest · risk · execution · dashboard · integration
artifacts/      research reports, charts, verification evidence, screenshots, data coverage
docs/           ARCHITECTURE · SECURITY_AND_OPERATIONS · KNOWN_LIMITATIONS · CHECKLIST
```

## Documentation
* [Architecture](docs/ARCHITECTURE.md): data flow, timestamp convention, design decisions
* [Security & operations](docs/SECURITY_AND_OPERATIONS.md): modes, LIVE gate, secrets, dashboard security, runbook
* [Known limitations & unverified items](docs/KNOWN_LIMITATIONS.md)
* [Development checklist](docs/CHECKLIST.md)

**Disclaimer:** research and simulation software. Backtested, walk-forward, holdout and Monte Carlo results are
simulations under stated assumptions and do not guarantee future results. No real trades were placed.
