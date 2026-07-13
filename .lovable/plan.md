## Goal
Guarantee the Dual-Horizon Ensemble variant is aggregated and exported alongside Global-Only in `getModelCShadowStats`, `getModelCShadowPending`, and `exportModelCShadow`, and confirm on the live DB that Ensemble rows are flowing.

## Current state (verified)
- `model_c_shadow` rows today:
  - dual_horizon: 1 scored (pending), 3 skip
  - global_only: 1 win, 2 loss, 1 scored, 2 skip
- Stats card, pending card, and CSV code all reference both `dual_horizon` and `global_only` keys. Ensemble has no resolved trades yet — the "0 wins/0 losses" reading is real, not a UI bug.
- Risk: all three server fns use single `.limit(50000)` / `.limit(20000)` reads, same pattern that recently silently broke Model 7 B4_2 counts when PostgREST's implicit cap hit. Once Model C history grows, ensemble rows (older ones) will be the first to fall off the tail.

## Changes (all in `src/lib/predictions.functions.ts` — no UI or model-logic changes)

1. **`getModelCShadowStats`**
   - Paginate the read in 1000-row pages (same helper pattern as the Model 7 stats fix).
   - Server-side filter: `variant in ('dual_horizon','global_only')` and `trade eq true` OR `status in ('scored','warming_up','skip')` so both pending and resolved rows for both variants are counted correctly.
   - Keep the two-bucket aggregation exactly as-is.

2. **`getModelCShadowPending`**
   - Fetch the latest `candle_ts` first with a small `order/limit(1)` query per variant, then load the row(s) for that candle. Ensures the ensemble pending row is always surfaced even if global_only ran a candle later.

3. **`exportModelCShadow`**
   - Paginate `select("*")` in 1000-row pages ordered by `candle_ts desc` so the full history for both variants lands in the CSV (no 20k cap).

4. **Verification (read-only, after deploy)**
   - `select variant, status, count(*) from model_c_shadow group by 1,2` before/after.
   - Confirm the Stats page Ensemble tile shows the same counts as the SQL, and the CSV row count matches `select count(*) from model_c_shadow where variant='dual_horizon'`.

## Non-goals
- No changes to Model C scoring, retraining, coefficients, or the ensemble/global-only branch selection.
- No changes to the home page or Model 7 code.
