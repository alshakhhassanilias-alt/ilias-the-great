# Monte Carlo Stress-Test Report

Portfolio simulated: **research_all_strategies** (NOT QUALIFIED — no strategy was promoted; simulated to characterise risk only).

Paths per scenario: 2000, seed 20240601, horizon ≈ 1 year (365 days / 815 trades). Ruin = equity ≤ 50% of start; daily breach = a day (or trade) losing ≥ 3%; total breach = drawdown ≥ 10%.

> Monte Carlo resamples *historical OOS* outcomes under explicit assumptions. It does not guarantee future results.

| scenario | terminal_equity_median | terminal_equity_p05 | terminal_equity_p95 | max_drawdown_median | max_drawdown_p95 | prob_daily_dd_breach | prob_total_dd_breach | prob_ruin | prob_loss |
|---|---|---|---|---|---|---|---|---|---|
| block_bootstrap | 0.873 | 0.781 | 0.993 | 14.97% | 23.05% | 0.00% | 86.05% | 0.00% | 95.75% |
| volatility_shock | 0.872 | 0.774 | 0.997 | 15.35% | 23.66% | 0.00% | 85.80% | 0.00% | 95.15% |
| trade_bootstrap | 0.846 | 0.763 | 0.939 | 16.92% | 24.60% | 0.00% | 93.75% | 0.00% | 99.60% |
| trade_shuffle | 0.844 | 0.769 | 0.924 | 17.34% | 24.22% | 0.00% | 96.25% | 0.00% | 99.80% |
| consecutive_losses | 0.546 | 0.498 | 0.599 | 46.42% | 50.87% | 0.00% | 100.00% | 7.40% | 100.00% |
| slippage_x3 | 0.663 | 0.598 | 0.735 | 34.18% | 40.56% | 0.00% | 100.00% | 0.00% | 100.00% |
| fees_x2 | 0.717 | 0.647 | 0.794 | 28.98% | 35.83% | 0.00% | 100.00% | 0.00% | 100.00% |
| liquidity_crunch | 0.779 | 0.702 | 0.863 | 23.12% | 30.34% | 0.00% | 99.75% | 0.00% | 100.00% |
| gap_risk | 0.803 | 0.720 | 0.897 | 20.99% | 28.70% | 0.00% | 99.00% | 0.00% | 100.00% |


Scenario definitions:
* **block_bootstrap** — stationary block bootstrap of 1462 OOS daily returns, mean block 10
* **volatility_shock** — block bootstrap with 1.75x dispersion in one random 30-day block per path
* **trade_bootstrap** — iid bootstrap of 3265 OOS trade returns
* **trade_shuffle** — random permutation of trade order
* **consecutive_losses** — bootstrap with an injected streak of 164 worst-5% losses
* **slippage_x3** — slippage+spread cost tripled (extra 2x charged)
* **fees_x2** — fees doubled
* **liquidity_crunch** — +25 bps per side on a random 20% of trades
* **gap_risk** — 3% of losing trades gap through the stop to 3x their loss


![monte carlo](charts/monte_carlo.png)
