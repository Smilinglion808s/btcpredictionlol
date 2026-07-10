Add a "Download Model 7 CSV" button on the Stats page (inside the Model 7 Shadow card) that exports every shadow row joined with its production prediction context, split cleanly for Variants A and B.

## What ships

- New server function `exportModel7Shadow` (in `src/lib/predictions.functions.ts`) returning all `model7_shadow` rows (both variants), each enriched with linked `predictions` context: `created_at`, `target_open_ts`, `target_close_ts`, `production_model_version`, `prediction`, `status`, `confidence`, `setup_type`, `btc_price_at_prediction`, `close_price`, `market_condition`, `agreement_gate_applied`, `final_trade_status`.
- CSV builder (client-side) in `src/routes/_authenticated/stats.tsx` — same pattern used on the History page. Escapes quotes, handles nulls, sorts newest-first.
- Two buttons in the Model 7 Shadow card header: **Download CSV (All)** and optional split downloads **Variant A** / **Variant B**. File names: `model7-shadow-all-YYYYMMDD.csv`, `model7-shadow-variantA-YYYYMMDD.csv`, `model7-shadow-variantB-YYYYMMDD.csv`.

## CSV columns (in order)

`candle_ts, variant, status, decision, base_decision, would_trade, probability_green, logit, hard_no_override_fired, model_fit_id, feature_vector_nonzero_count, unknown_categories, actual_direction, resolved_at, shadow_error, created_at, prediction_id, production_model_version, prod_prediction, prod_confidence, prod_setup_type, prod_status, prod_market_condition, prod_agreement_gate_applied, prod_final_trade_status, btc_price_at_prediction, target_open_ts, target_close_ts, close_price`

## Notes

- Read-only; no schema changes.
- Pulls up to 20k rows (well above current volume) in one call.
- No changes to shadow logic, audits, or UI elsewhere.