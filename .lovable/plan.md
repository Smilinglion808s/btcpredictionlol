# T30 Cross89 Balanced R1 — staged build

A new, fully isolated model that predicts the direction of the OKX BTC-USDT 15-minute
candle it is already inside, 30 seconds after it opens. Direction comes from the first
30 seconds of Binance Spot movement; an 89-feature logistic head estimates the
probability that direction stays correct through candle close.

The existing 28-feature "T30 PriceFlow Balanced" model is left untouched and keeps its
own tables. T45 PriceFlow is not modified in any way.

## What gets built

**Identity and features**
- New frozen config module: model version `t30-cross89-dual-rank-r1`, 89-feature order,
  hash `7b4df105…`, block size 96, first fit index 2784, lookback 8640, ranks 768/0.625
  and 96/0.50, default mode `SHADOW_ONLY`.
- 24 direction-aligned price-flow features from the 0–29 second packet.
- 30 prior-candle Binance Spot 15m technicals + 35 Binance USD-M perpetual technicals,
  every series shifted one row so nothing from the in-progress candle leaks.

**Storage** (new, isolated tables)
`t30_cross89_samples`, `_features`, `_fits`, `_predictions`, `_activation`,
`_policy_shadows` — with full prediction-time input capture, gates, fit provenance,
odds audit fields, resolution columns and RAW scoring.

**Pipeline**
- `POST /api/public/hooks/t30-cross89-ingest` and `…-boundary-run`, signed with the
  existing T45 secret under `x-t30-timestamp` / `x-t30-signature`.
- Orchestrator: packet readiness → base direction → prior technicals → 89-vector →
  certified fit → probability_correct → long/fast rank → frozen decision rule, with the
  12 required abstain/publish reasons in the specified first-match order.
- Certified L-BFGS head (C 0.003, tol 1e-6, max_iter 500, RobustScaler 10/90,
  day-balanced weights), double-fit hash equality, advisory-lock + unique constraint,
  and a one-boundary-ahead fit preflight so a rollover can never stall the decision.
- Shadow policies persisted only; webhooks stay disabled.

**History and verification**
- Backfill Binance Spot 1s packets, Spot 15m and USD-M perp 15m technicals for
  2025-12-01 → 2026-08-18 (25,056 source rows).
- Walk-forward replay, then reconcile against the frozen checkpoint: 21,201
  opportunities, 7,979 trades, 4,957W/3,022L, +1,935 raw, 62.1256% win rate, and the
  frozen decision hash `f1454708…`. Monthly totals checked too.
- If anything diverges, the build stops and reports the first divergent row rather than
  tuning thresholds.

**Surface**
- New T30 Cross89 dashboard card (collector status, latency, fit/rollover, probability,
  ranks, coverage, W/L/PUSH, raw net, drawdown, streaks, Boise-day results, odds
  diagnostics, abstain reasons, shadow policies, last 96 rows).
- `T30-Cross89-Balanced.csv` and `…-last-24h.csv`, paginated newest-first then reversed.

**Tests**
Deterministic suite covering packet rules, leakage, feature order/hash, labels, fit
boundaries and determinism, rank strictness, gate equality, resolver idempotency,
webhook suppression, CSV pagination beyond 1,000 rows, T45 zero-difference, and the
frozen checkpoint + decision hash.

## Order of work

1. Config, features, technicals, head — plus unit tests.
2. Migration for the six tables.
3. Backfill + walk-forward replay, checkpoint reconciliation (gate: hashes must match).
4. Live orchestrator, hooks, activation singleton, fit preflight.
5. Dashboard card, CSV exports.
6. Full test suite, typecheck, lint; then observe three natural LIVE shadow boundaries.

## Notes

- Railway cannot be deployed from here. I will return the exact collector diff and env
  additions needed to emit the 0–29 packet to the new ingest endpoint, keeping the
  existing single WebSocket and leaving the T45 0–44 path untouched.
- Deployed `SHADOW_ONLY`. No webhooks are enabled in this task, and no historical,
  backfill or catch-up row can emit one.
- The historical checkpoint depends on Binance Spot/perp archive availability for the
  full window; if an archive day is missing the source-row count will not reconcile and
  I will report it rather than proceed.
