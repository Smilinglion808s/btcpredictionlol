# Model 3 Selective Edge R2 — Upgrade Patch (replaces R1)

R2 replaces R1 in place. R1 historical prediction rows and fits stay in the DB unchanged (never mutated or relabeled), but from activation forward every new prediction and every new fit is R2. UI hero, CSV, stats — all point at R2 rows going forward, with R1 rows still present in the underlying tables for historical continuity.

## 1. Version identity

- `M3SE_MODEL_VERSION = "m3-se-r2"`
- `M3SE_FEATURE_SCHEMA_VERSION = "m3-se-features-v2"`
- Old R1 rows keep their original `model_version = "m3-se-r1"` tag.
- New rows are tagged `m3-se-r2`. On next scheduled candle, R1 stops emitting; R2 takes over.

## 2. Training windows (fixed)

- Slow: latest **1024** rows, uniform × class weight
- Fast: latest **384** rows, `recency = 0.5 ** (age/96)` × class weight
- Calibration: latest **256** rows, held out from all coefficient fits
- OOF: warmup **384**, block size **32**, strict past-only
- Insufficient history → **retain previous active fit** (no shrink-and-activate)

## 3. Capped class-balance weights

```
green_weight = clamp(N / (2*green_count), 0.85, 1.15)
red_weight   = clamp(N / (2*red_count),   0.85, 1.15)
```
Applied to slow, fast, and stacker fits. Persisted on fit: `training_green_count`, `training_red_count`, `green_class_weight`, `red_class_weight`.

Requires `logistic.ts` sample-weight support.

## 4. Selector rebuild (rank-based)

**Drop** raw_direction_indicator, regime_label, regime_transition_score from selector fitting.

**Selector inputs (11):**
`signed_consensus, consensus_strength, expert_agreement, expert_disagreement, stacker_logit_margin, aligned_trend_strength, aligned_return_8, aligned_stretch, wick_dominance, volatility_ratio, volume_zscore`

Consensus fields derived from logits of slow/fast/stacker per spec §5.

**Rank interpretation:** L2 logistic selector; use `selector_score_raw` (pre-Platt) for the publish gate. Platt-calibrated `p_correct_calibrated` kept for diagnostics only.

**Penalty search:** {0.03, 0.10, 0.30, 1.00} — pick highest chronological OOF ROC-AUC, Brier tiebreak.

## 5. Publication

- `target_coverage = 0.60`
- `selection_threshold = P40(selector_score_raw)` on calibration segment
- Publish `raw_prediction` when `selector_score_raw >= threshold`, else ABSTAIN with reason `below_selector_rank`
- No 0.50 floor. No movement gate. Data-invalid still ABSTAINs.

Persist on fit: `target_coverage`, `calibration_estimated_coverage`, `selection_threshold`, `selector_score_calibration_{min,median,p40,p60,max}`.

## 6. Fit diagnostics

Direction: OOF & calibration raw+balanced accuracy, Brier, log loss, predicted GREEN/RED share.
Selector: ROC-AUC, PR-AUC, Brier, log loss, top-20/40/60 accuracy, bottom-40 accuracy, top-60 lift vs raw and vs bottom-40.

Reject only on: non-finite artifact, wrong schema, train/cal overlap, reproduction failure, constant probabilities, insufficient rows.

## 7. Schema migration

`model3_se_predictions` — add nullable columns:
`selector_score_raw, selector_score_percentile, p_correct_calibrated, signed_consensus, consensus_strength, expert_agreement, expert_disagreement, minimum_expert_strength, stacker_logit_margin, green_class_weight, red_class_weight, fast_recency_half_life, fit_age_predictions`

`model3_se_fits` — add nullable columns for class-balance stats, calibration score quantiles, estimated coverage, balanced accuracies, predicted shares, selector rank-band accuracies, lifts, and lambda search JSON.

All new columns nullable so existing R1 rows/fits remain valid.

## 8. Code changes

- `config.ts` — R2 constants, window sizes, target coverage 0.60, allowed lambdas, recency half-life 96
- `logistic.ts` — add optional `sampleWeights: number[]` to `trainLogistic`
- `features.ts` — new `buildSelectorRowV2` using consensus features; update `M3SE_ALIGNED_FEATURE_NAMES` to R2 set
- `train.ts` — rewrite pipeline: fixed windows, class + recency weights, rank threshold, lambda search over selector penalty, new diagnostic outputs, retain-prior-fit-on-insufficient-data at caller
- `orchestrator.ts` — populate every new prediction column, gate on `selector_score_raw`, wire retain-prior-fit path
- `model3_selective_edge.functions.ts` — stats & pending & CSV all filter to `m3-se-r2` (R1 rows remain in table, out of scope for live stats)
- `stats.tsx` — hero card labeled "M3-SE-R2"; abstain reason text unchanged

## 9. 96-row summary (R2-only)

Server fn returns coverage, raw/published accuracy, lift, net, GREEN/RED share and accuracy, agreement/disagreement accuracy, top-20/40/60 and bottom-40 score accuracy from the latest 96 resolved R2 rows.

## 10. Out of scope (per spec §10)

No movement gate, hard trend/vol vetoes, direction-specific rules, regime models, auto feature selection, W/L counters, or 96-outcome threshold optimization.

## Execution order

1. Migration (columns on both tables)
2. `logistic.ts` sample weights
3. `config.ts` R2 constants
4. `features.ts` R2 selector builder
5. `train.ts` R2 pipeline
6. `orchestrator.ts` wiring
7. `model3_selective_edge.functions.ts` version filter + summary + CSV
8. `stats.tsx` label
9. Smoke on next scheduled candle

Old R1 rows stay in `model3_se_predictions` untouched — they're just no longer the live model.
