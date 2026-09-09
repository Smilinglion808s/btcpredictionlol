# Consolidated COVERAGE -> C30 path (c85-reconstruction-r1)

Status: reconstruction component executed. Betting/execution remains hard OFF,
T45 untouched, nothing deployed or published.

## 1. `waterfall_ledger.csv` dependency: determined, not guessed

Every read of the two missing ledgers inside
`external_research/t0_t5_coverage_bridge_audit_r1.py`:

| line | call site | use |
| --- | --- | --- |
| 666 | `main()` | `recovered_packet` boolean mask, used only to slice the `coverage_bridge_performance.csv` metric grid |
| 376 | `parity_audit(frame)` | archived-vs-new comparison payload |
| 557 | `stored_policy_label_sensitivity()` | archived-policy report (`CONTROL`) |

`build_continuous_frame()`, `fit_t5()`, `add_t0_and_policies()` and the
`continuous_coverage_ledger.csv` export never read them. They therefore feed
**no** feature generation, fit label, fitted parameter, policy selection or
runtime state: they are report-only. `t5_ensemble_selected_ledger.csv` was NOT
recovered and the waterfall research was NOT re-run.

The *module* `net_monthly_waterfall_r1` **is** required (`fit_t5` calls
`waterfall.t5_router`) and is imported verbatim.

Archived comparison is recorded as `NOT_RUN_MISSING_REFERENCE`. The original
research script is preserved unmodified; the frozen reference outputs are staged
read-only under `reference/`.

## 2. Consolidated callable

`reproduction/c30_coverage_path.py`

* `run_batch(end)` - runs the recovered functions themselves (the module's own
  `END` is temporarily set to the requested boundary); returns the frame plus an
  audit. No arithmetic is re-implemented here.
* `CoverageC30Server` - the prediction-time callable.
  * in: raw T+5 row `{ts, t5_ret_bps, t5_range_bps, t5_quote_flow,
    t5_log_quote_volume, t5_log_trade_count, source_segment}` +
    `{external_probability_green, external_direction, external_rank}`
  * out: `p_pf_linear`, `p_pf_context_logit`, `base_probability_green`,
    `base_direction`, `t5_context_router_prediction`, `external_*`,
    `graded_warm`, `graded_hot`, `continuous_graded_prediction`,
    `continuous_graded_stage`, `t5_input_complete`
  * `settle(ts, label)` is what advances the router / warm / hot histories, in
    the original causal order (flag read before the outcome is appended).
  * serialised state: raw tail buffer (`PRIMARY_WINDOW + RANK_LOOKBACK + 384 +
    96` rows), current fitted `(RobustScaler(10,90), LogisticRegression(C=0.003,
    lbfgs, max_iter=5000, random_state=0))` per head, block cursor, the three
    histories, and SHA-256 digests of each payload.
  * constants unchanged: window 8640, minimum 2688, refit every 96, rank
    lookback 768 / minimum 192, router window 8 / >=4 wins, hot window 16,
    warm 0.50, hot 0.60, grades 0.65 / 0.60 / 0.50.

## 3. Executed September result

`reproduction/run_coverage_c30.py --end 2026-09-09T00:00:00Z --replay 96`

| | |
| --- | --- |
| frame | 27,072 rows, 2025-12-01T00:00Z .. 2026-09-08T23:45Z |
| fits | linear 253 (first 2025-12-30T00:00Z), context 251 (first 2026-01-01T00:00Z) |
| ledger | `continuous_coverage_ledger.csv`, from `LIVE_READY` 2026-02-06T23:00Z |
| September rows | 768, 2026-09-01T00:00Z .. 2026-09-08T23:45Z |
| September calls | 768 (input complete and graded prediction non-zero) |
| September stage split | T5 440 / T0 328 |
| graded prediction sha256 | `26c3b9524338c90ba76775df9a397ec094fb3effe875c0bb021ca3acdd3b18c9` |

## 4. Saved-state restore evidence

State snapshot at index 26,975 (2026-09-07T23:45Z), reloaded from disk with
digest verification, then the final 96 targets scored one at a time:

* decision mismatches (direction, router, stage, warm/hot, input-complete): **0**
* numeric cells differing: 2 (`p_pf_linear`, `base_probability_green` at
  2026-09-08T09:15Z), max absolute difference `1.11e-16` (0.5 ULP), from
  single-row versus block `predict_proba`. Not claimed as bit parity.

## 5. Data qualifications (unresolved, stated not papered over)

* **Sep 1 00:00Z external gap.** The assembled T0 file joins archived history
  (`ts < Sep 1`) to the reconstructed September ledger (starts Sep 1 00:15Z), so
  2026-09-01T00:00Z has no external probability/rank. It was NOT zero-filled and
  no clock slot was compressed: `available` is false there and the original rule
  routes the target to T5. It is the only September row with a missing rank.
* **Labels.** The T10/T45 outcome exports end 2026-08-31, so all 768 September
  rows carry `label = NaN`. They are operational calls, never scored, and the
  router/warm/hot histories do not advance across September. A September
  settlement source is required before those histories can move again.
* **Source receipt timing.** The five-second numerics match the original T+5
  formulas, but row presence in the T45/T10 exports is a post-T+5 artefact.
  Opportunity validity here comes from `t5_input_complete` over the T+5 price
  flow features, not from whether a later T45 prediction fired. Genuine live
  receipt timing is still unmeasured.
* **Runtime.** Executed on Python 3.13.12 / scikit-learn 1.8.0 / pandas 2.2.3 /
  numpy 2.3.5 (the pinned 3.12.12 interpreter was not available after the
  sandbox reset). Reconstruction namespace only; no archive-parity claim.

## 6. Durable location

`c85-artifacts/datasets/c85-reconstruction-r1/september_c30_2026-09/`
(ledger, audit, replay rows, the three code files, serving state, MANIFEST.json)
- every object uploaded and read back with matching SHA-256.

## 7. Next dependency

Downstream `c30_c70_lab_manager_r2` (SELECTED_EXTERNAL_BLEND dual-score heads
and the fee-0.10 hot policy) needs September extensions of
`fee_coverage_shadow_ledger.csv` and `fixed_floor_shadow_ledger.csv`; only
`t5_hot_calibration_ledger` and the R4/R5 rows are extended so far. That is the
next executable step, and it is input-bound, not specification-bound.
