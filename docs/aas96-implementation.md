# AAS96 — Adaptive Armor Stack 96 (Implementation Doc)

Independent shadow model. Runs alongside the live A2/TD1-RC pipeline. **Never** emits webhooks to the trading bot. Own tables, own training, own UI card, own CSV.

---

## 1. Files

| Purpose | Path |
|---|---|
| Constants | `src/lib/model7/aas96/config.ts` |
| Feature + expert extraction | `src/lib/model7/aas96/featurize.ts` |
| Standardization / scaler | `src/lib/model7/aas96/preprocess.ts` |
| L2 logistic regression | `src/lib/model7/aas96/logistic.ts` |
| Layer B adaptive experts | `src/lib/model7/aas96/layerB.ts` |
| Fit persistence | `src/lib/model7/aas96/fitStore.ts` |
| Training pipeline | `src/lib/model7/aas96/train.ts` |
| Prediction orchestrator + resolver | `src/lib/model7/aas96/orchestrator.ts` |
| Stats + CSV server fns | `src/lib/predictions.functions.ts` (`getAas96ShadowStats`, `exportAas96Shadow`) |
| Stats UI card | `src/routes/_authenticated/stats.tsx` (~line 559) |
| Live pipeline wiring | `src/lib/model7/shadow.ts` (lines 530, 733) |

## 2. Database

- `model7_aas96_shadow` — one row per prediction (40+ diagnostic columns, upsert on `prediction_id`).
- `model7_aas96_state` — singleton row `id=1`: `resolved_directional_count`, `next_retrain_at_count`, `last_training_at`.
- `model7_aas96_fits` — versioned artifacts (scaler, coefficients, expert history), `active=true` on the promoted fit.

All three added to `supabase_realtime` publication so the Stats UI live-updates.

## 3. Constants (config.ts)

```
AAS96_MIN_TRAINING_ROWS = 192   // warmup gate
AAS96_RETRAIN_EVERY     = 48    // cadence after warmup
AAS96_LAMBDAS           = [0.03, 0.10]
AAS96_SELECTOR_LOOKBACK = 96    // Layer C window
```

## 4. Pipeline sequence per candle

1. Prediction row inserted by main pipeline (A2/TD1-RC path unchanged).
2. `shadow.ts:530` deferred-imports and calls `runAas96Shadow(supabase, { prediction })`. Errors are swallowed — the bot webhook has already been sent from A2 Combined / TD1-RC path.
3. On next candle resolution, `shadow.ts:733` calls `resolveAas96Row(...)` **before** the directional gate, so DOJI → `push` (not skipped).

## 5. Layer A — dual L2 logistic committee

- Features extracted from the `predictions` row (`extractFeatures`).
- Standardized via saved `scaler`.
- Two coefficients: `fitL003` (λ=0.03), `fitL010` (λ=0.10).
- `pMean = 0.5 * (pL003 + pL010)`, base dir = `pMean >= 0.5 ? GREEN : RED`.
- **Armor override**: if legacy engine direction (`prediction` YES/NO) **opposes** EMA trend, final Layer A dir = trend dir; reason `legacy_engine_opposes_ema_trend` logged.

## 6. Layer B — 13-expert adaptive ensemble

13 experts (`legacy`, `ema_trend`, `partial_direction`, `m6_score`, `conviction`, `original_pre_partial`, `engine_trend_conflict`, plus inverses).
4 horizons: 32, 64, 96, 192 candles with EMA-weighted reliability. Final = ensemble vote per horizon, then majority. Missing signals fall back to `bullish_score >= bearish_score`.

Expert history updated post-resolution in `resolveAas96Row` via `updateExpertHistory` and persisted with `updateActiveExpertHistory`.

## 7. Layer C — master selector

Reads last **96** resolved rows from `model7_aas96_shadow`. For each row, +1 if that layer matched actual, −1 if it took a directional bet and missed. Selected layer = whichever has the higher net (ties → A). Final prediction = selected layer's direction.

## 8. Eligibility gate (SKIP conditions)

Any of these → SKIP with reason:
- `input_features_stale` (`input_features_fresh === false`)
- `advance_check_failed`
- `no_partial_snapshot`
- `partial_minutes_lt_14` (`current_partial_minutes_elapsed < 14`)
- `input_candle_age_gt_930` (`input_candle_age_seconds > 930`)
- No active fit → `WARMUP_INSUFFICIENT_ROWS` or `NO_ACTIVE_FIT`
- Feature dim mismatch vs coef length → `feature_dim_mismatch:<a>vs<b>` (self-heals on next retrain)

## 9. Training (train.ts)

Triggered from `maybeTrainAas96(sb)` when `resolved_directional_count >= max(192, next_retrain_at_count)`.

1. Fetch all resolved directional rows from `predictions` + `predictions_archive` (paginated, dedup by id, oldest-first). **Never deletes**, matches memory rule.
2. `inferActualDir` — uses `actual_direction`, falls back to `open→close`, DOJI/unknown skipped.
3. Fit scaler on all rows, train both logistic fits (400 iter, tol 1e-6).
4. Replay training set to initialize expert history (avoids cold-start bias).
5. `saveAas96Fit` → new row, marks `active=true`, deactivates prior.
6. Update state: bump `last_training_at`, set `next_retrain_at_count = count + 48`.
7. Logs to `api_runs` (`run_type=aas96-retrain`).

## 10. Resolution (`resolveAas96Row`)

- DOJI / null actual → `result=push`, state untouched, history untouched.
- GREEN/RED → win if `final_prediction === actual`, loss otherwise; SKIP rows stay `skip`.
- Increments `resolved_directional_count`; when threshold hit, `maybeTrainAas96` is invoked.
- Updates Layer B expert history via the original prediction row inputs.

## 11. UI (Stats page)

Card "AAS96 Shadow (Adaptive Armor Stack)" — shows warmup progress bar to 192, then win/loss/push/pending, active fit id + fitted-at, "CSV (AAS96)" download button. Polls `getAas96ShadowStats` every 10s.

## 12. CSV export

`exportAas96Shadow` — full `model7_aas96_shadow` rows joined with prediction context. Columns include: Layer A probs (L003/L010/mean), armor override + reason, per-horizon Layer B dirs, selected layer, Layer C net scores, fit id, feature schema hash, eligibility, skip reason, actual direction, result, plus the shared timing/leakage audit fields.

## 13. Safety invariants

- **No webhook path.** AAS96 never appears in `webhooks.server.ts`.
- **Non-blocking.** All AAS96 work is `await import()` + try/catch inside the shadow pipeline; a failure here cannot affect A2 Combined / TD1-RC emission.
- **No writes to `predictions` / `predictions_archive`.** Only its own three tables.
- **Fail-closed.** Any orchestrator error writes a SKIP row with `shadow_error` and logs to `api_runs`.
- **Never delete predictions** (core memory rule) — training reads from both live + archive.

## 14. Verification checklist

- [ ] `select count(*) from model7_aas96_shadow` grows by 1 per candle.
- [ ] `select resolved_directional_count from model7_aas96_state where id=1` monotonically increases on resolutions.
- [ ] Before 192: every row has `final_prediction='SKIP'`, `skip_reason='WARMUP_INSUFFICIENT_ROWS'`.
- [ ] After 192: an `aas96-retrain` row appears in `api_runs`; `model7_aas96_fits` has exactly one `active=true` row.
- [ ] DOJI candles produce `result='push'`, not `skip`, on the AAS96 row.
- [ ] Stats card warmup bar advances; CSV downloads with all columns populated post-warmup.

---

## 15. Spec-audit corrections applied

Following review, six material deviations were corrected. This section is the authoritative statement of the fixed behavior; earlier sections above have not been rewritten to avoid churn — where they conflict, this section wins.

### 15.1 Layer B reliability (issue 1)
Not EMA-weighted. Per-horizon expert contribution is:

```
contribution = current_direction × tanh(alpha × trailing_net)
trailing_net = wins − losses over the last {32, 64, 96, 192} resolved candles
alpha        = {32: 0.10, 64: 0.20, 96: 0.10, 192: 0.10}
```

Implemented in `layerB.ts::computeLayerB` — rolling win/loss list per (expert, horizon), `Math.tanh(H.alpha * net)`.

### 15.2 Layer B missing-signal fallback (issue 2)
Fallback direction = `bullish_score >= bearish_score ? GREEN : RED` where `bullish_score` / `bearish_score` on `predictions` **are** the Model 6 module aggregates (m6_bullish_score / m6_bearish_score in the spec vocabulary). No separate columns exist; the naming maps 1:1. Comments added at each call site (`featurize.ts`, `orchestrator.ts`, `train.ts`).

### 15.3 Expert roster (issue 3)
Exactly **13** experts, defined in `layerB.ts::EXPERT_NAMES`:
1. legacy, 2. inverse_legacy
3. ema_trend, 4. inverse_ema_trend
5. partial_direction, 6. inverse_partial_direction
7. m6_score, 8. inverse_m6_score
9. conviction, 10. inverse_conviction
11. original_pre_partial, 12. inverse_original_pre_partial
13. engine_trend_conflict (no inverse)

`engine_trend_conflict` output: if legacy and ema_trend are both directional and disagree → emit trend; else emit legacy; if legacy unavailable → M6 fallback (via the ensemble's fallback path). Inverses are literal sign reversals of their source expert's post-fallback direction.

### 15.4 Logistic solver (issue 4)
`trainLogistic` now defaults to `maxIter = 5000`, `tol = 1e-9`; `train.ts` passes those explicitly. Solver is deterministic: zero-initialization, full-batch gradient with backtracking line search, no randomness. Objective is `mean(log(1+exp(z)) − y·z) + λ·Σβ²` (intercept unregularized, no divide-by-two on the L2, so λ = 0.03 and λ = 0.10 apply exactly as written).

### 15.5 15-minute continuity gate (issue 5)
Added to the eligibility block in `orchestrator.ts`:

```
delta_sec = target_candle_ts − input_candle_ts        (seconds)
SKIP with reason "timestamp_discontinuity" unless |delta_sec − 900| ≤ 5
```

`continuity_delta_seconds` and `continuity_gate_passed` are persisted on every row (pass or fail) so the audit trail always records the value.

### 15.6 Partial snapshot lineage proof (issue 6)
Every row records and enforces:
- `target_candle_ts` — candle being predicted
- `input_candle_ts` — candle whose close is the model input
- `snapshot_minutes_elapsed` — partial minutes elapsed into the input candle
- `snapshot_belongs_to_prior_candle` — true iff `input_candle_ts + snapshot_minutes*60s ≤ target_candle_ts` AND `input_candle_ts + 15min ≤ target_candle_ts + 5s`

If `snapshot_belongs_to_prior_candle` is false → SKIP with `snapshot_from_target_candle`. This is a hard leakage guard: the snapshot must belong to the candle that just closed, not to the target candle mid-formation.

### 15.7 Layer C eligibility (issue 7)
`orchestrator.ts` selector query filters `.in("result", ["win", "loss"])` before ordering. That excludes DOJI (result='push'), pending, all SKIP rows, and rows before both layers were live — the last 96 eligible directional counterfactuals only.

### 15.8 Retraining counter (issue 8)
Two counters on `model7_aas96_state`:
- `market_directional_resolutions` — every GREEN/RED market outcome, no gating.
- `usable_training_rows` — bumped only when the AAS96 row had `eligibility_passed=true` OR was a warmup skip (rows the training pool actually contains).

Retrain cadence (`maybeTrainAas96`) reads `usable_training_rows`. Bad-input skips (`input_features_stale`, `timestamp_discontinuity`, `snapshot_from_target_candle`, etc.) no longer advance the retrain clock. Legacy `resolved_directional_count` is kept in sync with `usable_training_rows` so the UI/preload path keeps working.

### 15.9 Categorical + scaler leakage (issue 9)
`fitScaler` and the categorical vocabulary in `preprocess.ts` are fitted only on the historical training rows passed to `maybeTrainAas96`. Live rows apply the saved scaler and map unseen categories to `__unknown__`. No global vocabulary or scaler is used across live rows.

### 15.10 Layer B history persistence (issue 10)
- Layer B histories persist across Layer A retrains only when replayed chronologically over the same superset of training rows — which is what `maybeTrainAas96` does (oldest-first). This yields deterministic reproducibility.
- Between retrains, history advances incrementally in `resolveAas96Row::updateExpertHistory` and is written back via `updateActiveExpertHistory` immediately after each resolution.
- A retrain overwrites the artifact's `expert_history` with the replayed version. Because replay uses the exact same expert definitions and the same chronological training rows, incremental and replayed histories match. If a retrain races an in-flight resolution, the resolution's post-write is the last writer — a version check is a future hardening item (documented, not blocking).

### 15.11 Armor override (clarification)
Uses the legacy prediction field literally:
- YES → GREEN, NO → RED, NO CLEAR EDGE / null → unavailable.

Uses EMA trend field literally:
- up → GREEN, down → RED, mixed / null → unavailable.

Override fires only when both are directional and disagree. It never infers a direction from score values when the legacy prediction is unavailable.

### 15.12 Horizon tie / Layer C tie
- Per horizon: `score >= 0 → GREEN`, `score < 0 → RED` (exact zero is GREEN).
- Across 4 horizons: 3–1 or 4–0 majority; 2–2 → 192-candle horizon.
- Layer C: `netA >= netB → Layer A` (ties → A).

### 15.13 Verification updates
Add to the checklist:
- `select continuity_gate_passed, count(*) from model7_aas96_shadow group by 1;` — after 15.5, all passing rows should show true; the false bucket surfaces upstream candle-alignment drift.
- `select snapshot_belongs_to_prior_candle, count(*) from model7_aas96_shadow group by 1;` — false must correspond to `skip_reason` containing `snapshot_from_target_candle`.
- `select usable_training_rows, market_directional_resolutions from model7_aas96_state where id=1;` — usable should stay ≤ market. Divergence = features are failing extraction upstream.
