# v3-predictor-worker: PF-E008 (`v3-pf-e008-r1`)

## R3 calibrated-risk integration — 2026-10-07

Policy `v3-calibrated-risk-r3-r1` implements the simple calibration router
selected in R3. At T45 it prefers an original risk-passed V3 call. Otherwise it
selects T15 rank >= .60, else T30 rank >= .60, and recomputes all reversal
features for that candidate's own side/rank with the existing historical risk
head. A risk failure cannot be overridden. The correctness calibration keeps
baseline calls at p >= .55 and adds otherwise uncalled candidates at p >= .64.
It does not fade or change the side of a risk-passed baseline call.

The two score streams and original reversal-training population stay intact.
Every eligible virtual candidate is stored, including skipped/untraded ones.
Official finalized Kalshi outcomes settle these rows; they are never replaced
with OKX direction or lab-proxy labels. New weekly fits use the preceding 26
weeks with a 24-hour settlement embargo and at least 500 candidates. Calibration
weeks begin Monday 00Z, not the reversal head's Monday 06Z. Fitting is off the
scoring thread. All state and head parameters are durable in the existing
SQLite volume, without pickle/joblib deserialization.

`V3_CALIBRATION_MODE` supports:

- `shadow`: default when reversal enforcement and T48 are active. Capture and
  score the new policy, preserving the current V3 decisions and webhook bytes.
- `off`: disable the new collector/policy. This is the automatic default for
  the older non-enforced-risk/ASAP configurations.
- `enforce`: requires an in-date, verified official-lineage calibration head;
  missing/corrupt/expired heads or inputs fail closed. T48 entry, T49 expiry,
  HMAC, idempotency and existing delivery controls still apply. Enforced bodies
  include `calibration_filter`; old/shadow bodies cannot bypass the new gate.

**Rollout is shadow, not an active calibration trading change.** The existing
risk seed contains about 8 weeks of original selections, not 26 weeks of the
required union population. It cannot bootstrap this new learner without bias.
No proxy or expired research head is installed and there is no automatic switch
from shadow to enforcement. A separately audited historical reconstruction or
prospective history is needed for a current official-lineage head. The worker
reports `CALIBRATION_26_WEEK_HISTORY_REQUIRED` while that history is absent.

Health/logs and the signed dashboard status expose calibration mode, readiness,
observation counts, settled candidate counts, lineage and current head hash/expiry.
The dashboard recorder accepts explicitly versioned calibration additions/skips,
and prevents older baseline heartbeats from undoing a final calibration intent.
Detailed candidate records remain in SQLite and `v3_calibration_decision` logs.
The V3 BTC tile shows calibration mode, history progress and latest check. Once
a current head exists, its separate forward record tracks kept/added/skipped
calls, official wins/losses, pending outcomes and Boise-day net wins. Warm-up
observations and proxy research results are excluded from that win rate. The
summary is computed on the background thread and sent through the existing
signed recorder, using its current JSON status column.
No database migration or bettor-setting change is included here.

Verification: `python -m pytest -q tests package/test_model.py`.
Optional offline R3 parity (requires pandas/pyarrow and the recovered lab outputs):
`python scripts/verify_calibration_r3.py /path/to/regime_104_r3/outputs`.
The new scorer/refitter reproduced all 78 historical calibration fits exactly,
with zero decision differences over 69,888 opportunities (first 26 weeks keep
the archived baseline). That is proxy-replay parity, not official/live parity.

## Reversal risk patch — 2026-10-06

The frozen directional `package/` is unchanged. A separate, versioned
`v3-reversal-risk-t45-r1` admission gate evaluates the selected direction at
T45 using seconds 0–44 and completed pre-open bars. It preserves that direction,
or skips; it never fades, exits, increases stake, or enables betting.

`V3_REVERSAL_MODE=enforce` is the service default. `off` restores the prior V3
behavior; `shadow` records scores without suppressing calls. Enforcement only
works with `V3_DELIVERY_POLICY=t48-r1`; an ASAP/enforce combination refuses to
start, rather than using future inputs or silently dropping the gate.

The original T45 research recipe is kept: 50 features; weekly logistic C=.01;
prior 8 weeks; one-day official-Kalshi-settlement embargo; at least 500 calls;
training-only median imputation and standard scaling; skip at or above the
training score's 75th percentile. No fixed probability cutoff or quota of live
trades is substituted. V3's own selected side/rank and original selected calls
(including subsequently skipped calls) train this explicitly separate adapter.
Weeks follow the research's fixed Monday 06:00 UTC anchor, including across DST.

Original T45 scorer replay: 3,875 rows, zero skip mismatches, maximum probability
error 2.23e-16. Raw feature parity: 64 historical samples, maximum absolute error
8.06e-9. Separately, on the priced V3 16-week replay: 3,734 base calls at 59.94%
vs 2,765 retained calls at 63.62%. Estimated net ROI remained negative (-2.59%
vs -2.26%); +1-cent stress remained negative. This is not the 67.84% original
T45 strategy, not 104-week validation, and not evidence of executable fills.

Context is fetched from public Binance APIs off the scoring thread. Weekly
refits consume finalized public Kalshi outcomes, never OKX proxy outcomes.
Missing/stale context, incomplete seconds, absent fields, stale/corrupt heads,
or failed clocks block enforced calls. Explicit mathematical nulls alone use
the training medians. The packaged head is valid through 2026-10-12 06:00 UTC;
the worker maintains future weekly heads from its persisted risk rows. Missing
refit data cannot extend that expiration.

The outbound base model identity remains unchanged for receiver compatibility;
the signed body adds `risk_filter` with policy version, head hash, probability,
threshold, cutoff and pass status. T48 entry/T49 expiry, HMAC, deduplication,
existing kill switches, and existing sizing are unchanged. Skips/invalid checks
are durably audited, and pending pre-patch bodies cannot bypass enforcement.
The V3 dashboard recorder accepts only matching-side/checkpoint risk vetoes and
cannot resurrect a finalized skip through an older selected record.

Tests: `python -m pytest -q tests package/test_model.py` (74 tests at patch build).

This worker runs the frozen PF-E008 model, built from first-15s and first-30s
price-flow learners. Each candle gets at most one direction. The worker can
post that direction as one signed webhook to the external bettor.

- **It cannot place orders.** It holds no exchange or betting credentials.
- **Delivery is off by default.** Calls are captured locally until delivery is
  switched on.
- **It never targets V1.2 or V2 receivers.** Their URLs are refused at startup.
- **Its only site link is the dashboard.** It can optionally report status and
  decisions to the dashboard-only `/api/public/hooks/v3-record` (`V3_RECORD_URL`).
  It makes no changes to V1.2, V2 or the collector.

## Layout
| Path | Contents |
|---|---|
| `package/` | Frozen handoff, byte-identical to the ZIP. Every file is checked against `SHA256.json` at startup. Never edit. |
| `src/v3core.py` | SQLite state, history, daily refit, T15/T30 decisions, T48 outbox, HMAC. |
| `src/net.py` | Read-only data feeds and the signed sender. Binance 1s klines keep the actual quote fields (`k.q`/`k.Q`, REST `[7]`/`[10]`); OKX 15m labels are confirmed candles only. |
| `src/service.py` | Threads and `/healthz`. |
| `tests/test_v3.py` | Offline tests. All outbound calls are mocked. |

## Behaviour
- **Scoring.** T15 is scored inside [15s, 16s) and T30 inside [30s, 31s). The
  final second is 1s grace, logged as `late_grace_used`. Scoring uses only the
  final websocket bars received by that deadline, with no network calls on the
  scoring path.
- **Both histories always advance.** Each valid head prediction is ranked
  against strictly earlier confidences, then appended once. This happens even
  when T15 already qualified.
- **Selection.** T15 with rank >= 0.70 freezes the direction. Otherwise T30 can
  qualify. There is no T45 fallback.
- **Failures.** If T15 fails because of an outage, late data or missing seconds,
  the candle fails closed and T30 runs for history only. Invalid data (for
  example zero quote volume) is research missingness, so T30 may still qualify.
- **Daily UTC refit.** Uses the frozen `fit_head` on the prior 8,640 slots and
  only labels closed by midnight. It needs at least 2,688 valid rows. The
  catch-up thread repairs gaps from REST, off the scoring thread. Each past
  day's candles are scored with that day's own fit.
- **Not ready.** A missing fit, an unresolved gap, a stale feed, clock skew
  over 1s, or a changed or corrupt package or seed pauses V3 and records the
  reason.
- **Delivery policy (`V3_DELIVERY_POLICY`).** Any other value refuses to start,
  and `/healthz` reports the active policy.
  - `t48-r1` (default, legacy): the body is persisted at T48, uses
    `schema_version` `v3-signal/1`, and `entry_at` = candle + 48s.
  - `asap-r1`: the body is persisted as soon as a T15 (or else T30) selection is
    stored. The scoring thread wakes the sender, and networking stays off the
    scoring path. The body uses `schema_version` `v3-signal/2`, adds
    `"delivery_policy":"asap-r1"`, and sets `entry_at` exactly equal to
    `decision_at`.

  In both policies, `expires_at` stays candle + 49s. Each candle gets at most one
  event. Retries and restarts resend the same bytes with the same `event_id`.
  The verified-market check, the clock gate and the T49 hard stop all still
  apply. T30 history still advances after a T15 selection, without a second
  event.
- **Responses.** 2xx counts as delivered. 4xx means rejected, and redirects are
  blocked as `REDIRECT_BLOCKED`. Timeouts, 5xx, 408 and 429 are retried until T49.
- **Restarts.** A late restart never replays a missed checkpoint.
- **Numeric parity.** Inference calls the frozen `predict` on a 96-row batch and
  takes row 0. A single-row call can differ by one bit from the research's
  batched path.

## Webhook body (`POST V3_WEBHOOK_URL`)
Header: `x-btc15m-signature: sha256=<hex HMAC-SHA256 of the exact raw body>`,
signed with the existing shared secret. Informational headers are
`x-v3-event-id` and `x-v3-model`.
```json
{"schema_version":"v3-signal/1","model_version":"v3-pf-e008-r1","leg":"V3",
 "event_id":"v12:KXBTC15M-26OCT052015-15:2026-10-06T00:00:00.000Z:V3",
 "interval_key":"v12:KXBTC15M-26OCT052015-15:2026-10-06T00:00:00.000Z",
 "market":"KXBTC15M-26OCT052015-15","prediction":"NO",
 "candle_starts_at":"2026-10-06T00:00:00.000Z","decision_at":"2026-10-06T00:00:15.214Z",
 "checkpoint_seconds":15,"entry_at":"2026-10-06T00:00:48.000Z","expires_at":"2026-10-06T00:00:49.000Z",
 "sent_at":"2026-10-06T00:00:48.003Z","confidence_rank":0.7421875,
 "fit_version":"v3-pf-e008-r1:t15:2026-10-06:3f2a9c1b7d4e","mode":"shadow"}
```
- `prediction` is `YES` for up and `NO` for down.
- `interval_key` is byte-identical to the V1.2 `intervalKey(ticker, open)`, so
  the bettor's existing per-interval exposure claim covers V3.
- `market` is never guessed. A separate background loop reads public Kalshi
  metadata (series `KXBTC15M`) off the scoring thread. A market is accepted only
  if its series matches, its close is the candle close, and its ticker matches
  that close. With no verified market there is no send (`NO_VERIFIED_MARKET`).
  This checks market identity only. It is not a price filter and never changes
  which call the model makes.
- The sender re-checks expiry immediately before each POST and caps the network
  timeout to the time left before `expires_at`. Anything listed before T49 is
  not sent after T49.
- `confidence_rank` is a rank, not a win probability.
- There are no stake, price, maker/taker or odds fields. The bettor owns all of
  them.

## Receiver requirements (separate betting app; not done here)
1. Register `v3-pf-e008-r1` as another input to the existing order engine, not
   a new engine.
2. Verify the raw-body HMAC before parsing.
3. Check that `expires_at` hasn't passed and that `market` matches the
   interval. Validate timing in two separate checks:
   - `decision_at` is early by design (about T15 or T30). It must fall inside
     the candle and be at or before `entry_at`.
   - Admission is based on `entry_at` and `expires_at` (T49) against the
     receiver's clock. For `v3-signal/1` (`t48-r1`), `entry_at` is T48. For
     `v3-signal/2` (`asap-r1`), `entry_at` equals `decision_at`, so the call is
     admissible as soon as it arrives.
   - Accept `v3-signal/2` before switching the worker to `asap-r1`.
   Do **not** reuse V1.2's "now minus decision under 10 seconds" age check. It
   would reject every valid V3 call. Also don't reuse V1.2's route policy or its
   three-identity allowlist directly. V3 needs its own allowlist entry. Only the
   raw-body HMAC and the shared risk/exposure engine conventions carry over.
4. Deduplicate on `event_id` and the body hash, and apply the shared
   `interval_key` exposure claim.
5. Apply its own size, price cap, kill switch and fees.
6. Keep its own V3 switch off until you turn it on.

## Railway activation (operator steps; not done)
1. Create a new service `v3-predictor-worker` from this repo:
   - root directory `services/v3-worker`, using the Dockerfile here;
   - watch path `services/v3-worker/**`;
   - health check path `/healthz`.
2. Attach a persistent volume at `/data/v3`.
3. Start with only `V3_DATA_DIR=/data/v3`. In this state it captures calls
   locally and sends nothing.
4. Watch `/healthz` until `prediction_ready=true`. The first start downloads
   today's missing Binance and OKX data in about 20 seconds per 90 candles.
5. To send, set:
   - `V3_WEBHOOK_URL` (the bettor's V3 receiver);
   - `BTC15M_WEBHOOK_SECRET` (the existing shared secret);
   - `V3_DELIVERY_ENABLED=true`.

   Keep `V3_MODE=shadow` until the receiver is registered and you decide to go
   live.

The seed is dated 2026-10-05. If the worker starts much later, catch-up fetches
every candle since then before it becomes ready. If Binance or OKX can't
supply them, it stays not ready rather than guessing.

## Tests
```
pip install -r requirements.txt pytest
python -m pytest -q tests/test_v3.py
cd package && python -m pytest -q test_model.py
```

## Official-history calibration bootstrap (2026-10-07)

`calibration_package/` supplies the missing 26-week training span, April 6 through
October 4, 2026 UTC. It contains 17,296 reconstructed intervals (176 archived
source gaps preserved), 5,828 finalized Kalshi candidate outcomes, and the
October 5 weekly head trained on 5,811 candidates after the existing 24-hour
settlement embargo. The head expires October 12 at 00:00 UTC; normal weekly
refitting then uses this history plus newly observed candidates.

The reconstruction uses the frozen OKX-label-trained V3 T15/T30 core and official
Kalshi risk/calibration outcomes. Both final core heads, both 768-value rank
histories, all 768 replay fixtures per learner, all 1,902 original risk seed rows,
and the current risk head reproduce exactly. Twenty-seven historical risk
heads use only the prior eight weeks and a 24-hour settlement embargo. Independent
raw-bar checks at 96 historical timestamps match the production risk feature
function within 5.18e-9. Historical risk fits preserve the original archived
technical inputs; replay evaluation recomputes production pre-open context.
The audit includes the input hashes and limitations.

Startup verifies all package hashes, candidate provenance, every stored risk
score against its weekly head and 50-feature vector, and an exact calibration
refit before one SQLite transaction. The import is idempotent, preserves real
observations and existing heads, and never creates decisions or outbox items.
With an overlap, the normal refitter derives the head from the merged population.
Expired packaged heads are never activated.

Reconstructed rows carry `origin=historical_reconstruction`, `replay_at_ms`, and
`reconstructed_at_s`; they do not claim historical live receipt times. The BTC
tile displays backfilled and forward intervals separately, and forward results
exclude all reconstructed rows. Default calibration remains **shadow**. This
bootstrap removes the history warm-up; it does not establish forward profitability
or change the approved thresholds, the reversal filter, or webhook delivery.
