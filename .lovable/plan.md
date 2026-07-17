## Goal
Produce one consolidated CSV containing every candle across all Model 6 / Model 7 / Model C variants with full tracking columns, delivered as a downloadable artifact.

## Scope — tables to include (one row per candle per variant)
- `predictions` + `predictions_archive` (Model 6 base engine, all columns)
- `model7_shadow` (Variants A, B, B2, B4.2, A2 Conflict / MidBand / Combined — every tracking column: timing, leakage, B4.2 state, A2 filters, counterfactual, warm cache)
- `model7_td1_rc_shadow` (TD1-RC layer, all columns incl. veto, fit id, A2 source join)
- `model_c_shadow` (Model C Ensemble / Global / PRC, all PRC controller columns)

## Output shape
Single CSV, long format, one row per (candle_ts, variant). Union of all columns across sources; missing fields left blank. Columns prefixed by source table to avoid collisions (e.g. `m7_`, `td1_`, `mc_`, `p_`). Sorted by `candle_ts DESC, variant`.

Also include a small README sheet? No — single CSV only, as requested.

## Steps
1. Paginate each source table (bypass 1000-row PostgREST cap) to pull every row through the latest resolved/pending candle.
2. Left-join Model 7 / TD1 / Model C rows to `predictions ∪ predictions_archive` on `candle_ts` for shared context (btc price, final status, Kalshi resolution).
3. Union all variant rows into one long dataframe with a `source_table` + `variant` column.
4. Write to `/mnt/documents/all_models_every_candle_<YYYYMMDD>.csv`.
5. Deliver via `<presentation-artifact>` tag.

No code or schema changes. Read-only export.
