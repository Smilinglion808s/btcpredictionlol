# Original U / V1.2 recording worker

This binary cannot submit exchange orders. It observes committed V1 and T45R2
decisions, reconstructs original U, and sends separate authenticated shadow
events through the predictor's authenticated standalone recording backend.

Locked sizing: V1 4% maker-only, T45R2 5% taker-only, U 10% maker-only, all from
one America/Boise day-opening shared cost-basis equity snapshot. T45 fees are
inside its budget. The pure order planner lives in `src/lib/v12/execution.ts`;
it is not attached to the existing order executor.

## Runtime

- Railway source root `services/v12-worker`, Dockerfile `Dockerfile`, start
  `python src/service.py`, health `/healthz`, one replica.
- `V12_MODE=shadow` (any other value refuses startup).
- `V12_SHADOW_ADAPTER_URL=https://alevdzyisibxcvwoyrqb.supabase.co/functions/v1/v12-shadow-adapter`.
  The published website is no longer a required hop. The legacy exact website
  URL remains recognized in code for compatibility, with no automatic fallback.
- `C85_GATEWAY_SECRET`: reference the existing worker secret within Railway.
  The worker needs no betting credentials or database service role.
- `V12_CAPTURE_DB=/data/v12/capture.sqlite`; persist `/data/v12` on a volume.
- `PORT` supplied by Railway. `/healthz` reports process and capture status;
  HTTP 200 means process availability, not strategy readiness or profitability.
- On backend startup, a signed connection probe checks authentication to all
  three recording receivers without creating signal rows. Its health result
  is distinct from actual deliveries. Successful context reads clear stale
  adapter errors and report current eligibility and early-feature availability.

Public inputs: complete COIN-M BTCUSD index minutes, BTCUSDT spot/perpetual
minutes with native taker-buy quote volume, and Kalshi point-in-time books.
The existing first-45-second features and exact recorded-opportunity context
are read from the predictor. Missing inputs cause a skipped checkpoint.
Historical quote snapshots are never fabricated on restart.

The frozen Sep14 L/R artifacts expire October 5, 2026 UTC. Model hash and
expiration are checked. `refit.py` and the background refresh loop preserve
the original 21-day schedule, 84-day lookback, one-day embargo, checkpoint
sets and estimators. The Oct5 fit can be prepared after Oct4 00:10 UTC and
becomes valid only on Oct5. A failed fit never extends the previous expiry.

The hash-pinned monthly training-seed files contain the already audited input history
through Sep16, with arrival prices and policy-selection fields removed.
Training capture records ALL input-ready opportunities, independent of U's
eligibility, using only quotes before each boundary and bars received within
its five-second window. Official finalized outcomes are collected separately;
their observed timestamps must precede the next training cutoff. Missing
inputs remain missing. Recent coverage and estimator integrity checks can
hold a refresh, and are reported in status. Both artifacts are written before
an atomic manifest makes a new fit available. Training runs in a separate
process. Raw capture retains three days; training frames retain 100 days.

The signed heartbeat records sanitized status in the predictor database.
Every publish first acquires a unique predictor delivery-journal record;
the exact leg determines its endpoint, model ID and HTTP identity headers.
A successful receiver response records its receipt ID. An ambiguous response
is marked UNKNOWN and never triggers an automatic duplicate delivery.

## Verification

From repository root:

```
node --experimental-strip-types --test src/lib/v12/*.test.ts supabase/functions/v12-shared/receiver.test.ts
OPENBLAS_NUM_THREADS=2 python3 services/v12-worker/tests/runtime.py
OPENBLAS_NUM_THREADS=2 python3 services/v12-worker/tests/refit.py
OPENBLAS_NUM_THREADS=2 python3 services/v12-worker/tests/parity.py <recovered-evidence-root>
OPENBLAS_NUM_THREADS=2 python3 services/v12-worker/tests/input_parity.py <recovered-evidence-root>
```

The archived evidence is the saved V12_U_Continuation_Evidence package.
Parity covers 792 historical and 135 later admissions, frozen predictions,
10,848 minute-state rows, and 96 early-feature targets.

## Release boundary

New Supabase receivers `/v12-v1`, `/v12-t45r2`, `/v12-u` record only. Their SQL
tables cannot enable execution. Do not repoint them to `place-trade`.
The existing V1.1 executor and its settings remain separate.

The user owns betting in a separate system. This predictor does not need an
account balance or daily opening to publish a valid signal. Sizing/policy
fields are handoff metadata. A recording receiver's DAY_OPENING_UNAVAILABLE
status still acknowledges and stores the prediction. Exchange execution,
fill handling and bankroll accounting belong to the downstream system.
See `docs/v12-webhook-handoff.md` for the three exact destinations and contract.
