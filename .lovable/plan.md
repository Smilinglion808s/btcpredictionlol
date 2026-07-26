## Model 3 FWD — build plan

Standalone shadow model. **Nothing in AAS96, a96, TD1-RC, A2, B2, B4.2, Model 6, or Model C is touched.** New tables, new code folder, new UI card, new CSV export.

Internal id: `model8_v3` (per handoff). Display name: **Model 3 FWD**.

### 1. Database (one migration)

New tables, all with `GRANT ... TO authenticated, service_role`, RLS enabled, deny-all default policies (matching every other model's tables):

- `model8_v3_fits` — immutable fit artifacts (feature_order, means, scales, coefficients, intercept, calibration params, training window, active flag, artifact hash).
- `model8_v3_fit_episodes` — one row per activation; started_at / ended_at.
- `model8_v3_predictions` — one row per target candle. Columns cover the full handoff contract:
  - identity: `prediction_id`, `fit_id`, `fit_episode_id`, `model_version`, `feature_schema_version`
  - timing: `created_at`, `feature_cutoff_ts`, `target_candle_ts`, `prediction_latency_ms`, `prediction_created_before_target`
  - inputs: `feature_history_valid`, `data_quality_valid`, `abstain_reason`, `feature_values` (jsonb)
  - outputs: `raw_probability_green`, `calibrated_probability_green`, `raw_prediction` (GREEN/RED), `qualified_prediction` (GREEN/RED/ABSTAIN)
  - resolution: `actual_open/high/low/close/volume`, `actual_direction`, `raw_result` (WIN/LOSS/PUSH), `qualified_result` (WIN/LOSS/PUSH/ABSTAIN), `resolved_at`, `last_resolution_error`
  - forward-test: `official_forward_eligible` boolean

RPCs:
- `get_or_mint_model8_v3_fit_episode()`
- `resolve_model8_v3_prediction(p_prediction_id, p_actual_*)` — idempotent, grades raw+qualified against canonical OHLC.

### 2. Model code — `src/lib/model8_v3/`

Independent folder. Files:
- `config.ts` — thresholds (qualified band 0.45–0.55 ABSTAIN by default), min training rows, retrain cadence, feature-schema version.
- `types.ts`
- `labels.ts` — GREEN/RED/PUSH from canonical OHLC only.
- `features.ts` — feature vector built from prior confirmed OKX BTC-USDT 15m candles only. Deliberately simple v1 set: returns over last {1,2,4,8} candles, ATR14, body-to-range mean, EMA9−EMA21 slope, RSI14, hour_sin/cos, day_of_week_sin/cos, plus a `*__missing` flag per numeric feature. Contiguity + validity gates from handoff §5.
- `preprocess.ts` — median impute + standardize using training stats only.
- `logistic.ts` — regularized binary logistic regression trainer (reuse the math already in `src/lib/model7/aas96/logistic.ts` internally via copy, not import, to keep separation).
- `calibration.ts` — Platt scaling on held-out calibration slice.
- `train.ts` — chronological split, fit, calibrate, persist to `model8_v3_fits`, close previous episode, mint new episode.
- `predict.ts` — load active fit, build features, gate on data quality, produce raw + calibrated + qualified.
- `resolve.ts` — call resolve RPC using canonical OKX candle.
- `orchestrator.ts` — `runModel8V3(sb, targetTs)` scheduled from the existing 15m cron (added as an independent try/catch block; failure never blocks other models). Retrain trigger: every N=50 resolved non-PUSH predictions, or when no active fit exists (initial cold start once ≥300 rows of history are available).

Independence guard: same "forbidden external-model tokens" check the a96 orchestrator uses, adapted to reject any AAS96/a96/TD1/A2/router key from entering features.

### 3. Server functions & CSV — `src/lib/model8_v3.functions.ts`

- `getModel8V3Status()` → active fit meta, episode id, resolved count, next-retrain-at, current pending prediction.
- `getModel8V3Stats()` → totals: wins, losses, pushes, unresolved, win-rate (qualified), plus raw-track totals.
- `getModel8V3Latest(n)` → recent rows for UI.
- `exportModel8V3Csv()` → all rows, all columns, plain object array (uses the existing `rowsToCsv` helper on the stats page).

### 4. Cron wiring

`src/routes/api/public/hooks/scheduled-15m-run.ts` gets one additional block, isolated in its own try/catch:

```text
try { await runModel8V3(supabase, targetTs); }
catch (e) { results.model8_v3_error = String(e); }
```

No changes to any existing block.

### 5. Stats page UI — `src/routes/_authenticated/stats.tsx`

New card **"Model 3 FWD (model8_v3)"** placed below the existing a96 card. Deliberately simple, as requested:
- Current pending prediction (qualified + calibrated probability, or "ABSTAIN — reason").
- Counters: **Wins / Losses / Pushes**, plus qualified win-rate and total resolved.
- Buttons: **CSV (Model 3 FWD)** and **CSV (All Models)** stays as-is (unchanged; will just keep pulling from existing sources — Model 3 FWD gets its own dedicated button).

No changes to Home, no changes to webhook emission, no changes to any other card.

### 6. Explicitly NOT in this build (per "simple" scope + change-nothing rule)

- No Home-page hero swap.
- No outbound webhook for model8_v3.
- No comparator report vs AAS96/a96.
- No calibration bucket chart, no drawdown chart, no per-week metrics table.
- No promotion logic to production.
- No changes to A96, AAS96, TD1-RC, A2 Conflict/Combined, B2, B4.2, Model 6, Model C.
