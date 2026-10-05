# V3 — minimal predictor-to-bettor integration

Implement in the existing BTC Predictor Pro repository, not a new app. The user
authorizes building V3 and wants one simple signed webhook, using the existing
bettor controls. Do not enable real-money forwarding or place test orders.

## Frozen model, not an imitation

- `model.py` is the executable reference for PF-E008, identity `v3-pf-e008-r1`.
- `forward_candidate.json` is the prior research lock. No parameter search now.
- `seed.json.gz` contains the preceding 90 scheduled days of prefix features and
  closed OKX labels, Oct5 daily heads, and the preceding 768 confidence values
  per learner. It is a dated seed, not a permanently valid model.
- `replay_fixture.json.gz` has eight complete days, daily coefficients, starting
  confidence histories and expected probabilities/ranks/directions/checkpoints.
- `verification.json` reports independent replay parity against the research.
- Pin numpy 2.3.5, pandas 2.2.3, scipy 1.17.0, scikit-learn 1.8.0 only if these
  match the actual export environment; consult `environment.json` for truth.
- Infer using the exported coefficients/scaler and refit with the reference
  sklearn solver. Do not substitute a handwritten TypeScript optimizer.
- Return/range/flow are first-N-second prefixes, not trailing windows. The
  source feature formulas were checked against `src/lib/t45/features.ts`.
- Missing/nonfinite features must not be coerced to zero. Both independent
  learner histories advance on each valid prediction, even when T15 qualified.
- Rank against strictly earlier learner confidences, then append exactly once.
- T15 >=70th percentile freezes the direction. Otherwise T30 may qualify.
  No T45 fallback, future-price veto, second signal, stake adjustment, doubling,
  claimed win probability calibration, or parameter retuning.

## Smallest integration that remains faithful

Reuse existing V1.2/V2 transport conventions, risk controls and operational
patterns. Prefer an isolated `services/v3-worker` addition with durable local
SQLite state and a direct configurable signed webhook over duplicating the
whole V2 database, outbox tables, record route and dashboard control plane.
Reuse/import or narrowly adapt established feed/journal/health patterns.
Do not modify V1.2/V2 behavior or its live switches.

The current collector publishes its 45 seconds only after T45, so it cannot
provide timely T15/T30 scoring unchanged. The V2 feed currently omits Binance
taker-buy QUOTE volume. For V3 retain k.Q and REST kline[10] alongside k.q;
base-volume approximations are not model parity. A separate read-only feed in
the isolated worker is acceptable if it avoids restarting the live collector.

### Continuous data and daily fit lifecycle

Use final Binance GLOBAL Spot BTCUSDT 1s klines for features. Use confirmed OKX
BTC-USDT 15m candles for the training direction, not Binance or Kalshi labels.
Kalshi settlement is only for evaluating the actual bet, not this frozen fit.
No exchange trading credentials are required.

Persist the seed, daily heads, both learners' predictions/confidences, feature
rows, confirmed labels, selected signal and outbox on a durable volume.
Incrementally refresh features and labels, including startup gap repair using
exact Binance quote fields. Do background catchup, never REST on the timed
scoring path. Historical reconstruction may restore rank history but cannot
create a deliverable signal for a missed candle. Rebuild rank histories using
each historical day's correct fit; never score all history with today's fit.
Keep an explicit catchup watermark; do not become ready with silent gaps.

Daily UTC fit uses the prior 8640 scheduled slots and only targets closed at
the day's start. Require at least 2688 valid rows and both classes. Retain the
training source/provenance and fit cutoff. Refresh before signals are allowed
on a new UTC day. An expired fit or unresolved catchup pauses V3, not V1/V2.
Refit/catchup runs off the scoring thread. No future labels, seed dates, or
unavailable-data assumptions may be fabricated to pass readiness.

### Timing and restart rules

Only score T15 with finalized offsets 0..14 and T30 with 0..29, received by
the documented live checkpoint deadline (use a narrow <=1s grace, separately
logged as an operational tolerance, not a new research filter).
Freeze the earliest qualifying decision, then emit at T48. Append each head's
confidence exactly once, including when its rank is too low or the other head
already qualified. Never replay a missed checkpoint after a late restart.
If T15 was never validly attempted because of an outage, fail the candle closed
instead of treating it as a known below-threshold result for T30.
Clock skew, stale feed, missing seconds, expired fit and corrupt state fail
closed with a reason. Audit all scheduled opportunities, not just selections.

At T48, serialize and persist the exact body once before delivery. Retries must
use exactly those bytes and the same event ID. Strictly expire at T49 (short
transport window; late delivery is rejected, never chased). A retry after a
timeout may be a duplicate; require downstream idempotency. Do not mark an HTTP
error as delivered, and do not reconstruct sent_at on every retry.

## Webhook contract

Use the existing body/HMAC conventions from `docs/v12-webhook-handoff.md` but
with a distinct V3 model identity and a configurable V3 receiver URL. Never
send V3 to v12-v1, v12-t45r2, v12-u, or V2's receiver. The receiver must register
V3 as another input to the same order engine, not a duplicate trading engine.

Required fields (reuse the repository's exact market/interval-key formats):

| Field | Meaning |
|---|---|
| schema_version | `v3-signal/1` |
| model_version | `v3-pf-e008-r1` |
| event_id | deterministic model + shared interval key |
| interval_key | route-independent exposure key, same as V1.2/V2 |
| market | same BTC 15-minute market namespace as existing payload |
| prediction | `YES` or `NO` |
| candle_starts_at | UTC candle open |
| decision_at | actual T15/T30 selection time |
| checkpoint_seconds | 15 or 30 |
| entry_at | candle open +48 seconds |
| expires_at | candle open +49 seconds |
| sent_at | timestamp when fixed outbound body is first prepared |
| confidence_rank | ranking statistic, NOT calibrated win probability |
| fit_version | daily fit identity |
| mode | explicit record-only/shadow until an operator configures real use |

Header: `x-btc15m-signature: sha256=<HMAC-SHA256 of exact raw UTF8 body>`.
Reuse existing shared signing secret via server-side configuration, never
commit its value. One V3 URL, existing secret, and an off-by-default delivery
switch are enough. Separate signal capture from external webhook enablement.
Keep the sender incapable of placing exchange orders.

No stake, bankroll, maker/taker mode, max price, limit price, guessed ticker or
odds derived from the historical average should be hardcoded in this body.
The existing bettor owns market resolution, entry-price limit, size, aggregate
exposure, its existing kill switch, actual fees and fill handling. It rejects
wrong/stale/duplicate signals and allows no extra position merely because V3
has a new model ID. A tiny receiver registration is expected if it allowlists
model identities; do not claim that registration already exists.

## Delivery and verification

Build and test source, leave external forwarding disabled. Do not publish new
database migrations, alter existing Railway services, set production secrets,
or enable any receiver execution switch as a side effect of this task.
If a new source-only worker needs deployment, document its exact root,
Dockerfile, watch path, durable volume, variables and /healthz. Current V1.2
and V2 Railway services already have per-service watch patterns. Avoid
collector edits, since the collector may redeploy on unrelated repo commits.

Tests must cover supplied replay parity, feature-prefix/quote-volume parity,
daily expiry, training cutoff, rank ties/minimum, both histories advancing,
T15 precedence, no fallback, late/missing feed, restart idempotency, exact-byte
HMAC, duplicate events, delivery switch off, expiry/retry, and stale/corrupt
seed failure. Mock all outbound network in tests; never ping the live bettor
with a prediction. Return actual test results and changed files, with explicit
remaining deployment/receiver steps. Do not claim profitability or readiness
solely from backtest parity.
