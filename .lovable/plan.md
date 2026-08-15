# ES1 fit 02112: confirmation and remediation

## Answer

`es1-fit-02112-ef3018838c14` is **not** sklearn-backed. It is an **IRLS fallback** fit.

Evidence gathered:
- `src/lib/b4x4es1/frozen-fits.json` contains exactly 14 frozen sklearn artifacts, at block boundaries 768, 864, 960, 1056, 1152, 1248, 1344, 1440, 1536, 1632, 1728, 1824, 1920, 2016. There is no artifact for boundary **2112**.
- `resolveEs1Fit()` returns a sklearn artifact only when `ARTIFACTS.get(boundary)` exists and the recomputed window fingerprint matches; with no artifact at 2112 it always falls through to `trainEs1Fit(...)` tagged `irls-fallback`.
- Live rows confirm the fit is in use: 4 rows in `b4x4_es1_predictions` carry `price_fit_id = es1-fit-02112-ef3018838c14` (artifact sha `ef3018838c14...`).

So live scoring has rolled past the end of the frozen artifact coverage and is now running the in-repo IRLS solver. Decisions are still produced, but they are no longer bit-identical to the certified sklearn oracle, so the parity certification does not cover any prediction made under this fit.

## Options

**A. Extend frozen coverage (recommended)** — generate the sklearn artifact for boundary 2112 (and the next few boundaries ahead of the live cursor), verify each window fingerprint matches, and append them to `frozen-fits.json`. Once merged, `resolveEs1Fit` picks the sklearn path automatically and the 2112 fit id changes to the sklearn-derived id.

**B. Add a coverage guard** — make the orchestrator record and surface `fit_source` (currently not persisted to the table), and optionally abstain or flag when a boundary has no frozen artifact, so this can never go unnoticed again.

Recommended: do both — A restores parity now, B prevents silent drift later.

## Implementation

1. **Artifact generation (offline, deterministic)**
   - Rebuild the exact training window for boundary 2112 from the canonical candle source, using the same row-selection rules `resolveEs1Fit` feeds to `trainEs1Fit`.
   - Fit `LogisticRegression(C=0.01, lbfgs)` on `RobustScaler(10, 90)`-scaled features with day-balanced weights, matching `ES1_PRICE_SPEC` / `ES1_SCALER` / `ES1_LOGISTIC_C`.
   - Emit `boundary`, `trainingRowCount`, `trainingStartTs`, `trainingEndTs`, `trainingStartIndex`, `trainingEndIndex`, `windowFingerprint`, `center`, `scale`, `coefficients`, `intercept`.
   - Repeat for boundaries 2208 and 2304 so live scoring stays inside frozen coverage for the next several days.

2. **Fingerprint verification** — before appending, recompute `trainingWindowFingerprint()` in TypeScript over the same rows and assert an exact match; a mismatch means the window reconstruction is wrong and the artifact must not be shipped.

3. **Append to `src/lib/b4x4es1/frozen-fits.json`** — no code change needed in `fitArtifacts.ts`; the map is built from the JSON.

4. **Persist fit provenance** — add a `price_fit_source` column to `b4x4_es1_predictions` (and the archive table) and write `fit.fitSource` on every row, so `sklearn-frozen` vs `irls-fallback` is auditable from the database instead of inferred from the JSON.

5. **Coverage alarm** — in the ES1 boundary run, when the resolved fit is `irls-fallback`, log a distinct `api_runs` warning entry naming the uncovered boundary. Whether that should also suppress the webhook is your call (see question below).

6. **Backfill note** — the 4 existing rows under this fit stay as-is (history is never rewritten); after the artifact lands, later boundaries score sklearn-backed and the affected window is identifiable via the new provenance column plus these fit ids.

## Question for you

When a boundary has no frozen artifact, should ES1 (a) keep publishing with the IRLS fallback as it does today, or (b) abstain and skip the webhook until frozen coverage is extended? Option (b) guarantees every published ES1 prediction is parity-certified, at the cost of missed candles when coverage lapses.
