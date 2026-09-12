# C85 continuation roadmap

Goal: extend the C85 record from 2026-08-31 23:45Z to the present and start live
prediction logging. Webhooks stay restricted to `t45-priceflow` throughout.

## Why a full rebuild
Every producer in the C85 ancestry is a rolling/expanding-window model with a
frozen `END = 2026-09-01T00:00:00Z`. The recovered `upstream_packet.parquet`
(19,487 rows, 177 columns) cannot be appended to; the chain must be re-run over
its whole history with the end constant advanced.

## Stage status (research end configurable; last run END = 2026-09-08T18:30:00Z)

WARNING (2026-09-08 22:45Z): the table below is a *historical record of runs*,
not a statement about data on disk. The sandbox was replaced again and every
derived stage output named by these manifests is gone — verified per path in
`services/c85-worker/docs/c85-serving-inventory.json`
(`cache_outputs_present: []` for all 14 stages). Treat every DONE below as
"ran once and reproduced parity", never as "output currently available".
See `services/c85-worker/docs/c85-recovery-status.md` for the proven inventory,
durable-storage evidence and the boundary-path gap.

Cursors come from `continuation/manifests/_status.json` (durable, survives cache wipes).


| Stage | Cursor | Rows | Status |
| --- | --- | --- | --- |
| binance_events | 2026-09-08 18:30Z | 27,041 | DONE - archived prefix spliced verbatim, parity ok |
| kalshi_t5 | 2026-09-08 19:00Z | 25,338 | DONE |
| external_direction | 2026-09-01 | 1,027 | DONE (input-bound, frozen ceiling) |
| fee_coverage / fixed_floor / c30 | 2026-09-01 | 19,780 | DONE, prefix parity ok |
| phase3 | 2026-09-01 | 20,561 | DONE |
| c36_timing / c36_frontier | 2026-09-01 | 20,343 / 22,558 | DONE |
| c37 | 2026-09-01 | 19,780 | DONE |
| structure_valid | 2026-09-08 18:30Z | 27,041 | DONE - 19,487-row archived prefix exact |
| r4_1 / r5_phase4 | 2026-09-01 | 26,124 | DONE (needed r4_2 audit chain re-derived) |
| c42 | 2026-09-01 | 19,780 | DONE - 0 cell and 0 decision mismatches vs archive |
| polymarket_inventory / c51_target_native | 2026-09-08 18:30Z | 27,017 | DONE |
| polymarket_early_prior | 2026-09-01 | 8,342 | DONE (6 workers; 32 hit HTTP 429) |
| c51_rebase | 2026-09-01 | 26,304 | DONE - 0 label and 0 prediction mismatches |
| c54 | - | 0 | BLOCKED BY DESIGN - producer hard-gates on sha256 of the frozen precommit/C51/C42 ledgers; advancing them changes those hashes. Live C54 is already ported and fixture-parity clean, so this only blocks re-running the historical router. |

## Outstanding before C85 can predict live

| Item | Status |
| --- | --- |
| C51 serving heads (`artifacts/c51/{direction,meta}/*.json`) | STALE at 2026-09-01. The frozen producer emits standardized coefficients + diagnostics only, not the per-block imputation/centre/scale the serving schema needs. Route: export them from the already-reviewed `src/experts/c51.py` transcription. No fabricated fields. |
| C57 packet, C61/C63/C67/C68/C69, C71 direction, C85 heads | TODO |
| `Worker.on_boundary` live compute body | NOT IMPLEMENTED - raises `C85_PIPELINE_INCOMPLETE` (src/main.py:119). This is the next bounded step. |
| Durable store the Railway worker can read (volume or private bucket) | BLOCKED - needs a decision/credentials; `/mnt/documents` is Lovable-side only |
| Railway artifact + checkpoint deploy, restart-resume proof | TODO |
| Live start at next valid boundary, publication by T+5 | TODO |
| Webhooks | C85 stays out of `WEBHOOK_ALLOWED_MODELS`; T45 execution untouched |


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

## 2026-09-08 (late) — boundary path wired, cache-link made safe

DONE this turn (code only; no rebuild, no publish, betting still suppressed)
- [x] `reproduction/link_durable_cache.sh` rewritten: real write/read/delete
      probe of the durable root, same-filesystem refusal, per-file hash-verified
      migration, conflicting files preserved as `<name>.local-<stamp>` (never
      overwritten), source cache renamed to `<cache>.migrated-<stamp>` instead of
      `rm -rf`. Tests: `reproduction/test_link_durable_cache.sh` (24 checks).
- [x] `src/orchestration.py` — shared one-target inference orchestration;
      `Worker.on_boundary` delegates to it (`C85_PIPELINE_INCOMPLETE` removed).
      Raw packet production stays an explicit fail-closed dependency.
- [x] `src/tickers.py` — ticker verified against market metadata; unlisted
      interval fails closed instead of inventing a contract.
- [x] startup audit: a pending bridge or a missing applicable fit now BLOCKS
      readiness instead of being computed and ignored.
- [x] backend queried directly: 0 checkpoints / 0 targets / 0 settlements /
      0 outbox; Railway worker `c85-worker-amsterdam-1` heartbeats, BLOCKED on
      stale feeds.

OPEN LIVE-COMPUTATION BLOCKER
- [ ] No live producer for the nine leaf outputs. `src/experts/leaf.py`
      `evaluate()` is pass-through only; `directional_matrix` and live fitted
      inference are unimplemented. Historical REPRODUCED status is not a live
      producer. Next step: `LivePacketSource.build` for the direction head only,
      from the running Binance collectors, asserted against an archived boundary.

ACCESS GAP
- [ ] No Railway token/config in this sandbox: service settings and volume state
      could not be inspected. Runtime state reuses the existing checkpoint
      backend; no new paid resource provisioned.
