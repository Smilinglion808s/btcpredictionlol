# Roadmap

## Version 1.1 (combined V1 + improved T45 R2 CONTEXT69_NORM_38) — shadow only

- [x] Inspect existing in-project data (no external research archive used)
- [x] v11 config + CONTEXT69_NORM_38 feature builder (28 feature_ + 41 ctx_ + 11 norm_ = 80)
- [x] Daily UTC fit (trailing 90d, RobustScaler(10,90), LogisticRegression C=.003 lbfgs, certified ts-lbfgs port)
- [x] Rank / availability / admission gate + append-all-valid-scores observer
- [x] V1 eligibility read (CONFIDENCE_ABSTAIN + ordinary_floor_allows + final_side 0) with cross-leg claim exclusion
- [x] Immutable append-only v11 decisions + durable checkpoint state
- [x] Schema migration applied (v11_context_rows, v11_vectors, v11_heads, v11_scores, v11_decisions, v11_state)
- [x] Historical seed (20,544 context rows) + 18,607 valid 80-input vectors + daily heads 2026-08-01..2026-09-14
- [x] Focused tests: 27 passing (shape, vol, fail-closed inputs, rank/availability/gate, V1 eligibility, midnight expiry, min rows)
- [ ] Wire the observer into the signed T+45 collector hook, bounded and off the legacy critical path
- [ ] Observer-level tests with a fake client: duplicate target, restart, late receipt
- [ ] Shadow replay over the seeded window + Version 1.1 stats surface

Constraints: no V1 math/identity/state changes; no real sends; dispatch_enabled always false; mock transport only.
