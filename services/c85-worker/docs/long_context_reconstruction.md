# T0_LONG_CONTEXT_R1 (`ALL_HGB`) reconstruction status

Scope: the producer of `external_probability_green`, which the leaf contract
turns into `external_direction` / `external_rank`. This is **not** the c30/c70
`BINANCE_HYPERLIQUID` model; that is a separate producer over separate
features and is never substituted here.

## Done this turn

| Item | Evidence |
| --- | --- |
| Feature selection transcribed (`feature_sets`, `feature_columns`) | `tests/test_long_context_head.py::test_selection_matches_the_recovered_original_function` executes the **original** `feature_sets` out of the recovered `long_context_model.py` and requires an identical selection dict |
| Frozen settings pinned | `WINDOW=17280`, `MINIMUM=5760`, `REFIT_EVERY=96`, HGB `lr .025 / max_iter 70 / max_leaf_nodes 7 / min_samples_leaf 256 / l2 50.0 / random_state 0`; asserted, never searched |
| Batch loop transcribed | `walk_forward_probability` mirrors `walk_forward_hgb`, including complete-row training filter, non-zero finite label filter, `day_balanced_weights`, and NaN for every non-scored row |
| One-target incremental head | `LongContextHead.observe` / `settle_label`; equals the batch loop row-for-row on a fixture (`atol=0`), same fit count, same first-fit timestamp |
| Fail-closed behaviour | no fit or incomplete row returns `None` (never 0.5); a packet missing feature columns raises rather than imputing |
| Thread pinning | `src/runtime_env.py`; measured 13.29 s -> 0.119 s per fit (110x) after pinning OpenMP to one thread |

8 tests pass (`tests/test_long_context_head.py`).

## Blocker: no fitted state and no feature frame

Neither of these exists anywhere in the recovered tree:

* `external_research/long_context_features.pkl` -
  sha256 `8618768fbdc0e776d8eadb7b0feb2c33625363edc8e8bf30b3f91633371fe1ca`,
  23,328 rows x 545 columns (543 features), 2026-01-01T00:15Z .. 2026-09-01T00:00Z
  (per `long_context_feature_audit.json`).
* any serialised `T0_LONG_CONTEXT_R1` head. Only freeze metadata, descriptive
  CSVs and audits were recovered under `long_context_output/`.

Because the walk-forward head is refit from raw history rather than carried
forward, **the frame is the dependency, not the pickle**. It is rebuildable
from public data with no missing-field risk:

* producer: `external_research/build_long_context_features.py`
* acquisition: `external_research/download_binance_context_2026.py`,
  `https://data.binance.vision/data`, SHA256-checked per archive, writing
  `binance_context_2026/` + `manifest.csv`
  (`source_manifest_sha256 6fee6f2a1153d8e54975ef8b4a0143602c299e20cc90db46e54a0ecdc3734083`)
* range: 2026-01-01 .. 2026-08-31 for the archived overlap; the September
  continuation needs 2026-09-01 .. present on the same daily tree
* datasets: `spot_1m`, `futures_1m`, `mark_1m`, `index_1m`, `premium_1m`
  (monthly Jan-Jul, daily Aug onward) plus daily `bookDepth` and `metrics`
* size: `bookDepth` dominates; low multiple-GB for the eight months

Independent parity against the archived `external_probability_green` cannot be
claimed until that frame exists. Nothing here is marked ported.

## Durable storage

A private Cloud bucket `c85-artifacts` now exists (200 MB per object) and is
off the sandbox mount. First object stored and verified:

```
releases/external_direction_r1.tar.gz   9,553 bytes   md5 65eb912d45e203cfbf813e9c8bbf8e29
```

The stored size and md5 recorded server-side match the local file. Remaining
gaps, unchanged:

* no download path is wired yet - restoring the object needs a signed
  endpoint on the gateway (the worker has no service-role key by design), so
  byte-for-byte *restore* is not yet demonstrated, only storage;
* 200 MB/object means fitted heads and checkpoints fit, and multi-GB raw
  archives do not. Raw Binance history is re-downloadable from source, so it
  does not need durable storage; derived frames and fits do.
* `/mnt/documents/.lovable/c85-cache` survived one sandbox replacement but is
  still not proven provider durability, and Railway cannot read it.

## Next smallest step

Wire a signed gateway endpoint that returns a short-lived download URL for
`c85-artifacts`, and prove restore of the stored release into a clean path.
Then acquire `binance_context_2026` and build the feature frame to the audited
hash before any probability parity claim.

C85 betting remains suppressed; T45 untouched; C85 is not live.

## Restore path proven (this change)

Signed private-artifact transfer now exists end to end and was exercised
against the live gateway, not a mock:

| check | result |
| --- | --- |
| `artifact.list` (`releases/`) | 1 object, `releases/external_direction_r1.tar.gz`, 9,553 bytes |
| restore into `/tmp/c85restore/clean/...` (source cache untouched) | object SHA-256 `60b73dd8ab863d02caa5e36333123043f2a1142c9ac9c590fc81198c4df028ea`, 6 manifest files verified, 1.084 s |
| restored vs source `manifest.json` SHA-256 | identical (`96cc9bbf…`) |
| restored vs source scores, 50 random observations per stage | `max_abs_p_diff = 0.0`; identical `fit_sha256`, phase and signed direction (T0/T5 `jul_aug`) |
| wrong expected digest | refused; nothing installed |
| bad HMAC signature | 401 |
| key `releases/../../etc/passwd` | 400 |
| key outside allowed prefixes (`secrets/…`) | 400 |
| replayed signed body | 200 then 409 |

The worker never holds a storage credential: it asks the gateway for a
short-lived signed URL for one validated key, and that URL is never logged.

## Source availability for the missing long-context history

HEAD probes against `data.binance.vision` (measured, not assumed):

| dataset | probe | status |
| --- | --- | --- |
| bookDepth daily | 2026-01-02 / 2026-09-05 | 200 (443,523 / 492,186 bytes) |
| metrics daily | 2026-01-02 / 2026-09-05 | 200 (11,422 / 11,278 bytes) |
| spot 1m | 2026-07 monthly / 2026-09-05 daily | 200 |
| UM 1m, mark 1m, index 1m, premium 1m | 2026-07 monthly | 200 |

All seven datasets the original `build_long_context_features.py` consumes are
still retrievable, including September. Acquisition itself has not been run.

## Acquisition and rebuild: COMPLETE (parity: NOT yet proven)

The two sections above describe the state *before* acquisition; they are kept
as history. Current state:

| item | measured result |
| --- | --- |
| raw acquisition | 676 archives, 187,783,108 bytes, 2026-01-01 .. 2026-08-31; every per-archive SHA verified (`download_audit.json` -> `BINANCE_CONTEXT_2026_CHECKSUM_VERIFIED`) |
| durable raw copy | 10 objects under `datasets/binance_context_2026/` in `c85-artifacts`, 7 shards < 200 MB + manifest/audit/checksums; each downloaded back, byte length and SHA-256 re-verified, tar member counts correct |
| rebuild | unchanged `build_long_context_features.py`; 23,328 rows x 545 columns (543 features), 2026-01-01T00:15Z .. 2026-09-01T00:00Z, causal audit intact, all source-completeness checks passed |
| rebuilt frame SHA-256 | `93b99a13161d279378c6418d176cd3b7800650e76f1b41bd24085a10dd246958` |
| durable derived copy | `datasets/long_context/long_context_features.pkl` (101,730,153 bytes) and `long_context_feature_audit.json` (1,049 bytes); both downloaded back and SHA-256 matched |
| feature selection | the **original** selector from the recovered `long_context_model.py`, run on this rebuilt frame, returns 323 ordered features (PRICE 207, DEPTH 66, METRICS 50) identical to the implementation's list. The earlier "324" figure is not reproduced by the original selector; nothing was inserted or removed by hand |

### Hash difference: cause UNPROVEN

The rebuilt frame's SHA-256 differs from the audited `8618768f…`. Matching
row/column counts, date range and audit fields do **not** establish that the
values are equal, and no claim is made that the difference is serialisation
only. The cause stays open pending schema/order/dtype/mask/value evidence, and
the decisive test is independent parity against the archived
`external_probability_green`, not the pickle bytes.

### Probability parity: IN PROGRESS

A resumable walk-forward reproduction (`/tmp/c85/parity_run.py`, thread limits
set before NumPy/scikit-learn import, checkpointed after every one of 183
refit blocks with a probability-prefix digest, model position and schema /
input / label hashes) is running against the rebuilt frame with the frozen
constants. No parity number, fitted head export, or operational claim exists
until it finishes and the archived-ledger comparison is written.

C85 betting remains suppressed; T45 untouched; C85 is not live.

## Durable parity checkpoint collector (independent of the running job)

`tools/parity_checkpoint_collector.py` never touches the running reproduction.
It captures a metadata/NPZ pair that provably belongs to one writer generation
(metadata read before and after the NPZ, plus the recorded probability-prefix
digest recomputed from the NPZ itself; disagreement retries), records the full
identity of the inputs (frame SHA, full contiguous X hash, timestamp hash,
complete-mask hash, ordered schema hash, label hash, frozen config, runtime
versions and thread settings), and writes an immutable `gen-NNNN-<epoch>`
directory whose `MANIFEST.json` is written last. Payloads upload first, manifest
last, and every object is downloaded back and byte/SHA verified.

The checkpoint keeps **no serialised model**. A resume RECONSTRUCTS the active
model by refitting at `last_fit_block` from the same immutable inputs; equality
with uninterrupted operation is proven by a separate deterministic test
(`test_refit_reconstruction_equals_uninterrupted_walk_forward`). Any mismatch in
rows, features, schema, full inputs, timestamps, complete mask, labels, frame,
config, runtime, probability digest or block index refuses the resume - row
counts alone never suffice.

First collected generation: `checkpoints/long_context_parity/gen-0017-1788926294`
(block 17/183, 15 fits, 1440 scored rows, all objects verified on download).

## Trainer eligibility (settled)

Label domain is exactly `{-1, 0, +1}` from the recovered generator
(`np.where(contiguous, np.sign(next_close - next_open), np.nan)`). `0` is a
genuine PUSH (resolved, never trained on). NaN means the source was not
contiguous over the settling candle and is recorded only through
`settle_missing_label()` with explicit availability and source-completeness
evidence. A label that has simply not arrived is *unresolved*: the boundary's
entitled window `[position-WINDOW, position)` is then incomplete, and
`train_ahead()` fails closed with `LongContextTrainingRequired` instead of
producing a shortened fit or a bogus "no fit" verdict. Each fit is bound to one
immutable captured row set whose digest it certifies, so a label settling during
the fit cannot change what the model saw. `scheduling_conflict()` reports the
measured conflict (the final entitled label publishes at the boundary itself)
rather than shortening the original schedule.

## Hardened parity runner and durable generations (this stage)

`tools/parity_runner.py` (git-tracked) is the runner to use for any future run or
restart. Resume identity binds the full frame SHA, complete feature values with
shape, ordered timestamps, completeness mask, labels, schema, HGB parameters,
WINDOW/MINIMUM/REFIT_EVERY, `long_context.py` SHA and runtime versions; the
probability array's shape, dtype, full digest and prefix digest are re-verified
before any resume, and probabilities beyond the recorded block are rejected.
Threads are pinned before NumPy/sklearn import. A restart is never silent: it
requires `--restart`. Models are NOT serialised — recovery refits the eligible
window; `tests/test_parity_runner.py` proves a verified resume reproduces an
uninterrupted run bit-for-bit (10 tests).

Durable generations live under `c85-artifacts/checkpoints/long_context_parity/`.
Each generation is immutable (per-file objects plus MANIFEST written last) and
the mutable `LATEST.json` pointer advances only after the generation has been
downloaded back and verified. Verified generations: `gen-0017-1788926294`
(block 17, 15 fits, 1,440 scored) and `gen-0025-1788927188` (block 25, 23 fits,
2,208 scored); both re-downloaded, manifest/prefix/full digests match, no
probability beyond the checkpoint. Earlier generations are never deleted.

Comparison ledger lineage: `continuous_coverage_ledger.csv`, SHA-256
`564bff1465d13b2f74d61ab5b5e4a17af7726fd503b8ea968d31fc502f17005e`, 19,780 rows,
2026-02-06 23:00 to 2026-08-31 23:45 UTC, no duplicate timestamps, 16,845 finite
`external_probability_green`. Direction and rank must come from the recovered
exact producers in `direction_contract.py`; the legacy runner's 0.5 threshold is
a guess and its direction output must not be reported as parity.

## PARTIAL comparison against the archived ledger (read-only, prefix only)

Source: verified legacy generation `gen-0029-1788927485` (next_block_index 29 of
183, block start 8448, block ts 2026-03-30 00:15 UTC, 27 fits, processed prefix
`[0, 8544)` end-exclusive, last processed target 2026-03-31 00:00 UTC). Report
object: `c85-artifacts/checkpoints/long_context_parity/reports/partial_parity_gen-0029-1788927485.json`.

Result: **PARTIAL MISMATCH** (never a parity pass; the walk is 29/183 complete).
Overlap 4,997 rows 2026-02-06 23:00 to 2026-03-31 00:00, no duplicate keys.
Archived finite 2,374, rebuilt finite 2,592, finite-mask mismatches 218, compared
2,374, all 2,374 above the 1e-9 tolerance, max |diff| 0.0472, mean 0.0098,
correlation 0.955. First divergence 2026-03-05 00:15 UTC, position 6048, fit
block 6048 - the archive's FIRST scored row.

Direction and rank were computed with the recovered exact producers
(`direction_contract.signed_direction`, `rolling_rank` at 2880/960 ties-half)
over the full original probability prefix BEFORE the join: 202 direction
differences out of 2,374; rank finite 1,414 archived vs 1,632 rebuilt, 218 mask
differences, max rank difference 0.991. These follow from the probability
difference and are reported separately, not as independent failures.

Localisation (no tuning, no second run): the rebuilt walk fits first at position
5952 (2026-03-04 00:15 UTC) with 5,854 eligible training rows against a 5,760
minimum; the archive's first score is one block later, so its eligible set at
5952 was below the minimum - at least ~95 rows the rebuilt frame admits are
missing or PUSH in the original. The walk itself matches transcribed
`walk_forward_probability` exactly, so the divergence is in the FEATURE FRAME,
consistent with the still-unexplained feature pickle hash difference. Next
evidence to gather: per-column missingness of the original frame versus the
rebuilt frame over positions 0-5952.
