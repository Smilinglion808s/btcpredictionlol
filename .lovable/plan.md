# V3 (PF-E008) — inspection findings and smallest hookup

This was a read-only inspection. No code, database, secrets, settings, deployment or sending was changed. V1.2 stays restored, and V2 forwarding stays off.

## Summary
The smallest safe path is to copy the V2 recording pattern for V3 and stop before the sending step:
- a worker that predicts, using the V2 worker's feed, scheduler, journal and sender;
- a signed site route that records each prediction;
- its own `v3_*` tables, with no sending queue, no forward trigger and no receiver URL;
- one dashboard tile.

Nothing reuses V1.2's or V2's receivers, sending queue or switches. So V3 cannot pass itself off as either one, or reach their receivers.

## Reusable parts, as found
| Need | Existing part | Path | Reuse as |
|---|---|---|---|
| 1-second Binance spot feed + server-clock checks | `SecondFeed`, `Rest`, `check_clock` | `services/v2-worker/src/marketdata.py`, `service.py` | Copy the module into the V3 worker |
| Exact second windows, fail closed, no fill-in | `run_window`, `scheduler_loop`, `blocking_reason`, `CHECKPOINTS` | `services/v2-worker/src/service.py` | Same loop with checkpoints T15/T30 and an intent window at T48 |
| Durable journal + at-least-once sender | `Journal`, `Sender.deliver_once`, `has_pending` | `services/v2-worker/src/journal.py`, `service.py` | Copy as is (T30 waits for T15 delivery, like T45 waits for T8 in V2) |
| Health/readiness | `/healthz`, `prediction_ready`, `feed_ready` | `services/v2-worker/src/service.py` | Copy as is |
| Signed recording | `verifyC85Signature`, `claimNonce`, `serviceClient`, `readBounded` | `src/lib/c85/gateway.server.ts`, `src/lib/c85/ops.server.ts`, `src/lib/v2/contract.ts` | New route `/api/public/hooks/v3-record`, same HMAC secret and nonce table |
| Atomic checkpoint + one intent per candle + repeat handling | `v2_record_checkpoint` (SECURITY INVOKER, empty search_path, service_role only) | `drizzle/migrations/0004_*`, `0005_*` | New `v3_record_checkpoint` on `v3_checkpoints` / `v3_candle_intents` (`model_version` fixed to `v3-pf-e008-r1`) |
| Outbox / forward | `v2_forward_outbox`, `v2_enqueue_forward` trigger, `forward.server.ts` | `drizzle/migrations/0006_v2_forward_outbox.sql`, `src/lib/v2/forward.server.ts` | **Not reused.** V3 gets no outbox, trigger, secret or URL |
| Dashboard + stats | `getV2Live` (record, coverage, daily), `V2Card` | `src/lib/v2Live.functions.ts`, `src/components/v2-card.tsx` | Copy into a V3 tile that says "shadow · no sending" |
| Alternative 1s source | Collector stores offsets 0–44 in `t45_second_samples` | `services/binance-ob-collector/src/t45Kline.js`, `src/lib/t45/store.server.ts` | Not recommended: it's tied to the T45 publish deadline. V3 should own its feed like V2 |

## Why not reuse V2's tables directly
`v2_record_checkpoint` writes `'v2-final-r1'` as fixed text, and the AFTER INSERT trigger on `v2_candle_intents` enqueues every intent into the V2 sending queue. Rows would be labelled V2 and queued for V2's receiver whenever that switch is on again. Separate `v3_*` tables are required.

## Decision policy to hook in (will come from the frozen package)
- Learners: first-15s and first-30s logistic regressions, C=0.001, RobustScaler(10,90).
- Refit: daily UTC, on the last 8,640 scheduled candles, with at least 2,688 fully resolved rows and equal day weights.
- Gate: T15 first; if it doesn't qualify, then T30. A call needs confidence rank of at least 0.70 against that learner's previous 768 predictions, with at least 192 needed.
- Direction is frozen once called. The intent is fixed at T+48s, with no T45 fallback.
- None of the coefficients, input meanings, label source or refit code are built until the package arrives. Without them nothing gets wired as a working model.

## Smallest build, once the package arrives
1. `services/v3-worker/`: the frozen package (hash-checked), plus the V2 worker's feed, scheduler, journal and sender copied in, with T15/T30 checkpoints and the T48 intent. It runs in shadow only and holds no betting credentials.
2. A migration for `v3_checkpoints`, `v3_candle_intents`, `v3_worker_runtime` and `v3_record_checkpoint`: service_role grants only, RLS on, and **no** outbox or trigger.
3. `src/routes/api/public/hooks/v3-record.ts`: signed, size-limited, nonce-checked. It only accepts `v3-pf-e008-r1` and never calls a forwarder.
4. A V3 tile and a `getV3Live` read.
5. Tests: parity against the package fixtures, one intent per candle, a T15→T30 test, and late-or-missing cases failing closed.

## Blockers
- The frozen source, fits, feed meanings, label source and parity fixtures haven't arrived yet.
- The refit runs daily, so the worker needs a resolved-label source and history. It must be confirmed whether the package ships a seed, or whether labels come from Binance index, OKX or spot.
- A new Railway service has to be created by you (root `services/v3-worker`, persistent volume, `V3_RECORD_URL`, the same signing secret). I can't set that up.
- The site route only goes live after you approve a publish.

## Deployment and linkage
- **Site:** edits under `src/` and migrations go live only when published. Migrations apply to the shared database when run.
- **Edge functions:** `v12-shadow-adapter` changes only when it is redeployed explicitly. V3 never touches it.
- **Railway:** the repo has no Railway config, so I can't confirm the watch settings from here. With Railway's default GitHub link, every push to the connected branch, including Lovable saves, rebuilds every service linked to that repo. Unless that service has watch paths set, that includes the running V1.2 worker (`services/v12-worker`). A rebuild restarts it, which could skip a candle. **Before any V3 source edits, set watch paths in Railway:**
  - `services/v12-worker/**` on the V1.2 service;
  - `services/v2-worker/**` on the V2 service;
  - `services/binance-ob-collector/**` on the collector.

## Technical details
- Identity: `model_version = v3-pf-e008-r1`. Sleeve IDs come from the package. The fixed recording-route check stops any V1.2 or V2 label from being written to V3 tables.
- Execution is fixed to `'OFF'` in the intent rows. There is no `V3_FORWARD_*` secret, and no URL check against `ruxndqfjfdbtdbkheuge`.
- `AGENTS.md` gets one new rule: V3 records only, through `v3-record`, with no outbox.
