## Goal
Ship the routing/telemetry fields A3.2/A3.3 need into a Model 6 CSV export so your analysis team gets them on every candle going forward.

## What already exists (no new math needed)
Model 6's `computeFeatures` (`src/lib/model6/featureEngine.ts`) already computes: `channel_position` (numeric 0..1), `fib_zone` (categorical), `ema21`, `vwap`, `atr_14`, `avg_range_20`, `channel_low/high`, `volume_expansion`, `higher_low_sequence`, `lower_high_sequence`, `consecutive_same_color_streak`, `atr_state`, and the raw candles. But Model 6 stores only the small `computeIndicatorBundle` output in `predictions.indicators`, so none of this reaches the CSV.

## Change 1 — Persist a Model 6 telemetry blob per prediction
Extend `src/lib/prediction.server.ts` (both prediction write sites, ~L461 and ~L954) to add a new `indicators.telemetry_v1` object containing:

- `channel_position_numeric` (0..1 from featureEngine)
- `channel_position` (categorical: `lower` / `lower_mid` / `middle` / `upper_mid` / `upper` from bucketed numeric)
- `channel_fib_zone` (existing `fib_zone`)
- `channel_low`, `channel_high`, `channel_width_pct` = `(high-low)/close * 100`
- `distance_to_upper_channel_pct`, `distance_to_lower_channel_pct`
- `trend_direction` (`UP` / `DOWN` / `MIXED` — reuse existing rule)
- `trend_strength` (0..100 composite of EMA9/21/50 separation, `last_8_close_change` magnitude, and same-color streak, all normalized by ATR)
- `trend_slope` (linear-regression slope of last 8 closes / avg_range_20)
- `trend_age_candles` (walk back while EMA9 vs EMA21 sign matches current)
- `distance_from_fast_ema_pct` = `(close-ema9)/close*100`
- `distance_from_slow_ema_pct` = `(close-ema50)/close*100`
- `is_countertrend_trade`, `is_trend_continuation` (derived from `prediction` vs `trend_direction`)
- `reversal_strength` (0..100 = countertrend evidence: `failed_breakout_*`, `bullish/bearish_liquidity_sweep`, wick rejection, extension from VWAP)
- `continuation_strength` (0..100 = trend_strength × structural agreement)
- `market_regime_score` (0..100 composite of trend persistence, ATR state, wick discipline, channel width vs ATR, streak stability — clamped)
- Sub-scores for transparency: `trend_score`, `ema_score`, `momentum_score`, `volatility_score`, `structure_score`

All numeric outputs deterministic and pure — no side effects, no new packages. Historical rows keep their existing `indicators`; new rows get `telemetry_v1`.

## Change 2 — New Model 6 CSV export
Add `exportModel6Predictions` in `src/lib/predictions.functions.ts`:

- Query live + archive `predictions` where `model_version LIKE '6.%'`, paginate over `id`.
- Flatten `indicators.telemetry_v1.*` into top-level columns using the names in the request (e.g. `channel_position`, `trend_strength`, `distance_from_fast_ema`, etc.).
- Include `actual_next_open`, `actual_next_close` (from `actual_next_candle_open/close`).
- Derive `actual_direction` **in the export** strictly from the OHLC: `close > open → GREEN`, `close < open → RED`, else `DOJI`. The stored `actual_direction` column is ignored for this CSV so labels can never diverge from prices.
- Also include timing/context: `id`, `candle_ts`, `created_at`, `prediction`, `confidence`, `setup_type`, `status`, `market_condition`, `btc_price_at_prediction`.

## Change 3 — UI button
Add a `CSV (Model 6)` button on `src/routes/_authenticated/stats.tsx` next to the existing model CSV buttons, wired to the new server fn via `useServerFn` and the existing download helper.

## Change 4 — Include in "All Models" bundle
`exportAllModels` currently unions Model 7 + AAS96 + TD1-RC. Add Model 6 telemetry rows to that bundle so the consolidated CSV also carries the new routing fields.

## Out of scope
- No changes to Model 6 scoring, sizing, or narrator logic.
- No changes to Model 7 / AAS96 / TD1-RC feature computation or decisions.
- No schema migrations — telemetry rides inside the existing `indicators` jsonb.
- No backfill of historical rows (they never had these fields computed).

## Verification
1. Trigger a live cycle; confirm the new prediction row has `indicators.telemetry_v1` populated with all fields listed above.
2. Download `CSV (Model 6)`; confirm the requested column names appear and `actual_direction` matches `sign(actual_next_close - actual_next_open)` on every resolved row.
3. Spot-check one trend-continuation row and one countertrend row: `is_trend_continuation` / `is_countertrend_trade` should be mutually exclusive and match `prediction` vs `trend_direction`.
4. Download `CSV (All Models)`; confirm Model 6 rows now carry the telemetry columns.
