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
