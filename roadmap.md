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
| Reproduction workspace restore | recovery archives + C85_Lovable_Kit | DONE - /tmp/upx normalised, nested packages expanded, /tmp/c30root imports resolve, scikit-learn installed |
| Base coverage ledgers (`continuous_coverage_ledger`, `label_stable_db1_shadow_ledger`, `t5_book_day4h_r4_1_rows`) | Kalshi inventory + T+5 trades + Binance event features | BLOCKING - absent from both recovery archives (bulk capture caches deliberately omitted); must be re-derived from cached feeds and parity-gated against `upstream_packet.parquet` (19,487 x 175) |
| C42 ledger | `C42_MATURATION_CONSENSUS_R1` | BLOCKED on base coverage ledgers (C30 -> phase3 -> C36 -> C37 chain cannot load its frame without them) |
| Polymarket C42 early prior/trades | `ancestor/data/c51_polymarket_preopen_1m.csv`, `c51_polymarket_outcomes.csv` recovered; live extension via data-api.polymarket.com | TODO - historical inputs present, extension keyed on C42 ledger condition_ids |

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
  intervals of 2026-09-06); spot is proven over the full day. The 8 unverified
  UM quarter-hours are 2026-09-06T00:00Z..01:45Z; those features came from the
  published daily archive, so this is a verification gap, not an input gap.
  Only 2026-09-07 (both venues) was built from the live REST feed.
- `continuous_coverage_ledger.csv`, `label_stable_db1_shadow_ledger.csv` and
  `t5_book_day4h_r4_1_rows.csv` are in neither recovery archive: the upstream
  collector excluded bulk capture caches by design. They must be re-derived from
  the cached Kalshi inventory/T+5 trades and Binance event features, with the
  frozen prefix parity-gated against `upstream_packet.parquet`.


## Cached artifacts
`services/c85-worker/evaluation-fixtures/cache/continuation/`
- `binance_event_features.csv.gz` (sha256 in `binance_feature_audit.json`)
- `KXBTC15M_MARKETS.csv`, `KXBTC15M_T5_ALL_PRIOR.csv`, `KXBTC15M_T5_ALL_TRADES.csv.gz`
- `C60_KALSHI_T5_ALL_TRADES_ACQUISITION_R1.json`, `kalshi_market_page_manifest.csv`
- `LIVE_FEED_ARCHIVE_PARITY_R1.json`


## C85 continuation rebuild (2026-09-08)

Harness: `services/c85-worker/continuation/` — resumable, dependency-ordered,
configurable research end (`C85_RESEARCH_END`), checkpoints under
`evaluation-fixtures/cache/continuation/checkpoints/`.

Registered stages (dependency order):
binance_events, kalshi_t5, structure_valid, r4_1, r5_phase4,
external_direction, fee_coverage_chain, c30, c36, c37, c42,
polymarket_inventory, polymarket_early_prior, c51_target_native,
c51_rebase, c54.

DONE
- [x] binance_events — 26,976 rows, cursor 2026-09-07T23:45Z (live REST recovery
      for unpublished days; live-vs-archive parity 190 cols / 0 mismatches)
- [x] kalshi_t5 — 25,261 markets, cursor 2026-09-07T23:45Z
- [x] stage modules written: stage_r4.py, stage_c42.py, stage_c51.py
      (stage_c30.py incomplete)

BLOCKED — upstream research archives lost from the sandbox
- [ ] `T5_BASELINE_R4_1_FREEZE_PACKAGE.zip` absent; `HTF_STRUCTURE_R3_PACKAGE.zip`
      truncated (no end-of-central-directory). No copy on disk or in uploads.
      `C85_Upstream_Recovery.zip` is no longer in user uploads.
      => blocks structure_valid parity, r4_1, r5_phase4, and every
         parity fixture under evaluation-fixtures/upstream/.
- [ ] fee_coverage_chain also needs the two capture caches
      (`t5_second_path_features.csv`, `label_stable_db1_shadow_ledger.csv`);
      re-derivation cannot be parity-gated until the fixtures return.

OPEN DESIGN ITEMS (not blockers)
- [ ] c51_rebase does not emit the serving-schema scaler/imputation vectors;
      must reuse the reviewed transcription in `src/experts/c51.py`.
- [ ] c54 producer is hash-gated to frozen inputs; needs a decision on how it
      advances past the freeze.

C85 IS NOT LIVE. T45 execution unchanged; C85 excluded from
WEBHOOK_ALLOWED_MODELS.
