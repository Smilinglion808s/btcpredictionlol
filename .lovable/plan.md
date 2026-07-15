Export a fresh CSV of the full `model7_shadow` dataset (all variants: A, B, B2, B4.2, A2 policies) through the most recent resolved/pending candle, including all tracking columns (timing, leakage, B4.2 state, A2 filters, counterfactual results, warm cache hits).

Steps:
1. Query `model7_shadow` (paginated to bypass the 1000-row PostgREST limit) joined with `predictions`/`predictions_archive` for actual close data.
2. Write to `/mnt/documents/model7_shadow_all_data_<today>.csv`.
3. Deliver via `<presentation-artifact>` tag for download.

No code or schema changes.