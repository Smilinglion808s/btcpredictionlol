Yes. The Dual Horizon Ensemble will now track properly on the Stats page and in the CSV.

What's already in place from the last change to `src/lib/predictions.functions.ts`:
- `getModelCShadowStats` paginates 1000 rows at a time and aggregates both `dual_horizon` and `global_only` separately, so the Ensemble card won't be truncated by PostgREST's implicit row cap as the table grows.
- `getModelCShadowPending` queries each variant independently, so the Ensemble's latest pending candle always surfaces even if Global-Only has a newer row.
- `exportModelCShadow` paginates the full history for both variants (no 20k cap), so the Ensemble CSV stays complete.

No code changes needed. New Ensemble rows will populate the Dual Horizon Ensemble square and CSV automatically as candles resolve.