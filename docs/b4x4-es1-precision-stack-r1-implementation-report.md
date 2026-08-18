# B4x4-ES1 Balanced Precision Stack R1 — Implementation Report

Date: 2026-08-18 (UTC)
Status: **Implemented and wired as the active ES1 publication policy in code. Not yet observed live — the running deployment has no precision rows; a Publish is required.**

## 1. Identity (frozen)

| Field | Value |
| --- | --- |
| Policy ID | `b4x4-es1-balanced-precision-stack-r1` |
| Model version | `b4x4-es1-balanced-precision-stack-r1` |
| Policy version | `precision-stack-r1` |
| Implementation revision | `precision-stack-r1-impl1` |
| Variant | `PRECISION_STACK` |
| Resolver version | `precision-r1` |
| Activation record | `b4x4_es1_activation.id = 'b4x4-es1'` |
| Oracle | `B4x4_ES1_Balanced_Precision_Oracle_224.json` (224 rows) |

Frozen constants: fill min confidence `|p-0.5| >= 0.06`, primary max trend age `12`,
rescue max upper-wick percentile `0.20`, wick percentile window `96` candles.

## 2. Decision chain

1. **Venue orientation** (per venue, SPOT and PERP): FADE the final 10bps imbalance when the
   60s mean agrees in sign, otherwise FOLLOW it.
2. **Balanced Router**
   - Venues agree + activity guard passes → OB core route, direction = agreed orientation.
   - Otherwise → technical fill route: walk-forward logistic model on 41 features, trades only
     when `|p_green - 0.5| >= 0.06`.
3. **Precision Stack sleeves**
   - **Primary**: keep the Balanced direction when prior `trend_age_candles < 12`.
   - **Rescue**: when trend age >= 12 and upper-wick percentile(96) <= 0.20, flip the Balanced
     direction. Otherwise abstain.
4. Combined leg is what publishes; Balanced leg is retained and scored as a counterfactual, as is
   the previous Dual-Venue Adaptive chain.

## 3. Validation

**Oracle parity (224 rows):** zero mismatches on all legs (Balanced route + direction, Primary,
Rescue, Combined). Aggregates reproduce exactly: 66 combined trades, net +27, 70.77% win rate,
max drawdown 2.

**Production-vintage replay** (live canonical candles + `b4x4_es1_binance_ob_boundary_features`):
- Oracle window: 68 trades, net +27, max drawdown 2, max loss streak 2.
- Full universe (238 opportunities): 76 trades (31.9% coverage), 68.0% win rate, net +27,
  max drawdown 4.

Divergences vs the oracle are 1–2 trades and come only from vintage recompute of the technical
fill and the wick percentile; the direction logic is bit-exact.

**Latency:** boundary-time decision build measured at ~1.9 s with 218 training rows, against a
hard 6 s technical-fit budget.

## 4. Code and data changes

- `src/lib/b4x4es1/precisionStack.ts` — frozen research logic (router, sleeves, wick percentile).
- `src/lib/b4x4es1/precisionTechnical.ts` — walk-forward technical fill: median/robust scaling,
  one-hot categoricals, L-BFGS logistic fit (C = 0.03), refit in 16-opportunity blocks on strictly
  prior resolved opportunities.
- `src/lib/b4x4es1/precisionStack.server.ts` — live wiring: boundary feature load, context build,
  activation, decision persistence, resolution scoring.
- `src/lib/b4x4es1/orchestrator.server.ts` — Precision Stack is the authoritative publication
  source; webhook payload carries sleeve, route, technical confidence, wick percentile.
- `src/routes/api/public/hooks/es1-boundary-run.ts` — precision decision runs as the primary
  active step before publication.
- `src/lib/b4x4es1/statsQuery.server.ts` + `src/components/b4x4-es1-card.tsx` — stats tile,
  pending panel, 7-day history and attribution all read the `precision_*` scope.
- Migration: `precision_*` columns on `b4x4_es1_predictions` and `b4x4_es1_activation`
  (~50 audit fields: readiness, venue modes/imbalances, technical diagnostics, sleeve routing,
  decision reason, webhook eligibility, resolution).

## 5. Safety properties

- **Fail closed.** Any input-load failure writes an auditable abstention
  (`ABSTAIN_PRECISION_INPUT_LOAD_FAILED`); it never falls back to another model's direction.
- **Readiness gate.** No publication unless both Binance books report `ready` at the exact target
  boundary.
- **One-shot activation.** The activation boundary is committed exactly once, at the first target
  where both books are ready, and always points to a future clean boundary. Rows before activation
  are recorded but never published.
- **Never mutates history.** Earlier chains keep their own columns and remain scored.
- **Idempotent resolution.** Scoring is guarded on `precision_resolved_at IS NULL`.

## 6. Open item

The last 12 live boundaries (through 23:30Z 2026-08-18) show `precision_*` as NULL and
`b4x4_es1_activation.precision_mode` unset, i.e. the deployed runtime still runs the pre-patch
build. **Publish the app** so the boundary hook picks up the Precision Stack; the first qualifying
boundary then arms activation at T+15m and publication begins from that boundary onward.
