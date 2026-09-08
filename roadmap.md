# C85 continuation roadmap

Goal: extend the C85 record from 2026-08-31 23:45Z to the present and start live
prediction logging. Webhooks stay restricted to `t45-priceflow` throughout.

## Why a full rebuild
Every producer in the C85 ancestry is a rolling/expanding-window model with a
frozen `END = 2026-09-01T00:00:00Z`. The recovered `upstream_packet.parquet`
(19,487 rows, 177 columns) cannot be appended to; the chain must be re-run over
its whole history with the end constant advanced.

## Stage status (research end configurable; current run END = 2026-09-08T00:45Z)

| Stage | Inputs | Status |
| --- | --- | --- |
| Binance event features | spot + UM aggTrades, 2025-12-01 -> 2026-09-07 | DONE - 26,976 rows x 389 cols, 0 intervals without trade data |
| Kalshi KXBTC15M inventory + T+5 trades | Kalshi historical/live endpoints, 2026-02-06 -> 2026-09-07 23:45Z | DONE - 25,261 markets crawled, 20,150 in window, 526,191 eligible trades, 301 NO_MARKET intervals, 0 rejected records |
| Live-day recovery | Binance REST aggTrades | DONE - current UTC day rebuilt in archive layout; feature parity vs published archive verified (190 cols, 0 mismatches) |
| Binance kline directory (1m/1s/5m) | binance.vision | PARTIAL - September only; full history outstanding |
| C42 ledger | `C42_MATURATION_CONSENSUS_R1` | TODO - next stage |
| Polymarket C42 early prior/trades | data-api.polymarket.com, keyed by C42 ledger condition_ids | TODO - blocked on C42 ledger (Kalshi history is NOT a substitute) |
| C51 ledger | Polymarket CLOB preopen book + outcomes + repo parquet + C42 ledger | TODO |
| C54 ledger | C42 + C51 ledgers | TODO |
| C57 packet | kalshi markets, binance features, kline dir, C42/C51/C54 ledgers | TODO |
| C61 confirmed extension | C57 + C58 development ledger + market prior | TODO |
| C63 source correction | C61 | TODO |
| C67 trade-side / C68 quote / C69 index | C63 + Binance reference data | TODO |
| C71 direction package | C63..C69 | TODO |
| C85 heads (C71_DIRECTION, C85_META, auxiliary monthly) | C71 + packet | TODO |
| Railway artifact + checkpoint deploy, restart-resume proof | completed heads | TODO |
| Worker live start | fresh state + next valid boundary | BLOCKED on the above |

## Resumability
Each stage writes `evaluation-fixtures/cache/continuation/checkpoints/<stage>.json`
holding the progress cursor, row count and audit notes. `continuation.cli status`
reports cutoffs; `advance` skips completed prefixes, so a restart or a new
quarter-hour never triggers a full-history rebuild.

## Known data gaps (recorded, never fabricated)
- 301 quarter-hours in 2026-02-06 -> 2026-09-07 had no listed KXBTC15M market
  (confirmed against both `markets` and `historical/markets`). Recorded as
  NO_MARKET, distinct from fetch failures; 0 fetch failures and 0 rejected
  time/block records this run.
- Binance futures live search window is limited to the recent 2 days, so live
  vs archive parity for UM is proven over the fetchable slice (88 of 96
  intervals of 2026-09-06); spot is proven over the full day.

## Cached artifacts
`services/c85-worker/evaluation-fixtures/cache/continuation/`
- `binance_event_features.csv.gz` (sha256 in `binance_feature_audit.json`)
- `KXBTC15M_MARKETS.csv`, `KXBTC15M_T5_ALL_PRIOR.csv`, `KXBTC15M_T5_ALL_TRADES.csv.gz`
- `C60_KALSHI_T5_ALL_TRADES_ACQUISITION_R1.json`, `kalshi_market_page_manifest.csv`
- `LIVE_FEED_ARCHIVE_PARITY_R1.json`

