# PRODUCTION_CAPTURE_VERIFICATION

Status: **RECEIVER LIVE — COLLECTOR NOT YET CONNECTED**
Last updated (UTC): 2026-08-16 07:25Z
Activation singleton: `SHADOW_ONLY` (verified unchanged)

## 1. Route presence in the production build

- Source file present: `src/routes/api/public/hooks/binance-ob-ingest.ts`
- Registered in `src/routeTree.gen.ts` (13 references)
- Declared path: `createFileRoute("/api/public/hooks/binance-ob-ingest")`
- Production route confirmed live: `POST https://btcpredictionlol.lovable.app/api/public/hooks/binance-ob-ingest`

## 2. Ingest secret

`BINANCE_OB_INGEST_SECRET` is **NOT YET PRESENT** in the production secret scope.
Configured secrets: `B4X4_OB_CAPTURE_SECRET`, `OPENAI_API_KEY`, `LOVABLE_API_KEY` (managed).

The secure entry form was opened and dismissed. `B4X4_OB_CAPTURE_SECRET` has **not**
been reused and must not be. No secret value has been printed, logged or transmitted.

Required: generate locally with `openssl rand -hex 32` (64 hex chars), store the
identical value as `BINANCE_OB_INGEST_SECRET` in Lovable production secrets and as the
Railway collector variable of the same name.

Until it exists, `verify()` short-circuits on the missing secret and every signed
collector request returns **401 Invalid signature**. This is fail-closed and safe.

## 3. Production deployment

| Field | Value |
|---|---|
| Deployment target | `https://btcpredictionlol.lovable.app` |
| Deployed commit | `fc2c137cd278dd8ef5f004350f0b65aedea0fe6a` (+ 405 method-guard patch published immediately after) |
| Commit timestamp | 2026-08-16 07:18:26Z |
| Publish scheduled | 2026-08-16 07:21Z (initial), 2026-08-16 07:23Z (method-guard) |
| Route inclusion | CONFIRMED — POST transitioned 404 → 401 after publish |

Lovable does not expose a numeric deployment ID; the deployed commit SHA above is the
canonical deployment identity for this platform.

## 4. Pre-collector route behavior verification

| Probe | Expected | Observed | Result |
|---|---|---|---|
| Unsigned POST | 401/403 | **401** `Invalid signature` | PASS |
| Malformed signature (`deadbeef`, current ts) | 401/403 | **401** | PASS |
| Stale signed request (ts −3600s) | 401/403 | **401** | PASS |
| GET on POST-only route | 404/405 | **405** `Allow: POST` | PASS |
| PUT on POST-only route | 404/405 | **405** | PASS |

Note: GET/PUT initially returned **200** (SPA shell fallback). Fixed by adding explicit
`GET/PUT/PATCH/DELETE → 405` handlers to the route and republishing. Re-verified above.

Side-effect check after all probes:

```
observations / boundary_features / policy_shadows / collector_health = 0 / 0 / 0 / 0
```

No probe inserted an observation, feature, policy or health row. No synthetic
observation was fabricated at any point.

## 5–8. Collector connectivity and boundary capture

**NOT STARTED — blocked on step 2.** The collector must not be started until the shared
secret exists on both sides; otherwise it would burn reconnect budget against a
guaranteed 401.

Current state at 07:24:51Z:

| Item | Value |
|---|---|
| Collector startup audit event | absent |
| Production deployment identity recorded by collector | absent |
| Spot health row | absent |
| Perp health row | absent |
| Heartbeat age | n/a (no heartbeat) |
| Connection states | n/a |
| Binance runtime events in `api_runs` | 0 |
| Observations / features / policy rows | 0 / 0 / 0 |
| Warmup | 0 / 96 valid boundaries |
| Activation mode | `SHADOW_ONLY` |
| Binance webhook eligible or sent | NO |
| ES1 decisions / checksums / webhook fields | unchanged |

The three-consecutive-boundary acceptance checklist has **not** been rerun, per the
instruction to hold until receiver and collector are proven connected.

## Next actions

1. Set `BINANCE_OB_INGEST_SECRET` (64 hex chars) in Lovable production secrets and the
   identical value in the Railway service.
2. Restart the persistent Railway replica (one replica, restart-on-failure, no
   scale-to-zero).
3. Re-verify within 15s: startup audit event, two health rows, heartbeat age < 15s,
   CONNECTING/SYNCING → READY, ingest 2xx.
4. Observe the next boundary (obs accumulate before T, stop at T−2s, 2 feature rows,
   6 policy rows), then rerun the full three-boundary checklist and update this file.

If Binance Global returns a geographic restriction, preserve `REGION_BLOCKED` and stop.
