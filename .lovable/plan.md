# ES1: fail-closed on missing sklearn artifact + automated artifact minting

Confirmed first: `es1-fit-02112-ef3018838c14` is **IRLS fallback**, not sklearn-backed. `frozen-fits.json` holds artifacts only for boundaries 768…2016 (14 fits); boundary 2112 has none, so `resolveEs1Fit` falls through to the in-repo IRLS solver. Four live rows in `b4x4_es1_predictions` carry this fit id.

Your correction is accepted: only 2112 is generatable today; 2208/2304 windows contain rows that do not exist yet and will be minted at their own boundaries.

## 1. Fail-closed publication gate

In the ES1 decision chain, resolve the fit **before** scoring and branch on provenance:

- Artifact present **and** recomputed window fingerprint matches → normal certified scoring, webhook eligible as today.
- Artifact missing **or** fingerprint mismatch →
  - `final_prediction = null`
  - `would_trade = false`
  - `webhook_eligible = false`
  - `decision_reason = ABSTAIN_ES1_SKLEARN_ARTIFACT_NOT_READY`
  - the IRLS fit still runs and its direction, probability, confidence and (later) outcome are written to shadow-only columns for audit.

Webhook suppression is enforced at the send site as well, so no path can publish an uncertified row.

## 2. Provenance persistence

New columns on `b4x4_es1_predictions` (and the archive table, matching shape):

- `price_fit_source` — `sklearn-frozen` | `sklearn-minted` | `irls-fallback`
- `price_fit_boundary` — integer block boundary
- `price_fit_window_fingerprint` — recomputed fingerprint of the exact training window
- `parity_certified` — boolean; true only for sklearn-backed with matching fingerprint
- `irls_shadow_direction`, `irls_shadow_probability`, `irls_shadow_confidence`, `irls_shadow_result` — audit-only fallback track

Forward parity-certified statistics (stats page + CSV) filter on `parity_certified = true`, which naturally excludes the four existing 2112 rows. Those rows are left untouched.

## 3. The 2112 artifact

Reconstruct boundary 2112's exact training window from the canonical source rows using the same selection `resolveEs1Fit` feeds `trainEs1Fit`, fit `LogisticRegression(C=0.01, lbfgs)` on `RobustScaler(10,90)` features with day-balanced weights, and emit the full artifact record (center, scale, coefficients, intercept, window indices/timestamps, `windowFingerprint`). Before install, recompute `trainingWindowFingerprint()` in TypeScript over the same rows and require an exact match; a mismatch aborts the install.

## 4. Automated minting worker (the durable fix)

Static JSON stops at history, so artifacts move to the database (`b4x4_es1_fits`, already present) with the JSON kept as the immutable historical seed. Loader order: DB artifact → bundled JSON → fail closed.

The Cloudflare worker runtime cannot run scikit-learn, so the minting engine is a **certified TypeScript L-BFGS fitter**:

- Implement L-BFGS with the exact sklearn objective (L2 on weights, unpenalized intercept, `C = 0.01`), plus the same RobustScaler and day-balanced weights.
- Certify it by refitting all 14 existing frozen windows and requiring coefficients/intercept to match the sklearn artifacts to a tight tolerance (target ≤ 1e-9, and identical decisions/ranks on the full replay). The fitter is only enabled after this certification test passes in CI.
- At each 96-row block boundary the ES1 boundary run mints the new artifact from the just-completed window, stores it with its fingerprint and `source = 'sklearn-minted'`, then scores. Fitting 1,536 rows × 8 features is milliseconds — well inside the timing window.
- Minting is idempotent and advisory-locked per boundary so concurrent runs cannot produce divergent artifacts.

## 5. Alerting and fail-closed behaviour

- One boundary ahead of each 96-row rollover, a pre-check logs an `api_runs` warning naming the upcoming boundary and whether its window is complete.
- If minting fails or the fingerprint mismatches, the run logs an error-level `api_runs` entry and the candle abstains under `ABSTAIN_ES1_SKLEARN_ARTIFACT_NOT_READY` — never publishes.

## 6. Verification before this is called done

- Replay across the full certified history produces zero decision/direction/reason changes for boundaries 768…2016.
- 2112 replay switches from `irls-fallback` to sklearn-backed with a matching fingerprint.
- A simulated missing artifact yields abstain + no webhook + populated IRLS shadow fields.
- The TS fitter reproduces all 14 sklearn artifacts within tolerance.

## Notes

- The four existing 2112 IRLS rows stay in history exactly as written, flagged `parity_certified = false`.
- Nothing in the frozen ES1 spec (features, scaler, C, thresholds, agreement gate) changes; this is a provenance and publication-eligibility change only.
