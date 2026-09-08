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

## 8. Next bounded executable step

Implement `Worker.on_boundary` end-to-end against the already-ported components
— packet assembly, `LiveExpertChain.evaluate`, head scoring, `C85State` policy
step, checkpoint write, suppressed (non-betting) dispatch — and prove it on a
single replayed historical boundary drawn from the reference window, with a
restart in the middle showing identical output and no duplicate dispatch. That
is code work only: it needs no September data and no new rebuild, and it
converts "historically reproducible" into "has a working boundary path".
