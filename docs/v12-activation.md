# V1.2 release preparation

V1.2 owns three dedicated endpoints in the btc-trader backend
(`ruxndqfjfdbtdbkheuge`). The predictor sends only authenticated decisions.
The receiver database controls whether new decisions are recorded or executed.
The worker's `V12_MODE=shadow` describes its prediction/capture process and is
not the betting switch. The legacy V1/V1.1 webhook remains disabled.

| Route | Model | Budget | Execution |
| --- | --- | --- | --- |
| V1 | v12-v1-r1 | 4% | Maker, then capped taker fallback |
| T45R2 | v12-t45r2-r1 | 5% | Taker only |
| U | v12-original-u-r1 | 10% | Maker, then capped taker fallback |

Budgets share the existing daily_balance opening snapshot, use the Boise date,
round down to cents, and are capped by available cash and any existing dollar
cap. U retains the original 120/180/300/480/600/720 second checkpoints, value
limits, V1/T45 abstention requirements, and daily floor. One interval claim is
shared across the three routes; bet_history's existing unique claim also
prevents duplicate execution. These are eligibility rules, not promises that
each interval produces a prediction or a fill.

## Operator activation, after deployment verification

In Supabase **btc-trader → SQL Editor**, the operator can run:

```sql
UPDATE public.v12_release_config
SET mode = 'live'
WHERE version = 'v12-original-u-4-5-10-r1'
RETURNING version, mode, live_enabled_at;
```

The trigger timestamps activation. Earlier decisions and old recorded signals
are never replayed. This is the only V1.2 activation control; do not enable the
old webhook endpoint or change V1/V1.1 Railway/server execution flags. The
existing bot pause and stop-loss still apply. No deploy is needed for this
database switch. This SQL is documentation, not executed by the preparation.

To pause V1.2:

```sql
UPDATE public.v12_release_config
SET mode = 'shadow'
WHERE version = 'v12-original-u-4-5-10-r1'
RETURNING version, mode;
```

Pause prevents further submissions; any already accepted order retains its
short expiration and the existing cancellation/reconciliation lifecycle.

## Read-only confirmation

```sql
SELECT version, mode, live_enabled_at FROM public.v12_release_config;
SELECT paused FROM public.bot_config WHERE id=1;
SELECT received_at,route,model_version,status,execution_enabled,
       execution_status,bet_id,budget_cents
FROM public.v12_shadow_signals ORDER BY received_at DESC LIMIT 12;
```

The legacy table name is retained to preserve receipt history. A delivery
receipt reports acceptance, not an exchange fill. For actual execution, match
its bet_id with bet_history and the venue order ID. An ambiguous POST is not
retried; it keeps its exact durable intent for reconciliation. Shadow receipts
create neither bet_history claims nor exchange order requests.

## Deployment contents

1. Apply `docs/v12_receiver_release.sql` to the receiver database only. It
   creates the timestamped release gate and RPC but does not change mode.
2. Deploy `v12-v1`, `v12-t45r2`, `v12-u`, including shared receiver, contract,
   and generated executor. HMAC remains their authentication mechanism.
3. Deploy predictor `v12-shadow-adapter` from its r3 generated bundle. Its
   secret lookup uses only the two previously authorized fixed URL forms and
   does not depend on the legacy endpoint's active flag.
4. Deploy `v12-shadow-worker` from the matching commit. Preserve its volume,
   single replica, model artifacts, and prediction-only environment.
5. Check authenticated readiness probes (read-only exchange balance, opening
   snapshot, bot pause, release config, and policy), healthy runtime, and
   prediction/delivery receipts. Leave mode shadow until operator activation.

## Validation

The initial release had 41 Node tests (signed routing and simulated receiver-to-executor
integration), six isolated PostgreSQL tests, five worker runtime tests and
seven settlement regressions. Live order creation is not part of preparation.
Build the edge bundles with `node scripts/build-v12-edge.mjs` and
`node scripts/build-v12-executor.mjs`.

The isolated SQL tests need `@electric-sql/pglite@0.3.14`; set
V12_PGLITE_MODULE to its module path when running schema.test.mjs. Never use a
production connection for those tests, which exercise activation in isolation.

## Execution and dispatch update

V1 and U now try maker first, then a capped IOC taker after a confirmed terminal maker or explicit post-only crossing rejection. T45R2 remains taker only. Fallback rechecks cash, pause, deadline, quotes and U admission; partial fills reduce the remaining quantity and budget. Rounded taker fees stay inside the budget. Unknown order or cancellation state never authorizes fallback.

Apply `docs/v12_receiver_maker_then_taker.sql` to the receiver database, then deploy the three r2 receivers, r4 predictor adapter and matching worker. The existing release mode and activation timestamp are preserved. Old maker-only wire labels are accepted solely as V1/U rollout aliases.

Early dispatch now reads committed V1/T45 decisions and sends in one backend round trip. The worker reuses per-thread HTTPS connections and keeps U's full context read out of the early polling path. Runtime records measured dispatch/receipt timings; reduction is not a promised number before production observation.
