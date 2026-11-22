# Historical Data Coverage Report

Source exchange: **binance** (spot OHLCV via the public market-data endpoint). Requested start 2021-01-01; generated 2026-11-22T12:35:34.867654+00:00.

Gaps are reported and **never interpolated**; the integrity gate requires ≥ 99.5% completeness, no invalid OHLC rows and no non-positive prices.

| series | rows | first | last | missing bars | gaps | duplicates | completeness | price-jump flags | passed |
|---|---|---|---|---|---|---|---|---|---|
| BTC/USDT 15m | 206476 | 2021-01-01T00:00:00+00:00 | 2026-11-22T12:15:00+00:00 | 70 | 7 | 0 | 99.9661% | 326 | True |
| BTC/USDT 1h | 51622 | 2021-01-01T00:00:00+00:00 | 2026-11-22T11:00:00+00:00 | 14 | 7 | 0 | 99.9729% | 73 | True |
| BTC/USDT 4h | 12909 | 2021-01-01T00:00:00+00:00 | 2026-11-22T08:00:00+00:00 | 0 | 0 | 0 | 100.0000% | 9 | True |
| BTC/USDT 1d | 2151 | 2021-01-01T00:00:00+00:00 | 2026-11-21T00:00:00+00:00 | 0 | 0 | 0 | 100.0000% | 0 | True |
| ETH/USDT 15m | 206476 | 2021-01-01T00:00:00+00:00 | 2026-11-22T12:15:00+00:00 | 70 | 7 | 0 | 99.9661% | 337 | True |
| ETH/USDT 1h | 51622 | 2021-01-01T00:00:00+00:00 | 2026-11-22T11:00:00+00:00 | 14 | 7 | 0 | 99.9729% | 64 | True |
| ETH/USDT 4h | 12909 | 2021-01-01T00:00:00+00:00 | 2026-11-22T08:00:00+00:00 | 0 | 0 | 0 | 100.0000% | 5 | True |
| ETH/USDT 1d | 2151 | 2021-01-01T00:00:00+00:00 | 2026-11-21T00:00:00+00:00 | 0 | 0 | 0 | 100.0000% | 0 | True |
| SOL/USDT 15m | 206476 | 2021-01-01T00:00:00+00:00 | 2026-11-22T12:15:00+00:00 | 70 | 7 | 0 | 99.9661% | 283 | True |
| SOL/USDT 1h | 51622 | 2021-01-01T00:00:00+00:00 | 2026-11-22T11:00:00+00:00 | 14 | 7 | 0 | 99.9729% | 56 | True |
| SOL/USDT 4h | 12909 | 2021-01-01T00:00:00+00:00 | 2026-11-22T08:00:00+00:00 | 0 | 0 | 0 | 100.0000% | 7 | True |
| SOL/USDT 1d | 2151 | 2021-01-01T00:00:00+00:00 | 2026-11-21T00:00:00+00:00 | 0 | 0 | 0 | 100.0000% | 1 | True |

Gap windows are identical across BTC/ETH/SOL (exchange-wide maintenance), e.g.:

* 2021-02-11T03:30:00+00:00 → 2021-02-11T05:00:00+00:00 (5 bars)
* 2021-03-06T01:45:00+00:00 → 2021-03-06T03:30:00+00:00 (6 bars)
* 2021-04-20T01:45:00+00:00 → 2021-04-20T04:30:00+00:00 (10 bars)
* 2021-04-25T04:00:00+00:00 → 2021-04-25T08:45:00+00:00 (18 bars)
* 2021-08-13T01:45:00+00:00 → 2021-08-13T06:30:00+00:00 (18 bars)
* 2021-09-29T06:45:00+00:00 → 2021-09-29T09:00:00+00:00 (8 bars)
* 2023-03-24T12:30:00+00:00 → 2023-03-24T14:00:00+00:00 (5 bars)

'Price-jump flags' are returns beyond 12 robust (MAD) standard deviations: reported for review, not removed (crypto returns are fat-tailed; these are real moves).


## Funding rates

| symbol | rows | first | last | sources | max gap (h) |
|---|---|---|---|---|---|
| BTC/USDT | 6455 | 2021-01-01T00:00:00+00:00 | 2026-11-22T08:00:00+00:00 | {'binance_archive': 6390, 'okx_api': 65} | 8.0 |
| ETH/USDT | 6455 | 2021-01-01T00:00:00+00:00 | 2026-11-22T08:00:00+00:00 | {'binance_archive': 6390, 'okx_api': 65} | 8.0 |
| SOL/USDT | 6530 | 2021-01-01T00:00:00+00:00 | 2026-11-22T08:00:00+00:00 | {'binance_archive': 6465, 'okx_api': 65} | 8.0 |
