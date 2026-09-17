# V1.2 deployment checkpoint — 2026-09-17

Status: the application and recording infrastructure are deployed. V1.2 is
**not delivering signals end to end and is not executing financial orders**.
The existing V1.1 execution service remains at its prior deployment.

## Locked configuration

| Route | Shared Boise day-opening principal | Prepared execution | Shadow receiver |
|---|---:|---|---|
| V1 | 4% | Maker only | `v12-v1` |
| T45 R2 fallback | 5% | Taker only; fees inside budget | `v12-t45r2` |
| Original U | 10% | Maker only | `v12-u` |

All routes use `v12-original-u-4-5-10-r1` and separate model identities.
Original U retains the recovered eligibility, checkpoint, L-before-R and
conservative admission rules. It does not rescue a V1/T45 price rejection.

## Deployed

- Published application: https://btcpredictionlol.lovable.app
  (deployment `a42e9954-74c3-45db-99a2-c1a455a044ca`). The existing tile is
  labelled Version 1.2 and explicitly says preparing / V1.1 execution.
- Railway service `v12-shadow-worker`, ID
  `10659051-00b7-40c8-85fb-2679e286c19d`, deployment
  `da79706d-2bd9-4739-9816-44acec90e04a`, source
  `c51d99e74ecd1acf90e6ac176e27c895185768bb`. Status SUCCESS; one Amsterdam
  replica and a persistent 1 GB volume at `/data/v12`.
- Index, spot and perpetual minute capture are current in runtime heartbeats.
  The worker refuses any mode other than shadow and has no exchange order API.
- Three authenticated Supabase recording receivers and additive, restricted
  shadow tables exist in project `ruxndqfjfdbtdbkheuge`.
- Prepared executor source is in `services/v12-executor`, disconnected from
  routes and runtimes. It retains `entry-controls-r1` for settlement protocol
  compatibility and carries the V1.2 strategy version separately.

## Observed connection blocker

The worker receives HTTP 403 / Cloudflare error 1010 when calling
`POST https://btcpredictionlol.lovable.app/api/public/hooks/v12-shadow`.
The rejection happens before application authentication. An unsigned request
from the Lovable environment reaches the route and receives application 401.
This verifies route existence, not authenticated end-to-end delivery.

The managed `lovable.app` access policy has no exposed owner setting in the
available project controls. Platform assistance is needed to authorize this
machine integration. No client impersonation or access-control bypass was
attempted. Adapter denial retries now wait 30 seconds. Market capture continues.

At this checkpoint `v12_shadow_signals` has **0 rows** and
`v12_day_openings` has **0 rows**. Process health is not delivery readiness.

Support-request details, prepared only and **not sent**:

> Please authorize our authenticated Railway machine integration to the hook
> path above on project 23a724c5-6c5b-4434-85e6-dc54b111c7e2. Requests from
> v12-shadow-worker in Amsterdam received HTTP 403 / edge error 1010 on
> 2026-09-17 around 20:05–20:25 UTC, before application code. The published
> route is present and returns application 401 for an unsigned request from
> the Lovable environment. Please identify the supported machine-access
> configuration while preserving the endpoint's HMAC authentication. No
> credentials or signing secrets are included in this request.

## Verification completed

- 15 Node tests pass: signatures, route identity, timing, eligibility, Boise
  DST, integer-cent budgets, fees, maker-only behavior, partial fills,
  cancellation ambiguity, claim loss and T45 IOC behavior.
- Four Python runtime tests pass. Original U parity covers 792 historical and
  135 later admissions, frozen L/R probabilities, 10,848 minute-state rows
  across 38 fields, and 96 early-feature targets.
- Application build passed; full typecheck passed in Lovable's locked
  dependency environment. Local unlocked dependencies reproduce an unrelated
  pre-existing `__root.tsx` type error, also present in the baseline.

These are code and historical parity checks. No end-to-end delivery, real
maker-fill quality or capacity result is claimed.

## Remaining implementation and validation

1. Resolve the platform access block and observe valid V1, T45 and eligible U
   deliveries at their separate receivers. Do not fabricate historical
   checkpoint books or force U eligibility to obtain a test signal.
2. Implement an authoritative shared America/Boise midnight cost-basis equity
   writer, including reconciliation around unsettled positions. The old
   00:03 / fixed-UTC-offset snapshot must not be relabelled exact midnight.
   Missing snapshots deliberately produce no budget.
3. Finish the prepared execution receiver's integration with one durable
   interval claim shared across all three legs, fresh U eligibility, order
   recovery and settlement. The tested engine module alone is not a receiver.
4. Install and verify original U's frozen-policy 21-day fit refresh. Current
   Sep14 artifacts expire **2026-10-05 00:00 UTC** and fail closed afterward.
5. Validate the complete recording chain and prepared integration before any
   separate, user-performed financial activation. This release is not a
   one-switch trading cutover.

The original `place-trade` version 155, `settle-bets` version 67, c85 worker
deployment `4422395b-5ed1-4e1c-93e8-9f5c0c88921e`, and collector deployment
`9d077777-ad8f-43a1-9b45-be849cba9f47` were unchanged by this rollout.
