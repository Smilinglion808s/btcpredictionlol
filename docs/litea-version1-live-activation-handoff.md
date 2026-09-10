# Version 1 (lite-a-floor4-top10-r1) — human activation handoff

Status at time of writing: **execution HARD OFF, and it stays off after this change.**
Nothing in this repository sends a Version 1 order-generating payload anywhere.

## 1. T45 outbound cessation (already performed by the operator)

| Control | Before | After |
| --- | --- | --- |
| `t45_pf_activation` (T45_PRICE_FLOW) `webhooks_enabled` | `true` | `false` (2026-09-10 16:54:48.506237Z) |
| `t45_pf_activation` `mode` | `ACTIVE` | `ACTIVE` (scoring/collection continue) |
| `t45_activation` (T45_BALANCED) | `SHADOW_ONLY` / `false` | unchanged |

Sender paths verified to read these gates live, per boundary run, with no cached bypass:

- `src/lib/t45pf/orchestrator.server.ts` reads `t45_pf_activation` on every run and
  computes `webhookArmed = runMode === "LIVE" && mode === "ACTIVE" && webhooks_enabled === true`.
  `webhookArmed` gates both the cascade claim and the send; when false the send promise is
  `null`, so no POST and no retry chain is created.
- Retries live only inside `deliverWebhookNow(...).settle` for a POST that already fired.
  There is no queue, cron sweeper or stored-and-forward table for T45, so no send can be
  replayed after disablement.
- `src/lib/webhooks.server.ts` still restricts `WEBHOOK_ALLOWED_MODELS` to `t45-priceflow`;
  that constant was left untouched so the DB flag is the single operator control.

Newest delivery evidence (`webhook_deliveries`, times UTC):

- last T45 delivery: `2026-09-10 16:45:48.050039Z`, target `16:45`, HTTP 200, attempt 1.
- deliveries after the 16:54:48.506237Z disablement: **none**.
- nothing was in flight at disablement (16:45 completed on attempt 1, 200, nine minutes earlier),
  so no delivery had to be reported as partially sent, and no row was deleted.

## 2. Version 1 today: decision → storage (dispatch built, switched off)

Live worker: SHA `19a0eb72af970b4bb857dd8d9293490d3e831af9`, Railway deployment
`7e5f4c14-d2fc-4fe9-b1ac-8e218ad3f69e`, sole writer. It does **not** contain the
dispatch code below — that ships only with a new worker release.

Path in use today, and the prepared extension (both switches off):

```
worker decision -> signed POST /api/public/hooks/c85-ops ("decision.commit")
                -> RPC c85_commit_decision -> c85_targets row (+ paired checkpoint)   [always]
                -> [only if BOTH switches are true]
                   c85_outbox reservation (idempotent, dedupe_key) -> deliverWebhookNow -> bot
```

Durability is unchanged and comes first: the decision row is committed by the same
transactional RPC before any dispatch step is even considered. A failed or refused
dispatch never affects the recorded decision.

## 3. Controls (all default OFF; nothing turns on by deploy or restart)

| Layer | Control | Default | Effect when unset |
|---|---|---|---|
| Worker | `LITEA_EXECUTION_ENABLED` | unset (off) | `prepare_outbox` returns `EXECUTION_DISABLED`; the signed commit carries no `outbox` field at all |
| Backend | `LITEA_SERVER_EXECUTION_ENABLED` | unset (off) | `decision.commit` rejects any V1 outbox with HTTP 400 "shadow-only"; V1 is not in the effective send allow-list |
| Transport | `LITEA_TRANSPORT_DEADLINE_MS` | 8000 (bounded 1–60000) | V1-only send ceiling measured from target open. Not an order-placement guarantee; adjust before activation |

`C85_DISPATCH_FORBIDDEN_MODEL_VERSIONS` still lists `lite-a-floor4-top10-r1`; it is now
waived **only** while `LITEA_SERVER_EXECUTION_ENABLED=true`, so no code edit is needed to
activate and no edit is needed to revoke. `WEBHOOK_ALLOWED_MODELS` still statically contains
only `t45-priceflow`; V1 is added dynamically by the same switch. C85 and T45 behaviour,
and the old 5000 ms `C85_PUBLICATION_DEADLINE_MS`, are untouched.

**Kill switch**: unset `LITEA_SERVER_EXECUTION_ENABLED` (backend, immediate — stops sends
even for already-reserved retries), and/or unset `LITEA_EXECUTION_ENABLED` (worker, stops
requests at source), and/or set `webhook_endpoints.is_active = false`. Records are preserved
in every case.

## 4. What is admitted, and what can never be

Source of truth is the persisted decision row, re-checked on the server, not the worker's word:

- model identity `lite-a-floor4-top10-r1`, `run_mode = LIVE`
- `final_side` is +1 or -1 (0 = abstention: never reserved, never sent, never graded as a call)
- `features.input_valid === true` and a present `features.lite_a.head_id` (current head)
- valid ticker and target interval
- `publication_offset_ms` present, finite and non-negative (NaN/∞/negative are rejected —
  this was a real hole in the earlier gate and is now closed)
- wall-clock age from target open is re-measured at intake **and again immediately before
  each send/retry**, and must be under the V1 transport ceiling

Consequences: historical rows, shadow/research rows, queued pending rows that age out, and
rows committed before activation can never turn into orders. Activation affects only fresh
decisions that are still inside the ceiling.

## 5. Payload, dedupe and what the bot must do

Payload is rebuilt on the server from the persisted row (`liteaPayloadFromRecord`), using the
field names the bot already accepts from T45: `model`, `prediction` (YES/NO), `direction`
(GREEN/RED), `trade`, `confidence`, `candle_starts_at` / `candle_ends_at`, `dedupe_key`, plus
V1 provenance: `probability_yes`, `admission_rank`, `decision_status`, `market_ticker`,
`strike`, `strike_source`, `strike_estimated`, `packet_freeze_ns`, `decision_durable_ns`,
`publication_offset_ms`.

- **Side**: `final_side` +1 → YES/GREEN, −1 → NO/RED, 0 → nothing emitted.
- **Target**: the 15-minute interval open. The decision is taken at open from `[T, T+5s)` —
  not at candle close. That model window is unchanged and is not traded off against transport.
- **Dedupe key**: `lite-a-floor4-top10-r1:<ticker>:<target_open_utc>`. One exclusive claim per
  contract per interval; only its owner may deliver, and the Version 1 path makes exactly one
  automatic attempt per configured endpoint (no background resend for any response, timeout,
  exception or cancellation).

**Requirements on the external bot (unknown until confirmed by its owner):**
1. it must accept `lite-a-floor4-top10-r1` in its own model allow-list — an HTTP 200 from the
   old T45 traffic does **not** prove this;
2. it must honour `dedupe_key` itself. Our dedupe gives one *exclusive dispatch operation* and
   at most one attempt per configured endpoint; it cannot guarantee one *broker fill*, and with
   several endpoints configured it is not a single global signal either.

**Not available here, at all**: fill price, filled size, fees, order id, realised P/L. Those are
owned by the betting bot. Also not persisted today: `yes_bid`, `yes_ask`, `last_price`, depth —
capturing practical odds would need a further worker change.

## 6. Activation (human only — do not perform automatically)

0. Apply the prepared claim migration `supabase/prepared/20260910_litea_outbox_exclusive_claim.sql`.
   Until it is applied the claim returns `UNAVAILABLE` and nothing is delivered. Verified on a
   disposable local PostgreSQL 17.9 instance only; runtime against production is unverified.
1. Deploy the **worker** release containing `src/litea/dispatch.py` to Railway (Railway stays
   sole writer), with `LITEA_EXECUTION_ENABLED` still unset. Verify shadow behaviour is unchanged.
2. Deploy the **backend** release containing `src/lib/litea/dispatch.server.ts`, with
   `LITEA_SERVER_EXECUTION_ENABLED` still unset.
3. Confirm the bot accepts the V1 model id and honours `dedupe_key`.
4. Decide the transport ceiling: measured publication offsets are ~5.7–6.1 s, so the default
   8000 ms admits them; the old C85 5000 ms gate would have rejected all of them. This is a
   transport choice, not a model change, and it does not promise a fill.
5. Set `LITEA_EXECUTION_ENABLED=true` on the worker, then `LITEA_SERVER_EXECUTION_ENABLED=true`
   on the backend. Only fresh decisions after that take effect.

No step above has been performed. Both switches are absent, nothing is deployed by this change,
and no payload has been sent to any real endpoint.

## 7. Proof (software path only, no live betting or fill proof)

- `src/lib/litea/__tests__/duplicateSend.test.ts` — 9 tests: default-off zero attempts, two
  concurrent same-key requests yielding one claim and one delivery, terminal replay refused,
  expiry during the wait, kill switch flipped between checks, clock/switch re-checked after the
  awaited ownership read, ownership error failing closed, owner-only terminal write.
- `src/lib/litea/__tests__/transportGuard.test.ts` — 7 tests against an in-process receiver:
  no post when the guard is false, no post with the control absent, no resend after HTTP 500,
  after a timeout/thrown error, or after a cancelled attempt; one delivery on success; legacy
  unguarded callers keep their retries.
- `src/lib/litea/__tests__/dispatch.test.ts` — 9 tests: both controls off, allow-list separation,
  admitted send to an in-process fake receiver, failed delivery, duplicate/replay, expiry between
  reservation and send, disable-before-retry, abstention, wrong identity/head/input/timing.
- `src/lib/litea/__tests__/opsPath.test.ts` — 5 tests through the real `decision.commit` handler
  with a fake database and clock: refusal while off, unchanged shadow recording, durable-then-
  claim when on, delivery built from the committed record rather than an altered replay body,
  no dispatch when the committed record cannot be read back, no target amendment when the
  owner-conditional settle matches nothing, stale row refused, C85/T45 unaffected.
- `src/lib/litea/__tests__/activation.test.ts` — 9 tests (payload/gate, incl. NaN timing).
- `services/c85-worker/tests/test_litea_dispatch.py` — 6 tests: default-off preparation, admitted
  outbox identity, stable retry identity, row-level rejection, bounded deadline, and that the
  signed commit omits `outbox` entirely when off.

None of these make a network request, write production state, or start a worker.
