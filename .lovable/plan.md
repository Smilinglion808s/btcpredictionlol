# Model C Verification & Retraining Repair Plan

Scope: verification-only for scoring; no coefficient/threshold/blend/policy changes. Only code changes are (1) retraining promotion bug fix and (2) nightly audit serialization fix. Everything else is diagnostic reporting.

## 1. Recent probability distribution (≥30 post-fix Dual Horizon rows)

- Query `model_c_shadow` where `variant='dual_horizon'` and `created_at >= <fix deploy ts>` ordered by `created_at` desc, cap 100, require ≥30.
- If <30 exist yet, trigger scoring by waiting for next candles or backfill via `scoreModelCShadow` on the most recent N unscored candles (no policy change, existing pipeline).
- Compute and report: min, max, mean, stddev, count==0, count==1, count<0.5, count>0.5 on `recent_probability_green`.

## 2. Python ↔ backend parity table (Recent component)

- Build a small Python reference script under `scripts/modelc_parity.py` that:
  - Loads the same active Recent fit (coefficients, scaler mean/std, feature order) from `model_c_training_fits`.
  - Reads the same raw indicator snapshot used by 5 recent shadow rows (persisted `feature_snapshot_json` on `model_c_shadow`).
  - Runs the identical featurize → standardize → logit → sigmoid pipeline in NumPy.
- For 5 rows, report: aligned vector length, max |raw diff|, max |standardized diff|, python_logit, backend_logit, |prob diff|, decision_match.
- No changes to backend featurize beyond the already-shipped range20 alias fix.

## 3. Top 15 feature contributions for the 48.89→9.40 diagnostic row

- Recompute (standardized_value × coefficient) per feature for prediction `d6777f59...` using the active Recent fit.
- Sort by |contribution|, report top 15 with: feature name, raw value, standardized value, coefficient, contribution, running logit.
- Flag any single feature whose |contribution| > 2.0 or whose standardized value is outside [-4, 4] as a suspect residual issue.

## 4. Diagnose `maybeRetrainModelC` non-promotion (543 clean rows)

- Inspect `src/lib/modelc/trainer.ts` + call site in `src/lib/modelc/shadow.ts`.
- Query `api_runs` for `kind ILIKE 'modelc_retrain%'` and `model_c_training_fits` grouped by status.
- Report: last attempt ts, trigger count (last 24h), trainer error text, fit rows written, promotion status counts (pending/ready/failed), current active `model_version`, loader fallback reason (from `loadActiveModelCFit` lineage log), and the exact code fix.
- Apply the minimal fix (expected: promotion gate / status transition / unique-index conflict handling). No coefficient or policy edits.

## 5. Prove one new shadow row uses a live fit

- After fix, wait for next scheduled retrain or invoke the trainer path once.
- Query newest `model_c_shadow` row and report: `active_fit_id`, training cutoff ts, global row count, recent row count, global artifact hash, recent artifact hash, target boundary ts. Confirm `active_fit_id` is not `bootstrap:*`.

## 6. Nightly audit serialization fix

- In the nightly audit alert builder (Model 7 nightly audit hook), override identifiers are being `String(obj)`'d producing `[object Object]`.
- Change to extract `.rule` (and `.applied` when relevant) from each `override_reasons_json` element, or `JSON.stringify` as fallback. Emit stable string ids.
- Verify by re-running the audit for the last 24h window and inspecting the produced alert payload.

## Deliverable

A single reply containing: the 8-number distribution, the 5-row parity table, the top-15 contribution table, the retraining diagnosis + applied fix, the live-fit proof row, and confirmation of the audit serialization fix.

## Out of scope

Coefficients, thresholds, blend weights, model policy, A/B/B2/B4.2 paths, Model 6, Model C Global-Only diagnostic variant behavior.
