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

## 2. Version 1 today: decision → storage (no dispatch)

Live worker: SHA `19a0eb72af970b4bb857dd8d9293490d3e831af9`, Railway deployment
`7e5f4c14-d2fc-4fe9-b1ac-8e218ad3f69e`, sole writer.

Path actually in use:

```
worker decision  ->  signed POST /api/public/hooks/c85-ops  (op "decision.commit")
                 ->  RPC c85_commit_decision  ->  c85_targets row (+ paired checkpoint)
```

The betting path (`/api/public/hooks/c85-decision` -> `c85_outbox` -> `deliverWebhookNow`
-> bot endpoint) is **not** used by Version 1 at all.

## 3. Exact controls that keep it off (four independent gates)

1. **Worker**: `src/litea/main.py` constructs no gateway client for this identity;
   `src/litea/worker.py` stamps `execution_enabled: False` on every decision.
2. **Server trust boundary**: `C85_DISPATCH_FORBIDDEN_MODEL_VERSIONS` contains
   `lite-a-floor4-top10-r1`; `decision.commit` rejects any outbox entry under it (HTTP 400).
3. **Allow-list**: `WEBHOOK_ALLOWED_MODELS = { "t45-priceflow" }` — both delivery
   functions drop any other model's payload before a POST is built.
4. **New, default-OFF**: `liteaExecutionEnabled()` returns true only when
   `LITEA_EXECUTION_ENABLED === "true"`. The variable is unset, so a deploy or restart
   cannot come up enabled.

## 4. Remaining blockers (measured, not assumed)

- **Worker cannot dispatch.** No gateway client exists for Version 1. A worker code change
  plus a Railway deploy is required. This is not a flag.
- **Publication offset exceeds the existing T+5s ceiling.** Measured
  `publication_offset_ms` on the newest live rows: 5774.8, 5877.1, 6073.9, 5811.7, 5747.7 ms.
  `C85_PUBLICATION_DEADLINE_MS` is 5000, so every one of these decisions would be recorded
  `EXPIRED` by the existing gateway. Either the timing budget or the ceiling must be resolved
  before any live send is meaningful.
- **No executable odds captured.** The worker persists strike diagnostics only
  (`features.market_diagnostics`: polls, receipts, source chosen, conflict, freeze timing).
  It does **not** persist `yes_bid`, `yes_ask`, `last_price`, or depth, and `last_yes_price`
  is null on every Version 1 row. Capturing them needs a worker change + deploy.
- **Fill price, filled size, fees, order id and realised P/L do not exist in this project.**
  They are owned by the separate betting bot and must be read from it. They are not modelled,
  estimated or invented here.
- Strikes may be approximate under `strike-fallbacks-free-r1` (official Kalshi first, then
  Coinbase, then Kraken). No historical win rate, odds figure or profitability is implied.

## 5. Decision payload and semantics prepared for activation

`src/lib/litea/webhook.server.ts` (not called from any live path):

- `buildLiteAWebhookPayload()` — same field names the bot already accepts from T45
  (`model`, `prediction` YES/NO, `direction` GREEN/RED, `trade`, `confidence`,
  `candle_starts_at` / `candle_ends_at`, `dedupe_key`), plus Version 1 provenance
  (`probability_yes`, `admission_rank`, `decision_status`, `market_ticker`, `strike`,
  `strike_source`, `strike_estimated`, `packet_freeze_ns`, `decision_durable_ns`,
  `publication_offset_ms`).
- **Side**: `final_side` +1 -> YES/GREEN, -1 -> NO/RED, 0 -> never emits.
- **Target**: the 15-minute interval open; the decision is taken at open from `[T, T+5s)`.
- **Dedupe**: `lite-a-floor4-top10-r1:<ticker>:<target_open_utc>` — one per contract
  per interval; retries and duplicate workers collapse onto it.
- `liteaExecutionGate()` returns the verdict a send would produce. With today's constants
  it returns `EXECUTION_DISABLED` for every input.

Proof: `src/lib/litea/__tests__/activation.test.ts`, 9 tests, in-process fake receiver,
no network, no real endpoint. It asserts that nothing is delivered while the gates hold.

## 6. What a human would do to activate (do not perform now)

1. Add worker-side dispatch for this identity and deploy it to Railway (code + deploy).
2. Resolve the T+5s publication budget, or change the ceiling deliberately.
3. Remove `lite-a-floor4-top10-r1` from `C85_DISPATCH_FORBIDDEN_MODEL_VERSIONS`.
4. Add `lite-a-floor4-top10-r1` to `WEBHOOK_ALLOWED_MODELS` (and decide whether T45 keeps
   its slot — the bot endpoint is shared).
5. Set `LITEA_EXECUTION_ENABLED=true` in the app environment.

**To stop it again**, any one of these is sufficient and takes effect on the next boundary:
unset `LITEA_EXECUTION_ENABLED`, remove the model from `WEBHOOK_ALLOWED_MODELS`, or set
`webhook_endpoints.is_active = false` for the bot endpoint. Records are preserved in all
three cases.

Steps 1 and 2 mean activation genuinely requires code and a deploy; it is not a flag flip.
