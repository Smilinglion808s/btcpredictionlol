# Replace Model 3 with Selective Edge R1

The current `model8_v3` (v3.0.2 — dual-head direction + movement gate) is retired in favor of a completely different architecture: two direction experts + a stacker + a correctness selector that gates publication toward ~50 of every 96 valid candles.

Old fits and predictions remain under `model_version = v3.0.2` in the existing tables (per acceptance criterion 11). The new model runs under `model_version = m3-se-r1`, `feature_schema_version = m3-se-features-v1`, and is written to fresh tables to keep the two schemas from colliding.

## Architecture

```text
Slow expert (L2 logistic, ~1536 rows)   Fast expert (L2 logistic, ~512 rows)
        └────────────────┬─────────────────────┘
                         ▼
               Direction stacker (L2 logistic on OOF logits + a few features)
                         ▼
              Platt-calibrated p_green_stacked_calibrated
                         ▼
            raw_prediction = p >= 0.5 ? GREEN : RED
                         ▼
              Correctness selector (L2 logistic on aligned features)
                         ▼
           Platt-calibrated p_correct_calibrated
                         ▼
          selected = p_correct >= max(0.50, Q_{1-50/96}(cal))
                         ▼
              published = raw_prediction OR ABSTAIN
```

## Feature schema (21 direction features)

- **Returns (5):** log returns 1/2/4/8/16
- **Candle structure (4):** body_to_atr, range_to_atr, wick_imbalance, close_location_in_range
- **Trend & location (6):** ema9_minus_ema21_to_atr, ema21_minus_ema50_to_atr, price_minus_ema21_to_atr, rolling_position_16, rolling_position_32, rsi14_centered
- **Volatility & participation (6):** realized_volatility_8_to_32, atr_percentile_256, range_percentile_256, trend_efficiency_8, trend_efficiency_32, volume_zscore_32

Preprocessing (fit on training rows only, stored per fit): median imputation + missing indicator, 1st/99th winsorization, median/IQR scaling.

## Files (new)

Under `src/lib/model3_selective_edge/`:
- `config.ts`, `types.ts`
- `features.ts` — 21-feature builder + ATR/EMA/RSI helpers
- `preprocess.ts` — winsorize + median/IQR scaler
- `logistic.ts` — L2 logistic + Platt (reuse pattern from model8_v3)
- `oof.ts` — expanding chronological OOF blocks (512 warmup, 32-row blocks)
- `directionExperts.ts` — slow (1536/1024) + fast (512/384), λ ∈ {0.03, 0.10, 0.30, 1.00} chosen by OOF log-loss
- `directionStacker.ts` — small L2 stacker on OOF logits + `realized_volatility_8_to_32`, `trend_efficiency_32`, `ema9_minus_ema21_to_atr`
- `correctnessSelector.ts` — aligned features from raw prediction
- `calibration.ts` — Platt for stacked direction + correctness selector
- `train.ts` — end-to-end fit with 256-row calibration holdout, validation gates
- `predict.ts` — live per-candle scoring
- `resolve.ts` — actual_direction / raw_result / published_result / selector_net_effect
- `csvExport.ts` — predictions, fits, and 96-row block CSVs

Server-fn wrapper: `src/lib/model3_selective_edge.functions.ts` mirroring `model8_v3.functions.ts` (list predictions, export CSVs).

Orchestrator entry point: called from the same shared trigger already used for a96/aas96/model8_v3 in `src/lib/model7/shadow.ts`, replacing the model8_v3 call.

## Database

New migration:
- `model3_se_fits` — full artifact JSONB (preprocess, slow/fast/stacker/selector weights, plattDirection, plattCorrectness), selection_threshold, target_coverage, estimated_coverage, OOF & calibration diagnostics, feature_schema_hash, artifact_hash, fit_status, failure_reason
- `model3_se_predictions` — every field listed in spec §16 (identity, 21 flat features, 8 direction outputs, 10 selector inputs/outputs, resolved outcomes, 4 counterfactual fields)
- `model3_se_blocks` — 96-row rolling summaries (spec §18). Materialized by a small server-side aggregator after each resolution

Each table gets explicit GRANTs + RLS `SELECT to authenticated` policies matching existing shadow tables.

Old `model8_v3_*` tables are left untouched.

## Retraining cadence

Retrain a new fit after every 96 resolved (non-PUSH) `m3-se-r1` predictions, auto-activated when validation §14 passes (all coefficients finite, feature schema matches, no train/cal overlap, OOF chronological, selector on OOF only, non-constant probabilities, estimated coverage ∈ [0.20, 0.75]). No manual review (matches earlier user directive).

## UI

`src/routes/_authenticated/stats.tsx`: the Model 3 FWD hero card is repointed at the new model — same visual card, updated title ("Model 3 — Selective Edge R1"), same abstain-reason surface (`abstain_reason: invalid_data | below_correctness_rank`). Adds a small "coverage: X / 96 last block" subline.

`src/routes/_authenticated/history.tsx`: the "Model 3 FWD CSV" button becomes three buttons — `model3_predictions.csv`, `model3_fits.csv`, `model3_blocks.csv`. Universal CSV merger continues to include a m3-se-r1 published-direction column keyed by `target_candle_ts` (spec §22.9).

## Webhooks

Not wired. TD1-RC + a96 remain the only outbound webhooks. (Consistent with earlier "do not send webhooks to bot" directives when introducing new models.)

## Tests (spec §21)

`src/lib/model3_selective_edge/__tests__/`:
- `noLeakage.test.ts` — target row absent from own feature/history; OOF trained only on earlier rows
- `oofUsage.test.ts` — stacker/selector fit only on OOF outputs
- `calibrationHoldout.test.ts` — cal rows not in coefficient fits
- `artifactRoundtrip.test.ts` — serialize/reload reproduces identical probabilities
- `alignedSymmetry.test.ts` — GREEN vs RED aligned features are sign-flipped mirrors
- `selectionThreshold.test.ts` — uses 50/96 quantile and never drops below 0.50
- `abstainKeepsRaw.test.ts` — raw_prediction retained during ABSTAIN
- `blockReconciliation.test.ts` — 96-row block export sums back to prediction rows

## Out of scope

- Old `v3.0.2` fits/predictions untouched
- Universal CSV columns for old Model 3 FWD stay under their existing headers
- No webhook changes
- No stats-page redesign beyond swapping which model backs the "Model 3" card

## Sequence

1. Migration (tables + grants + RLS)
2. Config / types / features / preprocess / logistic / oof
3. Direction experts + stacker + selector + calibration + train
4. Predict + resolve + orchestrator wrapper
5. CSV export + server-fn wrapper
6. Replace model8_v3 call site in shadow trigger with m3-se-r1 call
7. Stats card + history CSV buttons repointed
8. Tests
