# ES1 Fail-Closed Certification (final)

All four amendments plus the six final corrections are accepted. ES1 stops publishing whenever the price head is not backed by a certified artifact, and it only resumes after certified state is rebuilt and independently verified.

## 1. Honest provenance labels

Replace the current two-value `fitSource` (`sklearn-frozen` / `irls-fallback`) with three:

- `sklearn-frozen` — bundled JSON artifact, produced by scikit-learn offline.
- `ts-lbfgs-certified` — minted live by the in-repo L-BFGS fitter, only after it passes the certification gates in section 4.
- `irls-shadow` — IRLS output; never publishable, audit only.

Nothing minted in the worker is ever labelled sklearn.

## 2. Immutable JSON artifacts win

Artifact resolution order becomes strict:

- Boundaries present in `frozen-fits.json` (768–2016): JSON is authoritative. A DB row for the same boundary is only allowed if its window fingerprint AND artifact hash match JSON exactly; any difference is a fail-closed abstain, not a silent preference.
- Boundaries absent from JSON: DB artifact may be used, and only if its recomputed window fingerprint matches the live training window.
- Duplicate/conflicting DB rows for one boundary: fail closed.

## 3. Two-part certification

Persist three flags per prediction row:

- `price_fit_certified` — the fit artifact itself is certified.
- `decision_state_certified` — the rolling state feeding this row (confidence ranks, hybrid evidence, B4 cell counts, pCorrect) was itself built entirely from certified rows.
- `parity_certified = price_fit_certified && decision_state_certified`.

Publication requires `parity_certified`. When it is false:

- `final_prediction = null`, `would_trade = false`, `webhook_eligible = false`
- reason `ABSTAIN_ES1_SKLEARN_ARTIFACT_NOT_READY` (missing/mismatched fit) or `ABSTAIN_ES1_DECISION_STATE_UNCERTIFIED` (contaminated rolling state)
- IRLS shadow direction/probability/outcome still computed and stored for audit.

### Repair of the four IRLS rows at 2112

1. Mint and install the 2112 artifact via the certified fitter.
2. Compute certified counterfactual values for the four fallback rows into shadow columns; original predictions, reasons and sent webhooks are left untouched.
3. Rebuild ranks, hybrid evidence and B4 cell state from index 2112 forward using the certified values.
4. Compare rebuilt state to a recorded checksum; publication resumes only on pass. The four original rows stay excluded from parity-certified forward statistics.

## 4. Pinned numerical specification

The fitter is certified against a pinned oracle, not assumed equivalent. Pinned and asserted in the artifact metadata and tests:

- Oracle versions: scikit-learn, NumPy, SciPy (recorded in each artifact).
- Zero initialization of coefficients and intercept.
- `tol`, `max_iter`, L-BFGS correction history (`maxcor`), line-search limit (`maxls`), `ftol`/`gtol` translation from sklearn's tolerance.
- Weighted-loss normalization and `C` handling exactly as sklearn's `LogisticRegression`.
- Intercept unpenalized.
- Day-balanced sample weights only — no `class_weight`.
- Binary class ordering (label 0/1 orientation) fixed.
- RobustScaler: median center, (10, 90) quantile range, linear percentile interpolation matching NumPy, and zero-scale columns mapped to scale 1.

Binding gates for `ts-lbfgs-certified` (all must pass, else the artifact is rejected and ES1 abstains):

- exact scaler and window-fingerprint identity
- tight probability tolerance vs oracle
- identical price directions
- identical confidence ranks, B4 cells and final decisions
- convergence flag true and finite gradient norm
- deterministic repeated-fit hash (fit twice, byte-identical artifact)

Coefficient tolerance is recorded as a diagnostic only.

## 5. Minting inputs

Minting reads canonical confirmed candle rows directly from the candle store, never `is_resolved` on the prediction table (which lags up to 16m15s). A boundary is mintable only when every row of its exact preceding training window exists as a confirmed candle; future boundaries are never pre-generated.

Minting is triggered automatically as each block's window completes, ahead of the 96-row boundary, with an `api_runs` alert before the rollover and a fail-closed alert if generation fails.

## 6. Proof test

A simulated missing-artifact run must demonstrate, end to end:

- no webhook emitted
- IRLS shadow row written and labelled `irls-shadow`
- primary row marked uncertified with the correct abstain reason
- publication resumes only after certified replay rebuilds state and the checksum matches

## Technical notes

- `src/lib/b4x4es1/fitArtifacts.ts`: three-way source enum, JSON-authoritative resolution, DB artifact loader with collision/mismatch fail-closed.
- `src/lib/b4x4es1/priceHead.ts`: add the pinned L-BFGS fitter alongside the existing IRLS solver; IRLS demoted to shadow.
- `src/lib/b4x4es1/orchestrator.server.ts`: certification gate before publication and webhook emission; shadow fields always populated.
- Migration: provenance and certification columns on `b4x4_es1_predictions` (`price_fit_source`, `price_fit_boundary`, `price_fit_window_fingerprint`, `price_fit_certified`, `decision_state_certified`, `parity_certified`, `irls_shadow_*`), plus artifact/oracle-version columns and a uniqueness constraint on `b4x4_es1_fits(boundary)`.
- Tests: reproduce all 14 bundled sklearn artifacts within the pinned tolerances, plus the missing-artifact simulation.
