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
