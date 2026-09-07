# C85 continuation roadmap

Goal: extend the C85 record from 2026-08-31 23:45Z to the present and start live
prediction logging. Webhooks stay restricted to `t45-priceflow` throughout.

## Why a full rebuild
Every producer in the C85 ancestry is a rolling/expanding-window model with a
frozen `END = 2026-09-01T00:00:00Z`. The recovered `upstream_packet.parquet`
(19,487 rows, 177 columns) cannot be appended to; the chain must be re-run over
its whole history with the end constant advanced.

## Stage status

| Stage | Inputs | Status |
| --- | --- | --- |
| Binance event features | spot + UM aggTrades, 2025-12-01 -> 2026-09-06 (560 daily archives) | DONE - 26,881 rows x 389 cols, continuous, cached |
| Kalshi KXBTC15M inventory + T+5 trades | Kalshi historical/live endpoints, 2026-02-06 -> 2026-09-06 | DONE - 20,055 markets, 519,899 eligible trades, cached |
| Binance kline directory (1m/1s/5m) | binance.vision | PARTIAL - September only; full history outstanding |
| C42 ledger | `C42_MATURATION_CONSENSUS_R1` | TODO |
| C51 ledger | Polymarket CLOB preopen book + outcomes + repo parquet + C42 ledger | TODO - needs Polymarket re-acquisition for September |
| C54 ledger | C42 + C51 ledgers | TODO |
| C57 packet | kalshi markets, binance features, kline dir, C42/C51/C54 ledgers | TODO |
| C61 confirmed extension | C57 + C58 development ledger + market prior | TODO |
| C63 source correction | C61 | TODO |
| C67 trade-side / C68 quote / C69 index | C63 + Binance reference data | TODO |
| C71 direction package | C63..C69 | TODO |
| C85 heads (C71_DIRECTION, C85_META, auxiliary monthly) | C71 + packet | TODO |
| Worker live start | fresh state + next valid boundary | BLOCKED on the above |

## Known data gaps (not recoverable, to be recorded, never fabricated)
- 2026-09-03 07:00Z - 08:45Z: Kalshi listed no KXBTC15M market for 8 consecutive
  intervals. Confirmed against both `markets` and `historical/markets`.
- 2026-09-07: Binance daily archives for the current UTC day are not published
  yet, so 2026-09-07 boundaries cannot be backfilled until the archive lands.
- 301 intervals across 2026-02-06 -> 2026-09-06 have no listed market at all.

## Cached artifacts
`services/c85-worker/evaluation-fixtures/cache/continuation/`
- `binance_event_features.csv.gz` (sha256 in `binance_feature_audit.json`)
- `KXBTC15M_MARKETS.csv.gz`, `KXBTC15M_T5_EARLY_PRIOR.csv.gz`
- `kalshi_trade_cache.tar.gz` (per-ticker raw API pages, 20,135 tickers)
- `KALSHI_KXBTC15M_T5_EARLY_PRIOR_ACQUISITION_R1.json`
