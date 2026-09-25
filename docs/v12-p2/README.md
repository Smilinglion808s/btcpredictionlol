# P2 implementation and operator handoff

Status: reviewed source preparation. No live SQL, Edge Function deployment,
cron creation, or betting activation is performed by adding these files.
P2 starts **off** when the operator installs the preparation SQL.

## Exact rule

At admission of a new V1.2 model call, use the latest five accepted V1.2 calls
whose official market outcomes have already been observed. Across V1, T45R2,
and U, at most three of those five must have won. The admission time must be
between 12:00 inclusive and 18:00 exclusive in `America/Boise`.

When P2 is enabled and qualifies, multiply the normal daily stake rate by two:

| Leg | Normal | P2 qualifying entry |
|:--|--:|--:|
| V1 | 4% | 8% |
| T45R2 | 5% | 10% |
| Original U | 10% | 20% |

Every qualifying entry gets this rate; there is no accumulating doubling.
Use the existing account's daily opening balance. **The $400 backtest starting
balance is not a production setting.** Round the opening balance to cents,
then multiply the rate and floor the resulting cents. No new dollar caps are
introduced. Existing execution controls, fee reservations, price limits,
available-cash checks, duplicate claims, and any operator-configured execution
ceiling still apply. The model predictions and webhook fractions remain 4/5/10;
the receiver-owned sizing RPC applies the overlay once.

## Why the outcome journal is necessary

The current `bet_history` has no reliable settlement-known timestamp. Sorting
by `placed_at` would implement a different rule. The new `v12_p2_calls` journal
captures accepted model calls, including calls whose orders never fill. An
independent observer reads official Kalshi market results and records the
database observation time. It cannot place or cancel orders. Repeated outcomes
do not move their original timestamps; conflicting outcomes are rejected.

There is no historical timestamp backfill. Until five newly captured calls
have known outcomes, sizing stays at baseline. Late official settlement or
observer delay can change the live trigger relative to the archive. Neither
the original research nor the replay establishes a new live win-rate advantage.

## Files and integration

- `prepare.sql` is the complete one-time database preparation. It creates
  service-role-only outcome/config tables, capture and observation functions,
  and the P2 evaluator, then updates the existing atomic `record_v12_signal`
  sizing RPC. A checksum guard refuses to overwrite a recorder that changed
  since review. The existing live/shadow release mode is preserved.
- `schema.sql` and `record_v12_signal_p2.sql` are review components already
  included in `prepare.sql`; do not apply them again separately.
- `recorder.diff` shows the narrow change to the existing receiver function.
- `observer.js` is a standalone generated Edge Function entrypoint; no imports
  or additional dependencies are required. Source is `observer-index.ts` and
  `services/v12-executor/p2-outcomes.ts`.
- `services/v12-executor/p2-sizing.ts` is a pure calculator/reference tested
  against the same archive as the SQL implementation. It is not wired into a
  second sizing path.
- `activate.sql`, `disable.sql`, and `inspect.sql` are operator-run scripts.

The existing receiver passes the server-calculated `budget_cents` to its
executor, so no Railway/model rollout or sender percentage change is needed.
P2's five contributing signal IDs, count of wins, base/effective percentages,
and candidate/applied budgets are stored in `v12_shadow_signals.p2_sizing` and
returned in each new receipt. The executor's older `sizing.fraction` trace
field still describes the base model fraction; use `p2_sizing.effective_percent`
for the boosted fraction. Actual order budgets retain their existing logs.

## Operator installation and activation

Receiver Supabase project: `ruxndqfjfdbtdbkheuge` (`btc-trader`).

1. Review and run `prepare.sql` in that project's SQL editor. It leaves P2 off.
   If the checksum guard fails, compare the newer recorder and rebase this
   change; do not remove the guard. Do not execute SQL against the predictor
   project's separate database.
2. Create a separate Edge Function named `v12-p2-observer`, paste the complete
   `observer.js`, and deploy it yourself. Keep JWT verification enabled. The
   handler additionally accepts only the server service-role bearer token.
   Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the
   function. Never put either privileged key in the frontend.
3. In Supabase Vault, save the receiver project's service-role JWT under
   `p2_observer_service_role`. Run `schedule-observer.sql` to observe once per
   minute. This is an outcome-only job and leaves betting activation unchanged.
   A successful scheduler POST alone is not proof of successful observation:
   inspect the observer's HTTP response/function logs and `known_at` growth.
4. Use `inspect.sql` to verify at least five known outcomes and inspect the
   recorded candidate sizing. Optional `mode='shadow'` also keeps actual
   budgets at baseline. Outside the Boise afternoon window, a 1x candidate
   is expected.
5. If you choose to enable the new real-money sizing, personally run
   `activate.sql`. Use `disable.sql` to stop boosting new receipts. Already
   admitted orders keep their frozen budgets; do not replay old signals.

## Verification

The Node tests cover time boundaries, summer/winter/DST, all three stake rates,
cent rounding, no accumulating doubling, duplicate calls, unavailable/future
outcomes, settlement ordering, activation time, authorization, and an observer
transport restricted to market reads and outcome records.

```sh
node --test services/v12-executor/p2-sizing.node-check.ts services/v12-executor/p2-outcomes.node-check.ts
node scripts/build-v12-p2-observer.mjs
```

Requires Node 22.13+ for built-in TypeScript stripping. Verification used Node
24.19.0. The test filenames deliberately avoid the app's Vitest discovery
pattern; run the explicit command above.

Both the TypeScript calculator and local PostgreSQL implementation match
**all 5,088 archived decisions, with 723 qualifying boosts and zero mismatches**.
Local PostgreSQL also verifies unchanged baseline budgets while off, receiver
claim deduplication, service-role permissions/RLS, observation idempotency,
conflict rejection, and the stale-source guard. See `postgres-verification.json`.
The PostgreSQL test uses PGlite 0.5.8; no production database mutations were
needed for these tests. Original archived signals are represented by a compact
outcome/time fixture, not live account data or credentials.

Supabase reference for the optional schedule:
https://supabase.com/docs/guides/functions/schedule-functions
