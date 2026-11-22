# Known Limitations, Unverified Items and Open Issues

This list is deliberately explicit. "Unverified" means implemented but not exercised against the real
external system in this environment.

## Unverified integrations

| Item | Status | Reason |
|---|---|---|
| TESTNET order placement (Binance / OKX / Bybit) | **UNVERIFIED** | No testnet credentials available; `testnet.binance.vision` and Binance futures (`fapi`) return HTTP 451 and all Bybit endpoints (incl. testnet) return HTTP 403 (geo-restriction) from the build environment. |
| LIVE order placement | **UNVERIFIED by design** | No real trade may be executed during development. LIVE is gated (env flags + acknowledgement phrase + deployment gate file + ≥1 PROMOTED strategy) and the gate is currently closed: no strategy is promoted. |
| Exchange-side protective orders (`CCXTExchangeBroker.verify_protection`) | **UNVERIFIED** | Code reads open orders back from the exchange; parameter construction is unit-tested per exchange, but no exchange round-trip was possible. |
| Bybit market data | **UNVERIFIED** | Geo-blocked (HTTP 403). Adapter config exists; only Binance (public mirror) and OKX were exercised. |
| Exchange WebSocket streams | Not implemented | The environment proxy does not support WebSocket upgrades to exchanges; live data uses REST polling (5 s). Adequate for 15m+ strategies, not for latency-sensitive ones. |
| Notification webhook | Implemented, untested against a real endpoint | No webhook URL configured. Alerts are always persisted to the `alerts` table. |
| Docker image | `Dockerfile`/`docker-compose.yml` written, **image build not executed** | Building requires pulling base images; not performed in this session. |

## Modelling limitations (research)

* **Spot prices for a perpetual instrument model.** Positions are modelled as USDT-margined linear perpetuals
  (to allow shorts and real funding) but priced on Binance *spot* OHLCV. Spot–perp basis is not modelled.
* **Historical spreads are assumptions** (BTC 1 bp, ETH 1.5 bp, SOL 3 bp); historical order books are not available.
  Live paper fills walk the *observed* book. Slippage uses a square-root impact model on bar volume.
* **No historical order-book imbalance**: Strategy C's order-book filter is only active live, so backtests and live
  behaviour differ slightly for that strategy (documented in the strategy).
* **Intrabar path is unknown**: stop-before-take-profit and gap-at-open rules are conservative but cannot reproduce the
  true path. Trailing stops ratchet on completed bars.
* **Each walk-forward window starts flat with fresh capital**; positions are closed at window boundaries (costs charged).
  This avoids leakage but slightly understates holding periods of long trends.
* **Funding**: Binance USD-M archive (2021-01 → 2026-10) plus OKX for the current month (exchange mix labelled by
  `source`). Paper trading does not accrue funding (spot-like paper accounting).
* **Kelly sizing** is implemented and gated but inactive in all research runs: no strategy accumulates the required
  ≥ 100 trades with a stable estimate *inside a single window*, so fixed-fractional sizing is used (by design).
* **Regime allocation in the combined portfolio** scales each strategy's risk; the portfolio is evaluated on a 15-minute
  clock while per-strategy research uses each strategy's own timeframe clock, so combined and standalone results are not
  additive.
* **Monte Carlo** resamples historical OOS outcomes; it cannot represent regimes never observed in 2022–2026.
* **Multiple testing**: DSR counts all 96 grid configurations across the 4 strategies, but not the *design*
  iterations made by the developer (e.g. adding the cost filter to Strategy C after seeing in-sample cost drag). The
  true number of trials is larger than 96; DSR is therefore optimistic, not conservative.
* **Holdout accesses**: the final holdout was evaluated twice — run 1, and a reproducibility re-run after code-only
  refactors (no strategy, parameter grid or promotion-criterion changes). Both are recorded in
  `artifacts/research/holdout_access_log.json`.

## Operational limitations

* 60–75 s smoke tests and short crash/kill-switch tests verify functionality, **not** long-run reliability. No
  multi-day paper run has been performed.
* SQLite is single-node; a multi-process deployment (engine + separate dashboard) shares the DB file via WAL. A
  server-grade database would be needed for higher write concurrency.
* The paper engine evaluates strategies on bars fetched by REST; if the process is down at a bar close, that bar's
  entry signals are *expired* (not traded late) on restart — by design.
* The dashboard's live rolling Sharpe needs ≥ 30 five-minute returns and shows an explicit "insufficient history"
  message before that.
* The diagnostic probe is a test instrument (clearly labelled `diagnostic_probe`); it is only enabled with
  `--diagnostic-probe`.
* The frontend bundle is large (Plotly ≈ 4.7 MB, 1.4 MB gzipped), loaded only after login.

## Quantitative status (see artifacts/research/OOS_REPORT.md)

No strategy met every promotion criterion. The volatility-breakout strategy is the only candidate with positive,
cost-robust OOS evidence but it fails the Deflated Sharpe threshold and is therefore **research-only**: it may be
forward-tested in PAPER, but must not receive live capital. The other three strategies are rejected.
