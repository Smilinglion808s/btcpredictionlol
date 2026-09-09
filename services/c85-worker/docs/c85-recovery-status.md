# C85 recovery and serving-state status

Generated 2026-09-08 (UTC), sandbox after the second workspace replacement.
Machine-readable companion: `docs/c85-serving-inventory.json`.

Scope of this document: what is *proven present right now*, what is only a
*claim in a manifest*, and what the boundary path still cannot do. No stage was
re-run and no historical rebuild was started while producing it.

## 1. Concurrency check

No rebuild process was running at the start of this turn (`ps` showed no
`continuation`, `setup_workspace` or python job). Nothing was deleted or
overwritten; the only writes were the cache symlink, this document, the
inventory JSON and `reproduction/link_durable_cache.sh`.

## 2. Durable storage: evidence and limits

`/mnt/documents` is a cloud object-store mount (FUSE, backed off-sandbox,
exposed inside the sandbox at `/tmp/r2-documents-mount`, 32 GB quota).

Evidence it is genuinely independent of the sandbox, not just a folder:

- Files written in **July and August 2026** (e.g. `btc15m_predictions.csv`,
  mtime 2026-07-01T20:58Z) are still present and readable after many sandbox
  replacements. Copied into a clean directory: sha256
  `20ae2daf…c3c1b67b`, identical to the source read.
- Content written by the **previous turn at 21:59Z**, in a sandbox that has
  since been replaced (`/dev-server` lost its `evaluation-fixtures/cache`
  symlink and every installed python package), is still present:
  1.60 GB / 2,110 files under `/mnt/documents/.lovable/c85-cache`.
- Round-trip write/read probe: 4 KiB random file, sha256
  `624a7cac…92f1fa1b` identical on write-back read.

Limits, stated plainly:

- This proves *readability and survival of one sandbox replacement*. It is not
  a vendor durability guarantee, and it is not versioned or snapshotted.
- **The Railway worker cannot read this mount.** It is a Lovable-side document
  store only. Serving artifacts and checkpoints for Railway need either a
  Railway persistent volume or a private object bucket with credentials.
  That is an open action item (section 7), not something already in place.
- `reproduction/link_durable_cache.sh` re-points
  `services/c85-worker/evaluation-fixtures/cache` at the durable root and must
  be run first after every sandbox reset, before `setup_workspace.sh`.

## 3. What actually survives

Proven present (path, size, hash in the inventory JSON):

| Group | Detail |
|---|---|
| Recovery archives (`/mnt/user-uploads`, read-only) | `C85_Upstream_Recovery.zip` 243.0 MB `006ada71…`; `C85_Ancestor_Recovery.zip` 83.2 MB `664775d4…`; `C85_Lovable_Kit.zip` 58.8 MB `436f1dc8…` (`-2` copy byte-identical); `T5_BASELINE_R4_1_FREEZE_PACKAGE.zip` `b2b6a072…`; `HTF_STRUCTURE_R3_PACKAGE.zip` `4ee509fd…`; `C85_Expanded_Handoff.md` `b3a90a9d…` |
| Durable cache | `upx/` unpacked upstream + ancestor recovery, 1,751 files / 984 MB; `binance_spot_1s_archives/` 243 daily zips / 580 MB (2026-01-01 → 2026-08-31); `c85root/` partially rebuilt lab root, 116 files / 159 MB |
| Fitted artifacts (tracked in git, `services/c85-worker/artifacts`) | `feature_order.json` `3a47d8dc…`; C71_DIRECTION 198 heads 2026-02-15→**2026-08-31**; C85_META 190 heads 2026-02-23→**2026-08-31**; auxiliary 36 bundles 202503→**202608**; C51 direction 245 / meta 216 states through **2026-08-31** |

Claims only — **not** backed by files right now:

- Every `continuation/manifests/*.json` stage record (binance_events,
  structure_valid, c37, c42, c51_rebase, c51_target_native, r4_1, r5_phase4,
  kalshi_t5, polymarket_*, c36_*). Each names output CSVs under the cache;
  **zero of those output paths exist** (verified per-path in the inventory
  JSON, `cache_outputs_present: []`). The manifests record that the work once
  ran and with what cursor/row count; they are not evidence of current data.
- Therefore: the historical parity result (19,487 opportunities / 6,794 calls /
  4,083 wins / 2,711 losses / +1,372 raw, zero decision mismatches) stands as a
  previously verified result, but the derived tables behind it must be
  regenerated before any September continuation is produced.
- No `continuation/checkpoints/` and no worker `C85State` checkpoint exists
  anywhere. Serving state is currently: fitted files only, no runtime state.

## 4. Minimal complete serving bundle

What a one-process Railway boundary engine must carry. Status is what is
present today.

| Component | Source of truth | Status |
|---|---|---|
| Dependency code (leaf → C42 → C51 → C54 → C71/C85 policy) | `src/experts/*`, `src/c85/original_policy.py`, `src/engine.py`, `src/features.py` | present, ported |
| Fitted preprocessing + coefficients, C71 direction heads | `artifacts/models/C71_DIRECTION` | present, **cutoff 2026-08-31** |
| C85 correctness heads | `artifacts/models/C85_META` | present, **cutoff 2026-08-31** |
| Auxiliary LONG/RECENT monthly bundles | `artifacts/models/auxiliary` | present, **through 202608** |
| C51 expert states (direction + correctness, trailing 768/side rank history) | `artifacts/c51` | present, **cutoff 2026-08-31T23:45Z**, daily 96-row refits from 09-01 unreplayed |
| Other leaf/expert states (c30, c36 frontier + timing, c37, r4/r5, external direction & rank, mean_135_rank, structure_valid) | ported code + their own inputs | code present, **no September inputs**; all recovered ledgers stop 2026-08-31 |
| Bounded feature buffers (1s/5m Binance, Kalshi t5, Polymarket pre-open book) | `src/feeds.py` collectors | code present, not running, no watermarks |
| Both rank families (768/side queues, 96 minimum, midrank-excluding-self) | `src/state.py::RankFamily` | implemented, **no populated queues** |
| Deterioration state (EWMA16/128, init 0.60, 128-settlement warmup) | `src/state.py` | implemented, **no populated state** |
| Unresolved outcomes + settlement dedupe/cursor | `src/store.py` (`unconsumed_settlements`, `consume_settlements`) + backend tables | implemented, empty |
| Source watermarks | `src/feeds.py::watermarks` | implemented, empty |
| Model/checkpoint IDs and compatibility | `src/config.py` MODEL_VERSION, `store.checkpoint_payload` | implemented, no checkpoint written yet |

Truly unimplemented (code, not just data): the boundary compute body itself —
see section 5. Everything else above exists as code and fails closed.

## 5. Boundary and startup path

`src/main.py` at commit `80940583` (the GitHub main read as
`8094058316d08763c1ef333ca74172d67a8a6141`):

- `Worker.on_boundary` resolves the ticker, evaluates readiness, acquires the
  fenced scheduler lease, stamps `compute_started_ns` — and then
  `raise NotImplementedError("C85_PIPELINE_INCOMPLETE: …")` at line 119. There
  is **no packet assembly, no expert evaluation, no head scoring, no policy
  step, no state update, no checkpoint save and no dispatch** on the live path.
  Historical parity was produced by the offline reproduction scripts, not by
  this function.
- `evaluate_readiness()` fails closed in order: stale feeds → experts not
  connected → `ALLOW_LIVE_PUBLICATION=false`. In this sandbox it returns
  `BLOCKED :: C85_EXPERTS_NOT_CONNECTED`, with 12 concrete per-dependency
  reasons (captured in the inventory run):
  - `c51_prediction: RESTORED_STALE` — states end 2026-08-31T23:45Z; the daily
    96-row refits from 2026-09-01 must be replayed, and their September inputs
    (Binance event features, Polymarket pre-open rows, settled labels, C42
    ledger) are not in the supplement.
  - the eleven leaf columns (`c30_prediction`, `c36_prediction`,
    `c37_prediction`, `r4_*`, `expansion_selected_prediction`,
    `external_direction`, `external_rank`, `mean_135_rank`, `structure_valid`)
    are `REPRODUCED` historically but have no September inputs and, for
    `external_direction`, no vendored live feature build.
- Startup (`WarmupCoordinator`, stages INIT→VERIFY→SEED→BRIDGE→FITTING→READY)
  restores the newest checkpoint or the historical seed. With no checkpoint
  present anywhere, startup would fall to the seed and then BRIDGE would have
  to rebuild the whole gap — the exact behaviour the one-process design must
  avoid. Checkpoint gap: nothing has ever written a `C85State` checkpoint.

Conclusion: historical parity is not evidence of a functioning boundary path.
The live path has never produced a decision.

## 6. Retention map for ongoing fitting

Preserving original source semantics; do not collapse these to one window.

| Component | Training window | Refit schedule | Where it must live |
|---|---|---|---|
| C51 direction / correctness heads | trailing **8,640 rows** per fit | daily, 96 rows per UTC day | rolling 8,640-row training frame kept durably outside serving memory; serving carries only fitted state + 768/side rank queues |
| C71 direction head | trailing **8,640 rows** | daily UTC block | same |
| C85 correctness (meta) head | trailing **8,640 rows** | daily UTC block | same |
| Auxiliary `LONG` | **expanding** full history from 2025-12-01 | monthly | full labelled history must be retained durably — this is the component that forbids a 90-day-only store |
| Auxiliary `RECENT` | trailing **90 days** | monthly | derived from the same durable history |
| Rank families | trailing **768 finite scores per side**, per family | continuous | serving memory + checkpoint |
| Deterioration | EWMA16 / EWMA128 over settled base calls, 128-settlement warmup | continuous | serving memory + checkpoint |

Implication: training history is a durable dataset (grows without bound for
LONG); serving state is bounded and checkpointable. These are two different
stores, and the Railway process must only hold the second.

## 7. Blockers requiring your action

1. **Railway-readable durable store.** `/mnt/documents` is Lovable-side only.
   To ship artifacts/checkpoints and the LONG training history to the worker we
   need either a Railway persistent volume mounted at a known path, or private
   bucket credentials added as Railway/Lovable secrets (S3-compatible endpoint,
   bucket, key id, secret, region). Name the choice and I will wire it; no
   credentials will be printed or echoed.
2. **September continuation inputs.** The September Polymarket checkpoint you
   mention (696 outcomes, pre-open rows through 2026-09-08T06:00Z, 693 valid)
   is required. Please transfer it under an exact name; also needed, if you
   hold them, are September Kalshi settled outcomes and any C42 September
   ledger. Without them the C51/C71/C85 daily refits from 2026-09-01 cannot be
   replayed and no September decision may be emitted.

## 7b. Next bounded executable step (revised after this task)

Port the **fitted external-direction pipeline** (preprocessing, imputation,
scaling, feature order and coefficients for the selected
`BINANCE_HYPERLIQUID`, `C=0.03` T0/T5 stages) and wire the two ported raw
producers into it, so one real external-direction score can be produced from
raw feed input and checked against the archived stage output on the overlap.
That is the smallest step that turns two raw producers into one genuine live
leaf input; it needs no September data and no rebuild. Regenerating the wiped
`evaluation-fixtures/upstream/*.parquet` from their surviving CSV sources
(section 8.3) can ride along with it.

## 8. Live raw-input producers (update, this task)

| Producer | Status | Evidence |
|---|---|---|
| Binance spot/UM raw aggTrade window aggregation | **PORTED (raw), now collector-safe** — `src/experts/binance_windows.py` | Transcribed from recovered `build_multivenue_features_r1.py` (sha256 `c3acb1ea58fd77d36f49aef870ec3c0d230e949c47fb329820de752a99d2b446`). Parity asserted against the ORIGINAL source executed from its own AST over authentic publisher aggTrade archives (spot 46,763 rows, UM 70,782 rows, 2026-01-02 00:00–02:00Z). `tests/test_binance_windows_parity.py` + `tests/test_binance_transport.py`: 40 passed. |
| Hyperliquid context features | **PORTED (raw)** — `src/experts/hyperliquid_context.py` | Transcribed from `build_hyperliquid` (lines 399-477) of the same builder. Parity is against the ORIGINAL producer's own archived output using authentic API inputs — see below. `tests/test_hyperliquid_context.py`, 19 passed. |
| `directional_matrix` | derived transform only — `src/experts/direction_matrix.py` | Consumes already-built venue columns; it is NOT raw-feed inference. |
| Deribit raw window producer | **NOT REQUIRED** | The recorded selection is `BINANCE_HYPERLIQUID` for both stages and no Deribit term appears in `phase3_external_feature_coefficients.csv`. Porting it would add an input the fitted model does not use. |
| Fitted direction pipeline + venue-set selection | **UNPORTED** | Blocks a live leaf score even with complete raw windows. |
| Remaining eight leaf producers | **UNPORTED** | `src/experts/leaf.py::LeafExperts.evaluate` still only passes upstream fields through and fails closed. |

### 8.1 Binance transport safety (this task)

The previous implementation inferred the timestamp unit from the *venue*, which
is wrong for live input. Measured, not assumed (probe JSON:
`/mnt/documents/.lovable/c85-cache/transport_probes/binance_timestamp_units.json`):

| Transport | Observed unit |
|---|---|
| spot daily aggTrades CSV | microseconds |
| um daily aggTrades CSV | milliseconds |
| spot REST `/api/v3/aggTrades` | milliseconds (13 digits, observed) |
| um REST `/fapi/v1/aggTrades` | milliseconds (13 digits, observed) |
| spot WS `btcusdt@aggTrade` | milliseconds (13 digits, observed) |
| um WS `btcusdt@aggTrade` | **not observed** — websocket egress to `fstream.binance.com` times out from this sandbox. Declared ms from the UM REST observation and the shared schema; the adapter's plausibility band rejects the value outright if that is ever wrong. |

Fixed with explicit `Transport` adapters carrying unit + schema + provenance:

- Strict parsing. `bool("false")` is `True` in Python; a malformed boolean,
  non-finite number or reversed trade-id range now raises `TransportError`
  instead of silently deciding a trade's side.
- A mis-declared unit is caught by a plausibility band, not shifted into 1970.
- Authentic `agg_trade_id` is preserved on archive ingestion
  (`read_binance_archive_raw`), so archive/live overlap and repeat ingestion are
  idempotent, and same-timestamp ordering is deterministic by `(ts_us, id)` —
  proved order-invariant against shuffled receipt and restart replay.
- Availability is explicit: `HISTORICAL` (event-time replay, no availability
  filter) vs `LIVE` (only rows whose receipt precedes the freeze). Unknown
  receipt is **excluded and counted** in LIVE, never admitted. REST bootstrap
  rows carry the recorded arrival instant of their response; no per-event
  receipt time is invented.
- Continuity: recorded disconnect/reconnect gaps invalidate an overlapping
  target; warm-up uses recorded coverage start, so a pruned buffer cannot look
  warm; pruning honours `pending_targets` and never drops a pending target's
  inputs.

### 8.2 Hyperliquid parity (this task)

Why this venue: `C30_C70_LAB_MANAGER_R2.json` resolves
`external_direction_selection/T0` and `/T5` to `source_set=BINANCE_HYPERLIQUID`,
`c_value=0.03`.

Parity is real, not synthetic. Authentic `api.hyperliquid.xyz/info` responses
(`candleSnapshot` 15m/1h, `fundingHistory`, coin BTC; 1,441 + 361 + 360 rows,
saved with manifest at `/mnt/documents/.lovable/c85-cache/hyperliquid_samples/`)
were fed through the transcription and compared to the original producer's own
archived output `hyperliquid_context_features.csv.gz`:

- **1,152 overlapping targets, all 19 columns, 0 missing-data-pattern
  mismatches, max absolute difference 1.85e-13** (CSV float round-trip).

The causal flags that differ between the two joins are preserved and tested:
hourly joins backward with `allow_exact_matches=True`, funding backward with
`allow_exact_matches=False` (strictly before T). A single pandas-version
adjustment was needed — `to_datetime(unit="ms")` now returns `datetime64[ms]`,
which cannot `merge_asof` against the nanosecond grid — so resolution is pinned
to ns via `_ns()`. Instants are identical; no rule, rounding or ordering
changed.

Not obtained: historical L2 order book. The acquisition audit records
`historical_l2_status: not_downloaded_requester_pays`. Nothing here substitutes
for it.

Archive provenance limits: publisher archives carry exchange event time only,
no collector receipt time. `VenueBuffer` stores `receipt_ns = -1` for
archive-seeded rows and applies receipt-based availability filtering only to
rows with a real receipt timestamp. Raw data + checksums:
`/mnt/documents/.lovable/c85-cache/binance_aggtrades/MANIFEST.json`.
Same-workspace readback proves bytes, not provider-level durability.

### 8.3 Pre-existing failures unrelated to this task

`tests/test_upstream_ledgers.py` (9 failures) and the two collection errors in
`tests/test_feature_*_parity.py` are caused by the sandbox replacement wiping
gitignored `evaluation-fixtures/upstream/*.parquet` and the `reliability`
package. The CSV sources for those ledgers do survive in the durable cache
(e.g. `upx/upstream/vault_work/legacy_c42/.../fee_coverage_shadow_ledger.csv`),
so they are regenerable; regenerating them was out of scope for this task and
is listed as the next step rather than reported as passing.

## 9. Persistence / timing contract (update, this task)

Fixed:

- `C85Store` now adopts the backend-assigned `checkpoint_seq` on every write
  that carries a checkpoint (`commit_decision`, `consume_settlements`), so the
  next `expected_parent_seq` is never stale. Malformed / `None` / `ok:false`
  responses, and a missing sequence when a checkpoint was sent, raise instead
  of counting as success.
- `_reconcile_commit` now requires an exactly matching, PRESENT `state_sha256`
  plus a usable `checkpoint_seq`; a checkpoint row without the hash is treated
  as unconfirmed.
- Timing is measured, not assumed: `model_input_cutoff_ns` (the immutable T+5s
  model rule) is stored separately from the scheduler's actual
  `packet_freeze_ns`, and build start/complete, send start and gateway ack are
  all recorded. `publication_offset_ms` / `deadline_met` derive from the ack.
  `c85_targets` has no ack column and the commit function rejects unknown keys,
  so the full measured set lives in the existing `feed_watermarks` jsonb under
  `"measured"`. `CUTOFF_DEADLINE_CONFLICT_MS` is labelled
  `configured_cutoff_deadline_conflict_ms` — a configured constant, never a
  measurement.
- An acknowledgement that lands at/after T+5s is recorded as EXPIRED and is
  never stamped published.
- Backend expiry enforcement: `c85_commit_decision` now inserts an outbox row
  whose `expires_at` is already past in state `EXPIRED` (database clock), and
  expires any still-PENDING row past its ceiling, so a slow transaction cannot
  leave a dispatchable stale row. The dispatch hook already refuses past T+5s.

Still open (unchanged):

- **Atomic DB lease fencing.** `c85_commit_decision` accepts no owner/fence
  token; `verify_lease` narrows but does not close the verify-to-commit race.
- **T+5 cutoff vs T+5 publication.** The last legal input may arrive at
  T+4999.999 ms while publication is due at T+5000 ms. Neither rule is changed;
  the conflict is reported, and production stays fail-closed and suppressed.
