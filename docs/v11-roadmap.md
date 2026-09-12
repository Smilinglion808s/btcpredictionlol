# Version 1.1 roadmap (shadow only)

## Version 1.1 (combined V1 + improved T45 R2 CONTEXT69_NORM_38) — shadow only

- [x] Inspect existing in-project data (no external research archive used)
- [x] v11 config + CONTEXT69_NORM_38 feature builder (28 feature_ + 41 ctx_ + 11 norm_ = 80)
- [x] Daily UTC fit (trailing 90d, RobustScaler(10,90), LogisticRegression C=.003 lbfgs, certified ts-lbfgs port)
- [x] Rank / availability / admission gate + append-all-valid-scores observer
- [x] V1 eligibility read (nested features.lite_a.reason=CONFIDENCE_ABSTAIN + ordinary_floor_allows + final_side 0) with cross-leg claim exclusion
- [x] Immutable append-only v11 decisions + durable checkpoint state
- [x] Schema migration applied (v11_context_rows, v11_vectors, v11_heads, v11_scores, v11_decisions, v11_state)
- [x] Historical seed (20,544 context rows) + 18,607 valid 80-input vectors + daily heads 2026-08-01..2026-09-14
- [x] Focused tests: 27 passing (shape, vol, fail-closed inputs, rank/availability/gate, V1 eligibility, midnight expiry, min rows)
- [ ] Wire the observer into the signed T+45 collector hook, bounded and off the legacy critical path
- [ ] Observer-level tests with a fake client: duplicate target, restart, late receipt
- [ ] Shadow replay over the seeded window + Version 1.1 stats surface

Constraints: no V1 math/identity/state changes; no real sends; dispatch_enabled always false; mock transport only.

## 2026-09-12 correction pass
- [x] Removed v1_input_invalid gate from R2 vectors/training (finite-80 only); V1 input_valid now gates final fallback eligibility only
- [x] Recomputed all 20,544 vectors: valid 18,607 -> 20,022
- [x] Deleted 45 provisional heads, refit Aug 1 - Sep 12 from corrected vectors
- [x] Fit parity vs Python sklearn 1.9.1 on identical rows: coef 1.1e-14, intercept 6.7e-16, prob 3.5e-14, 0 side disagreements
- [ ] Residual: Aug 31 window yields 8,222 rows vs reference 8,217 (5-row gap, cause unidentified)
- [x] Timing: 45s event cutoff recorded separately from measured receipt/decision; 60s publication ceiling enforced

## Review corrections applied (this pass)

1. Strict `features.input_valid === true` and nested `features.lite_a.reason`;
   run mode + timing read; database failures raise instead of looking like
   "no row".
2. Rank uses the newest 768 FINITE confidences (filter before slice);
   availability uses the last 768 official opportunities including invalid ones.
   Regression test covers 1,200 mixed rows.
3. SQL NULL survives as NaN everywhere (`numOrNaN`); no `Number(null)` → 0.
4. Score + decision + checkpoint commit in ONE transaction
   (`v11_commit_observation`, advisory-locked, `GREATEST()` checkpoint), with
   predecessor-gap detection, duplicate no-op and crash/concurrency tests.
5. Observer is wired into the signed T+45 collector hook, isolated from the
   legacy T45 legs. LIVE_SHADOW requires a signed trigger, a real receipt, a
   LIVE V1 row, no gaps and a decision inside the 60s ceiling; everything else
   is RESEARCH/RECOVERY.
6. Maintenance (labels, vectors, daily head, gap recovery) runs only in
   `mode=resolve`, off the decision path. Labels are filled, never cleared.
7. Heads are bound to the feature-order hash, config fingerprint, cutoff and
   max training settlement; future-dated fitting is refused and future heads are
   quarantined.
8. Direction is pure: `p >= .5` is UP, otherwise DOWN. Availability 0 blocks
   admission instead of yielding a gate of 1.
9. Authenticated Version 1.1 tile with source-leg records and separate
   live/research blocks.
10. Original C85 roadmap restored to `roadmap.md`; V11 work lives here.

### Still unavailable

The frozen R2 research weights and the parity ledger were never transferred
(the upload was blocked), so this candidate is NOT proven parity-equivalent to
the original research strategy. The Aug 31 corrected fit uses 8,222 rows against
the stated 8,217 — an unexplained row-selection difference, not solver
precision.
