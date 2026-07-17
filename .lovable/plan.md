# Adaptive Armor Stack 96 (AAS96) — New Independent Shadow Model

AAS96 runs alongside (not inside) Model 6, TD1-RC, and Model 7 variants. It reads the same per-candle inputs from `predictions`, produces its own GREEN/RED/SKIP decision, and is tracked exactly like TD1-RC and B4.2 (own table, own card, own CSV, progress bar during warmup).

## Storage
New table `model7_aas96_shadow`:
- Identity: `id`, `prediction_id`, `candle_ts`, `created_at`
- Inputs snapshot: feature vector length, feature schema hash
- Outputs: `layer_a_prob_l003`, `layer_a_prob_l010`, `layer_a_prob_mean`, `layer_a_base_direction`, `armor_override_fired`, `armor_override_reason`, `layer_a_final_direction`
- Layer B: `layer_b_h32_dir`, `layer_b_h64_dir`, `layer_b_h96_dir`, `layer_b_h192_dir`, `layer_b_final_direction`
- Selector: `layer_a_last96_net`, `layer_b_last96_net`, `selected_layer`, `final_prediction` (GREEN/RED/SKIP)
- Eligibility: `eligibility_passed`, `skip_reason`, `input_feature_timestamp`, `input_candle_age_seconds`
- Training state: `training_row_count`, `last_training_at`, `next_retrain_at_count`
- Resolution: `resolved_at`, `actual_direction` (GREEN/RED/DOJI), `result` (win/loss/push/skip)

Companion state tables:
- `model7_aas96_state` — singleton row with resolved-directional counter, last-fit timestamp, next-retrain boundary
- `model7_aas96_fits` — one row per Layer A fit (lambda, intercepts, coefficients as jsonb, feature list, training row count, fitted_at)

All grants + RLS + service_role write, authenticated read (mirroring TD1-RC).

## Code layout
`src/lib/model7/aas96/`
- `featurize.ts` — builds numeric/boolean/categorical/derived/module/partial-snapshot feature dict from a `predictions` row (uses columns already stored)
- `preprocess.ts` — impute (median), scale (mean/std), one-hot vocabularies, missing indicators; fit-only-on-training
- `layerA.ts` — LBFGS-style logistic regression trainer (deterministic, L2), sigmoid, committee mean
- `layerB.ts` — expert directions + EMA-alpha reliability, weighted horizon votes, majority-of-4 final
- `layerC.ts` — trailing 96 counterfactual net comparator
- `armor.ts` — legacy vs trend override rule
- `orchestrator.ts` — `runAas96Shadow(predictionId)` called from `runAiPredictionServer` right after A2/TD1 (does not gate their output)
- `resolve.ts` — `resolveAas96Signal(predictionId, actualDirection)` called from Kalshi resolver: updates counterfactual histories for both layers + every Layer B expert, appends training row, increments counter, triggers retrain at 192 / +48 boundaries

Warmup: emits SKIP with `skip_reason='warmup'` until 192 resolved directional rows.

## Wiring
- `src/lib/prediction.server.ts` — after TD1-RC block, call `runAas96Shadow` (best-effort try/catch, does not affect webhooks)
- Kalshi resolver already loops all shadow tables; add AAS96 resolution call there
- Realtime publication: `alter publication supabase_realtime add table model7_aas96_shadow`
- No webhook emission (user did not ask; matches "we will track it" only)

## UI (stats page)
Add "Adaptive Armor Stack 96" card in the shadow grid alongside B2, Model 6, A, A2 Combined:
- Total, wins, losses, pushes, win rate
- Selected-layer split (A vs B counts)
- Current pending candle prediction (final_prediction + selected_layer)
- Warmup progress bar (0/192) while `training_row_count < 192`

Server fns in `src/lib/predictions.functions.ts`:
- `getAas96Stats()` — totals + selector split
- `getAas96Pending()` — most recent unresolved
- `getAas96TrainingProgress()` — count / 192
- `listAas96Recent(limit)` — last 20 rows for optional history table
- `exportAas96Shadow()` — CSV with **every** column in `model7_aas96_shadow` plus the joined `predictions` context (candle_ts, actual_direction, resolved_at, actual OHLC) — same "all tracking data we already collect" bar as TD1-RC CSV

## CSV button
- "Download AAS96 CSV" in the CSV data section
- Include AAS96 rows in the existing "All Models CSV" bundle

## Technical notes
- Trainer: deterministic Newton-Raphson / IRLS with L2 (converges reliably at ~1500 rows; simpler than LBFGS and adequate at this scale). Convergence tol 1e-6, max 200 iters. This is a reasonable engineering equivalent of the spec's "deterministic LBFGS or equivalent convex optimizer" clause.
- Training data pulled from `predictions` archive+live where `status in ('win','loss')` and `actual_direction in ('GREEN','RED')` inferred from `correct`+`prediction` or from `actual_close vs actual_open`.
- Feature schema hash: sha256 of sorted feature name list (stable across restarts)
- Retrain runs inline in resolver (bounded, ~100–300ms at this data volume); if it grows heavy we move to a scheduled job later.

## Out of scope for this turn
- No webhook emission for AAS96 (add later on request)
- No home-page hero swap
- No changes to TD1-RC / A2 / B2 / Model 6 logic
