# Coverage-control producer (first live ancestor computation)

`src/experts/coverage_control.py` + `src/experts/coverage_providers.py`

## What it is

C30, C36 and C37 do not each own a per-target computation. They all consume one
shared precursor recovered verbatim from `t0_t5_fee_coverage_frontier_r1.py`:

```
load_frame -> add_confidence_scores -> directional_past_rank
                                    -> make_policy / make_adaptive_policy
```

C30 reaches it through `t0_t5_win_containment_deep_dive_r1.load_rich_frame`;
C36/C37 consume C30's phase3 and timing ledgers, which are built on those rows.
So this is the first ancestor producer the live worker needs, and it is what has
now been implemented as an incremental, one-target state machine with durable
state — not another batch re-run.

Original rules preserved exactly:

- rank: strictly past-only percentile within the forecast direction, lookback
  768 per direction, minimum 96 priors, `(#less + 0.5*#equal)/n`; non-finite
  values are neither ranked nor remembered.
- confidence: R2/R4 direction-adjusted correctness, mean blend over available
  heads, active margin (context margin on router override, else ensemble
  margin), the +0.03 T0/opening agreement bonuses, MARGIN_ONLY rank as the
  cold-start fallback for every other rank series.
- adaptive controller: label-free, calibration window 768 opportunities,
  minimum history 384, refresh every 96, candidate grid 0.000..0.950 step 0.005,
  ties broken to the HIGHER (fee-conservative) threshold.
- fixed policy: T0-first fixed-threshold call.

Nothing is imputed. A row missing a required field raises
`CoverageInputError`; an out-of-order target is refused.

## Executed evidence

`reproduction/run_coverage_control_stream.py` (log:
`docs/coverage-control-parity.log`), full recovered history
2026-02-06 23:00Z .. 2026-08-31 23:45Z, 19,780 targets, 19,757 opportunities:

- every confidence column, all six rank series, the opportunity mask and the
  cov30/cov70 adaptive prediction/stage/active_threshold: **0 mismatches**
  against the recovered batch implementation, NaN slots included positionally.
- mid-stream save/restore at target 9,890: **0 differing targets** afterwards,
  so a restart resumes on the next target with identical rank windows and
  controller thresholds.

`reproduction/compare_coverage_control_to_c30_ledger.py` (log:
`docs/coverage-control-vs-c30-ledger.log`) compares the streamed output with the
ARCHIVED C30 output
`c30_c70_lab_manager_r2_output/selected_shadow_ledger.csv`:

- 19,780 rows joined on `ts`; `prediction_cov30` **0 mismatches**;
  `stage_cov30` **0 mismatches**.

That is component-level reproduction of the C30 control branch, not C85 parity
and not any inherited performance claim.

## Why `c30` is still MISSING in the registry

The archived C30 ledger also carries `selected_*_c70`, `selected_blend_*`
(SELECTED_EXTERNAL_BLEND dual-score heads) and `selected_hot_*_f010` (the
fee-0.10 hot calibration policy). Those are separately fitted heads that are not
ported. Registering this producer as `c30` would substitute one branch for the
whole expert, so it is attached as a **precursor**
(`ExpertRegistry.register_precursor`), reported in `status()["precursors"]`, and
never counted towards `connected`. `ExpertRegistry.connected` remains `False`
and `c30`, `c36`, `c37`, `r4`, `external`, `c42`, `c51`, `c54` remain missing.

## Next precise dependency

1. C30 `SELECTED_EXTERNAL_BLEND` dual-score heads (`make_dual_score_policy` in
   `c30_c70_lab_manager_r2.py`) and the fee-0.10 hot calibration policy — both
   need the R5 hot ledger continuation past 2026-08-31.
2. Then C36 timing/frontier selection, then C37 balanced maturation, each of
   which consumes C30's phase3/timing ledgers.
3. The base capture ledgers (`continuous_coverage_ledger`,
   `t5_reliability_r2_rows`, `t5_hot_calibration_ledger`) END at
   2026-08-31 23:45Z. Live operation needs those rows produced forward from the
   running collectors; until they are, this producer's cursor cannot advance
   past 2026-08-31 23:45Z with authentic inputs. Daily archive lag is an
   archive-catchup limit, not an acceptable live feed.

## Recorded, unresolved: `qlib_corr_5` overlap discrepancy

`reproduction/extend_continuation_frame.py` compares the saved continuation
frame with a rebuild over their overlap at `TOLERANCE = 1e-6`. One column
disagreed: `qlib_corr_5`, maximum absolute difference
`3.4404809340833e-06`. This is NOT proven harmless and the tolerance has NOT
been widened. The script previously wrote a usable
`continuation_frame_extended.pkl` before returning failure; it now writes the
candidate to `continuation_frame_extended.REJECTED.pkl`, removes any stale
published file, and records `status: REJECTED_OVERLAP_DISAGREEMENT` with the
observed difference in the report.
