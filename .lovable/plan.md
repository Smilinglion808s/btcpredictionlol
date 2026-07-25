## Plan: Combine a96 + AAS96 into one CSV export

### Goal
Create a single downloadable CSV that contains rows from both the **a96 (a96-r1)** `a96_predictions` table and the legacy **AAS96** `model7_aas96_shadow` table, with a `source` column so you can still distinguish them.

### Why
- AAS96 CSV export is still being populated but the download button is no longer visible on the Stats page.
- a96 is the current deterministic model being tracked.
- You want one unified dataset to analyze both models together.

### What we will build

1. **New server function `exportA96CombinedCsv`** in `src/lib/predictions.functions.ts`
   - Fetches all rows from `a96_predictions` (ordered by `target_candle_ts` DESC).
   - Fetches all rows from `model7_aas96_shadow` (ordered by `candle_ts` DESC).
   - Adds a `source` column to every row: `"a96"` or `"aas96"`.
   - Returns the combined array as plain JSON objects.
   - Uses the existing admin Supabase client and paginated reads (1000-row pages) to handle large datasets.

2. **Stats page button**
   - Add `exportA96CombinedCsv` to the imports in `src/routes/_authenticated/stats.tsx`.
   - Add a new `useServerFn` hook and loading state for the combined export.
   - Add a "CSV (a96 + AAS96)" button on the **a96 (a96-r1)** card next to the existing "CSV (a96)" button.
   - When clicked, it downloads a single CSV file named `a96-combined-<date>.csv`.

3. **CSV shape**
   - The `rowsToCsv` helper in `stats.tsx` already unions all keys across rows, so any column that exists in either table will appear in the header.
   - Rows from a96 will have values in AAS96-only columns left blank, and vice versa.
   - The `source` column lets you filter or pivot in Excel/Sheets/Python.

### What we will NOT do
- We will not delete the individual AAS96 export function (`exportAas96Shadow`) — it stays available for direct use if needed.
- We will not change the underlying schema or data pipeline; this is purely a UI/export convenience.
- We will not modify the Stats page visual counters or reset logic.

### Files to edit
- `src/lib/predictions.functions.ts` — add `exportA96CombinedCsv`.
- `src/routes/_authenticated/stats.tsx` — wire the button.

### Verification
- After implementation, the Stats page a96 card will show a new button that downloads a CSV containing both a96 and AAS96 rows, tagged by source.
- The build will be checked to ensure the new import resolves correctly.