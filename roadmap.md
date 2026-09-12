# Roadmap

## Version 1.1 (combined V1 + improved T45 R2 CONTEXT69_NORM_38) — shadow only

- [ ] Inspect existing in-project data: c85_targets direction60 coverage, t45_pf feature coverage, overlap window
- [ ] v11 config + CONTEXT69_NORM_38 feature builder (28 feature_ + 41 ctx_ + 11 norm_ = 80)
- [ ] Daily UTC fit (trailing 90d, RobustScaler(10,90), logistic C=.003 lbfgs)
- [ ] Rank/availability/admission gate + append-all-valid-scores observer
- [ ] V1 eligibility read (CONFIDENCE_ABSTAIN + ordinary_floor_allows + final_side 0) with cross-leg exclusion
- [ ] Immutable append-only v11 decisions + durable checkpoints, once per target
- [ ] Hook into signed T+45 boundary route, bounded and off the legacy critical path
- [ ] Tests: missing inputs, duplicate target, midnight expiry, restart, late receipt, unresolved V1, exclusion
- [ ] Schema migration for v11 tables (validate first)
- [ ] Report remaining blockers (no external research archive)

Constraints: no V1 math/identity/state changes; no real sends; no deploy/publish; mock transport only.
