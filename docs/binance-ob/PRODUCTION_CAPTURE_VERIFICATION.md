# PRODUCTION_CAPTURE_VERIFICATION

Status: **BLOCKED — NO PRODUCTION CAPTURE OBSERVED**
Verification run (UTC): 2026-08-16 07:16Z
Activation singleton: `SHADOW_ONLY` (unchanged, verified)

## Executive summary

The post-deployment verification cannot be completed. The collector has produced
**zero** rows in every Binance table, and the production ingest endpoint does not
exist on the currently published deployment. Two hard blockers are documented
below. No ES1 behavior was touched; Binance remains shadow-only.

## Blockers

### B1 — Production ingest route returns 404 (published build is stale)

```
POST https://btcpredictionlol.lovable.app/api/public/hooks/binance-ob-ingest
-> 404 (HTML app shell)
```

The route source exists in the repository (`src/routes/api/public/hooks/binance-ob-ingest.ts`)
but has never been published. Any collector pointed at
`BINANCE_OB_INGEST_URL=https://btcpredictionlol.lovable.app/api/public/hooks/binance-ob-ingest`
receives a 404 for every batch and drops the data.

Remedy: publish the app, then re-verify the endpoint returns 401 (unauthorized)
rather than 404 for an unsigned POST.

### B2 — `BINANCE_OB_INGEST_SECRET` is not configured in production secrets

Configured project secrets at verification time:

```
B4X4_OB_CAPTURE_SECRET
LOVABLE_API_KEY (managed)
OPENAI_API_KEY
```

`BINANCE_OB_INGEST_SECRET` is absent. Per the deployment instruction this must be a
**new dedicated 32-byte secret**, not the existing `B4X4_OB_CAPTURE_SECRET`. Until it
is present, every signed batch fails signature verification.

## Requested checks — results

| # | Check | Result |
|---|---|---|
| 1 | Collector deployment ID / commit / start time | **UNVERIFIABLE** — no collector heartbeat or runtime event ever reached the backend |
| 2 | Spot + USD-M Perp synchronized READY | **FAIL** — 0 health rows |
| 3 | Heartbeat age < 15s | **FAIL** — no heartbeat exists |
| 4 | Exactly one current health row per market | **FAIL** — 0 of 2 markets present |
| 5 | Three consecutive 15-minute boundaries observed | **FAIL** — 0 boundaries captured |
| 6 | ACCEPTANCE_CHECKLIST.md queries | Run; all capture queries return empty sets (raw counts below) |
| 7 | Per-boundary contract (59 obs/market, T−60s..T−2s window, cutoff, 2 feature rows, 6 policy rows, no webhook) | **NOT EVALUABLE** — no boundaries. Negative half confirmed: no Binance webhook eligible or sent; ES1 decisions, state checksums and webhook fields unchanged |
| 8 | Capture age p50/p95/max, gaps, resyncs, reconnects, failures | **NO DATA** |
| 9 | Warmup n/96 | **0 / 96** valid prior boundaries |
| 10 | Activation left SHADOW_ONLY | **PASS** |

## Raw row counts

```sql
select count(*) from b4x4_es1_binance_ob_collector_health;    -- 0
select count(*) from b4x4_es1_binance_ob_observations;        -- 0
select count(*) from b4x4_es1_binance_ob_boundary_features;   -- 0
select count(*) from b4x4_es1_binance_ob_policy_shadows;      -- 0
```

Activation singleton:

```
singleton_key        | mode        | selected_policy | activated_by | approval_note
B4X4_ES1_BINANCE_OB  | SHADOW_ONLY | (null)          | (null)       | Initial R1 installation; no publication or decision authority.
```

Runtime audit (`api_runs`) — no Binance/collector/ingest events have ever been recorded:

```sql
select run_type, count(*), max(created_at)
from api_runs
where run_type ilike any (array['%binance%','%collector%','%ingest%'])
group by 1;
-- (0 rows)
```

Backend traffic in the last 6 hours is unrelated ES1/legacy scheduling only:

```
model7-variant-b-retrain   24   2026-08-16 07:16:16Z
resolve-predictions        24   2026-08-16 07:16:10Z
fetch-okx-candles          90   2026-08-16 07:16:02Z
run-ai-prediction          24   2026-08-16 07:15:05Z
model7-nightly-audit        1   2026-08-16 05:15:07Z
```

## ES1 integrity (explicitly confirmed)

- No code paths were modified during verification (read-only queries and one
  unauthenticated HTTP probe against a public route).
- Binance mode remains `SHADOW_ONLY`; Binance has zero decision authority.
- No Binance webhook was eligible or sent.
- ES1 decisions, state checksums and webhook fields are unchanged.

## Deviations

1. Collector never reached the backend (no heartbeat, no batch, no runtime event).
2. Production ingest route is unpublished (404).
3. Dedicated ingest secret missing from production secrets.
4. Consequently: 0/96 warmup boundaries; policy promotion remains far out.

## Required actions before re-verification

1. Generate a new dedicated 32-byte secret and store it as `BINANCE_OB_INGEST_SECRET`
   in production secrets; set the identical value on the Railway service.
2. Publish the app so the ingest route exists in production.
3. Confirm the Railway service is running one persistent replica with
   restart-on-failure, and that its logs show WebSocket connect for both
   `BTCUSDT` spot and USD-M perp.
4. Re-run this verification. Expected first signal within ~60s (heartbeat), first
   complete boundary within ~15 minutes.

If Binance Global returns a geographic restriction, preserve `REGION_BLOCKED`
and stop — do not change regions to circumvent it.
