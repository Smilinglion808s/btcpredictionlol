# R4 / R5 continuation — executed status (c85-reconstruction-r1)

Betting/execution: hard OFF. T45: unchanged. No deployment, no publication.

## Durable preservation (verified readback, private `c85-artifacts`)

`recovered/r4_r5_kit/`

| object | bytes | sha256 | readback |
| --- | --- | --- | --- |
| `c85root_small_files.tar.gz` | 3,202,645 | `d360527496c1027a7e5a0ce5212f1953a79c3c0dc8ebe8b52dbb015ea02a68df` | match |
| `htf_structure_r3.pkl` (frozen Aug build) | 40,202,868 | `852df955e478edbfba5bcffb1ccc007347c66f44414be0df649f720a715baa30` | match |
| `upx_small_files.tar.gz` | 70,795,799 | `665c7fe291e9f4af009a7246f34f7d2eb0a20f3146858f686cc7b30c8180e2ab` | match |

`datasets/c85-reconstruction-r1/september_structure_2026-09/`

| object | bytes | sha256 | readback |
| --- | --- | --- | --- |
| `technical_expansion_r2.pkl` | 164,073,384 | `2a9b0970de6f45e57a808784264cfd89cfc3e7b6df1e4905d731e1825f59cbc2` | match |
| `htf_structure_r3.pkl` (extended) | 41,526,138 | `a1b1ddb9986791b141255c8b8c0c3bc390c152814102d45dee00edf47e228267` | match |
| feature/causal audit JSONs | — | see `MANIFEST.json` | match |

Local `/tmp/c85stage` is disposable staging restored from these objects.
`link_durable_cache.sh` was not run, not bypassed, and `C85_ALLOW_SAME_FS` was
never set. Originals under the documents cache were not modified.

## Source acquisition (all SHA-verified by the recovered downloaders)

* `binance_context_2026`: restored 7 shards (Jan 1 – Aug 31) from the bucket,
  then extended with the audited END patch to **2026-09-08** — 679 files.
* `binance_cross_asset_2026` (ETHUSDT, SOLUSDT): downloaded Jan 1 – Sep 8,
  29,636,753 bytes, `all_sha256_verified: true`.
* `long_context_features.pkl`: the stored extended continuation frame
  (`continuation_frame_extended.pkl`, sha `3a6283b5…c344c`).

## Executed producers

1. `build_technical_expansion_r2.py` (unmodified, via the existing datetime-unit
   runner) → `technical_expansion_r2.pkl`, sha `2a9b0970…9cbc2`.
2. `build_htf_structure_r3.py` (unmodified) → **24,096 × 218**, target_ts
   `2026-01-01T00:15Z` … `2026-09-09T00:00Z`.
   Against the frozen August build (23,328 rows): **max absolute difference 0.0
   over the shared prefix, identical missingness masks**. Component
   reproduction, not C85 parity and not inherited performance.
3. `htf_structure_r4_refine.py` (stage `r4_1`) ran and published under the
   corrected validate-then-publish path: 26,124 rows, archived-prefix parity
   `ok`, **`extension_rows: 0`**, cursor `2026-08-31T22:45Z`.

## First remaining dependency (blocker)

`htf_structure_r4_refine.py` does not derive the R4 base rows; it reads
`htf_structure_r3_output/t5_book_anchored_r4_rows.csv`, a recovered artifact
that ends **2026-08-31T22:30Z**. A repository-wide search of the recovered
archives (`upx`, `c85root`) finds only *consumers* of that filename
(`htf_structure_r4_refine.py`, `htf_structure_r4_stress.py`) — **no producer
script that writes it was recovered**. Extending R4.1 past August therefore
requires the anchored-R4 builder source, or an authorised reconstruction of it
from the R4 feature/parameter grid that ships beside the ledger
(`t5_book_anchored_r4_feature_parameter_grid.csv`).

Consequently R5 phase 4 cannot yield post-August rows either. Its import error
(`external_research.r4_2_final_audit` missing from the staged workspace) was
resolved by restoring the byte-identical recovered module
(sha `1d876c74…6ded`) into staging.

## Code changes in this pass

* `src/experts/coverage_providers.py` — a state file that fails to restore now
  marks the provider corrupt: `observe()` raises `C85_COVERAGE_CORRUPT_STATE`
  and `status()` reports `usable: false`. No silent cold start.
* `continuation/config.py`, `continuation/stages.py`, `continuation/stage_r4.py`
  — `C85_CACHE_ROOT` / `C85_C85ROOT` make the recovered-workspace root
  configurable so a reset sandbox can stage from durable objects.
* `continuation/stage_r4.py` — `_validate_candidate()` runs **before**
  `publish()` for `r4_1` and `r5_phase4`: the archived reference fixture is
  required (never skipped), the declared schema is required on both candidate
  and reference, timestamps must be unique, chronological, on the 15-minute
  grid and strictly before the research end, and the archived prefix must match
  cell-for-cell. Stage cursors now come from `_coverage_cursor()` — actual
  produced coverage, never the requested end.
* `_install_prefix_hash_adapter()` — for an extension run only, the frozen R4.1
  prediction digest is verified over the archived timestamp prefix instead of
  the whole lengthened array. A prefix mismatch still aborts; a parity run
  (`end == FROZEN_END`) is untouched.
* `r4_1` / `r5_phase4` no longer carry `frozen_end=True`, since the structure
  input genuinely covers September.

## Runtime

Rebuilt pinned interpreter: Python 3.12.12, numpy 2.3.5, pandas 2.2.3,
scipy 1.17.0, scikit-learn 1.8.0, joblib 1.6.0. Exact 3.12.13 is still not
proven.
