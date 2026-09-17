# V1.2 predictor release — September 17, 2026

The user's release scope is prediction generation and three separate webhooks.
Bet sizing, exchange execution and bankroll accounting belong to their other
system. The worker sends current predictions to recording receivers; it has
no exchange credentials or order path.

## Deployed components

- Predictor: https://btcpredictionlol.lovable.app
- Authenticated backend: `https://alevdzyisibxcvwoyrqb.supabase.co/functions/v1/v12-shadow-adapter`.
  Revision `v12-edge-adapter-r2`, source `67f18131a8118ee95c26f6d080cc3c47ec775f6e`.
- Worker: Railway `v12-shadow-worker`, service `10659051-00b7-40c8-85fb-2679e286c19d`.
  Deployment `745296b2-2af0-4ab2-91c7-04e22db32efc`, source
  `8c68400b7d64fd9c841ccb3ab959dc3f3b1e48b0`, one Amsterdam replica and persistent
  1GB `/data/v12` volume. Deployment status SUCCESS.
- Three distinct destination receivers in the separate betting backend:
  `v12-v1`, `v12-t45r2`, `v12-u`. Full URLs and signed payload contract are in
  `docs/v12-webhook-handoff.md`.
- Predictor-owned private delivery journal `v12_prediction_events` and status
  `v12_predictor_runtime`. RLS is enabled; anon/authenticated have no access.
  The dashboard returns only aggregate route counts and bounded status fields.

The earlier website connection/support-ticket dependency was removed using
this standalone backend, which reads its own database directly. It never
proxies or requests the blocked website hook. No access policies were bypassed,
no public worker domain was added, and no database key was exported to Railway.

## Signal contract

| Leg | Model identity | Destination path | Downstream policy metadata |
|---|---|---|---|
| V1 | `v12-v1-r1` | `/v12-v1` | 4%, maker-only |
| T45 R2 fallback | `v12-t45r2-r1` | `/v12-t45r2` | 5%, taker-only |
| Original U | `v12-original-u-r1` | `/v12-u` | 10%, maker-only |

One leg determines one destination. Bodies include the leg/model identity and
shared interval key; HMAC authenticates the raw body. Each attempt is journaled
before sending. Receiver acknowledgements retain their receipt ID. Ambiguous
responses are marked unconfirmed and are not automatically resent.

The installed receiving endpoints record only (`mode=shadow`,
`execution_enabled=false`). A missing day-opening bankroll does not block
prediction delivery: DAY_OPENING_UNAVAILABLE still stores and acknowledges the
signal, with no calculated betting budget. Authentication probes are deliberately
invalid and create no fabricated model signals.

## Original U and refresh

The original eligibility, ordinary daily floor, prior claim, first admission,
L-before-R priority, pricing rules and checkpoints are retained. Spot readiness
requires all six actual U inputs; it does not require the unused old T45 prior.
No gates were loosened to obtain a test signal.

The frozen Sep14 fit expires Oct5 2026 00:00 UTC. The refresh loop preserves the
21-day schedule, preceding 84-day window and one-day embargo. It can prepare
Oct5's fit after Oct4 00:10 UTC. New fits become active only at their scheduled
boundary. Missing recent history, invalid artifacts or failed fits never extend
an expired model; V1/T45 continue on their existing schedules.

The original historical seed is partitioned into four monthly Parquet files,
each below the repository's 10MB per-file limit. All 57,729 rows and values are
identical to the verified seed. No asset-host fetch is required in Railway.
Live training inputs are captured for all input-ready intervals, independent
of U eligibility. Quotes must precede the checkpoint and bars must have arrived
within its scoring window. Official outcomes are collected separately and must
be known before the training cutoff. JSON preserves binary64 numeric values
without rounding across tree thresholds. Training runs outside dispatch.

## Verification

- Locked native typecheck and application build pass.
- Eight adapter tests: signatures, independent routes, duplicate suppression,
  ambiguous acknowledgements, heartbeat authentication and invalid signals.
- Nineteen canonical context parity/negative cases pass.
- Five worker runtime tests and six refit/persistence tests pass locally.
- Original selection parity: 792 historical and 135 later U admissions.
- Input parity: 10,848 minute rows across 38 fields and 96 early-feature targets.
- Current frozen probability parity: 864 L rows and 1,728 R rows, tolerance 1e-12.
- Rebuilding Sep14 from the refresh code reproduced the current predictions
  within 1e-12 using the exact original 23,492 L and 47,039 R training rows
  (7,849 markets each). This checks implementation, not a new profit result.
- Unauthorized requests to the deployed r2 backend return INVALID_SIGNATURE.

## Runtime verification

At 21:35:36 UTC the authenticated predictor status row reported RECORDING,
last_error=null, all three receiver_auth values true, current index/spot/perp
minutes through 21:35, a fresh quote, three captured training rows, and
refresh_status=SCHEDULED_20261005. The current interval's U block reason was
DAILY_FLOOR_CLOSED. The original daily floor was preserved.

As of 21:36 UTC, no naturally selected V1.2 signal had reached the new journal
or receivers. Route contract tests and deployed authentication probes pass;
this is not yet observed natural delivery for each of the three legs. No
synthetic trade or model call was inserted to fill that gap.

Website publication was requested as deployment
653b26a2-9bf1-40db-a27b-36f3f387c4a8. The existing tile now has V1.2 webhook
receipt counts and live worker/refresh status, with V1.1 history labelled
separately and betting explicitly owned by the external system.

## External betting ownership

The original `place-trade` version 155, `settle-bets` version 67, c85 worker
`4422395b-5ed1-4e1c-93e8-9f5c0c88921e` and collector
`9d077777-ad8f-43a1-9b45-be849cba9f47` were not changed by this release.
The prepared executor source remains disconnected. This release does not
activate the 4% / 5% / 10% trading configuration; those fields are the agreed
handoff policy for the user's separate system. Quoted/backtest odds and model
outcomes are not reports of financial fills or realized trading returns.
