# ES1 Fail-Closed Certification (final)

All four amendments plus the six final corrections are accepted. ES1 stops publishing whenever the price head is not backed by a certified artifact, and it only resumes after certified state is rebuilt and independently verified.

## 1. Honest provenance labels

Replace the current two-value `fitSource` (`sklearn-frozen` / `irls-fallback`) with three:

- `sklearn-frozen` — bundled JSON artifact, produced by scikit-learn offline.
- `ts-lbfgs-certified` — minted live by the in-repo L-BFGS fitter, only after it passes the certification gates in section 4.
- `irls-shadow` — IRLS output; never publishable, audit only.

Nothing minted in the worker is ever labelled sklearn.

## 2. Immutable JSON artifacts win, and artifact identity

Artifacts are keyed by the immutable composite `(model_version, feature_schema_hash, fit_boundary)`. The artifact hash is taken over a canonical deterministic payload — spec, scaler name, center, scale, coefficients, intercept, window fingerprint, row count, boundary — excluding timestamps, generator strings and any other nondeterministic metadata.

Resolution order is strict:

- Boundaries present in `frozen-fits.json` (768–2016, plus 2112 once generated): JSON is authoritative. A DB row for the same key is only allowed if its window fingerprint AND canonical artifact hash match JSON exactly; any difference is a fail-closed abstain, not a silent preference.
- Boundaries absent from JSON: a DB artifact may be used, and only if its recomputed window fingerprint matches the live training window.
- Duplicate or conflicting DB rows for one key: fail closed.

## 3. Two-part certification

Persist three flags per prediction row:

- `price_fit_certified` — the fit artifact itself is certified.
- `decision_state_certified` — the rolling state feeding this row (confidence ranks, hybrid evidence, B4 cell counts, pCorrect) was itself built entirely from certified rows.
- `parity_certified = price_fit_certified && decision_state_certified`.

Publication requires `parity_certified`. When it is false:

- `final_prediction = null`, `would_trade = false`, `webhook_eligible = false`
- reason `ABSTAIN_ES1_CERTIFIED_ARTIFACT_NOT_READY` (missing/mismatched fit) or `ABSTAIN_ES1_DECISION_STATE_UNCERTIFIED` (contaminated rolling state)
- IRLS shadow direction/probability/outcome still computed and stored for audit.

### Repair of the four IRLS rows at 2112

1. Generate the 2112 artifact with the pinned Python/sklearn oracle offline, label it `sklearn-frozen`, and install it into `frozen-fits.json`. It also becomes the 15th (and most recent) certification fixture for the TypeScript fitter.
2. Compute certified counterfactual values for the four fallback rows into dedicated `certified_cf_*` columns, kept separate from `irls_shadow_*`. Original predictions, reasons and sent webhooks are untouched; the four rows stay uncertified, but their certified counterfactual values may feed the rebuilt forward state.
3. Rebuild ranks, hybrid evidence and B4 cell state from the last certified checkpoint forward using certified values.
4. Verify independently: the canonical checksum covers artifact hashes, canonical candle identities, A2 row IDs, OB snapshot IDs, ranks and B4 state. The rebuild is computed twice independently and both runs must agree; for 2112 the result must also match an offline reference checksum. The previously stored running checksum is not trusted as the comparison target. Publication resumes only on pass, and the four original rows stay excluded from parity-certified forward statistics.

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

### CI certification (offline, with sklearn)

Run against all 15 sklearn artifacts (768–2016 plus 2112) and synthetic/degenerate fixtures (separable data, constant columns, zero-scale features, extreme weights):

- tight probability tolerance vs the oracle
- identical price directions
- identical confidence ranks, B4 cells and final decisions
- exact scaler identity

Coefficient tolerance is recorded as a diagnostic only. A fitter build only ships with a recorded certified code hash after CI passes.

### Runtime validation (Cloudflare, no oracle available)

Live minting cannot compare against sklearn — there is no Python oracle in the worker, and literal per-boundary sklearn verification would require an external Python service. Runtime therefore gates on:

- certified fitter code hash matches the CI-certified hash
- exact training-window fingerprint match
- convergence true and finite gradient norm
- deterministic repeated-fit hash (fit twice, byte-identical canonical payload)
- scaler invariants (finite center/scale, zero-scale handling)

Any failure → no artifact, `ABSTAIN_ES1_CERTIFIED_ARTIFACT_NOT_READY`, no webhook.

## 5. Minting inputs and timing

Minting reads canonical confirmed candle rows directly from the candle store, never `is_resolved` on the prediction table (which lags up to 16m15s). A boundary is mintable only when every row of its exact preceding training window exists as a confirmed candle; future boundaries are never pre-generated.

Timing: the final training row only becomes available at the new block boundary itself. A pre-check runs ahead of the boundary (window completeness, artifact absence, alerting), but final minting happens after the T−15m candle is confirmed and must complete inside the accepted 20-second scoring window. If confirmation or fitting fails or overruns, ES1 abstains and emits no webhook, with a fail-closed `api_runs` alert.

## 6. Proof test

A simulated missing-artifact run must demonstrate, end to end:

- no webhook emitted
- IRLS shadow row written and labelled `irls-shadow`
- primary row marked uncertified with `ABSTAIN_ES1_CERTIFIED_ARTIFACT_NOT_READY`
- publication resumes only after certified replay rebuilds state from the last certified checkpoint and both independent rebuild checksums agree


## Technical notes

- `src/lib/b4x4es1/fitArtifacts.ts`: three-way source enum, composite-key identity, canonical artifact payload hashing, JSON-authoritative resolution, DB artifact loader with collision/mismatch fail-closed.
- `src/lib/b4x4es1/priceHead.ts`: add the pinned L-BFGS fitter alongside the existing IRLS solver; IRLS demoted to shadow.
- `src/lib/b4x4es1/orchestrator.server.ts`: certification gate before publication and webhook emission; shadow fields always populated.
- Offline script (sandbox Python with pinned sklearn/NumPy/SciPy) generates the 2112 artifact and the offline reference checksum; sklearn is installed there for generation only, never at runtime.
- Migration: provenance and certification columns on `b4x4_es1_predictions` (`price_fit_source`, `price_fit_boundary`, `price_fit_window_fingerprint`, `price_fit_certified`, `decision_state_certified`, `parity_certified`, `irls_shadow_*`, `certified_cf_*`), oracle-version and fitter-code-hash columns, plus a unique constraint on `b4x4_es1_fits(model_version, feature_schema_hash, boundary)`.
- Tests: reproduce all 15 sklearn artifacts within the pinned tolerances, degenerate fixtures, and the missing-artifact simulation.
