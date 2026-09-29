# V2 Final R1 — architecture inspection and minimal integration plan

Read-only findings, then the smallest build that captures live V2 predictions with order execution strictly OFF.

## Current state (verified in this turn)

- **Repo / branch:** Lovable-hosted git for project `23a724c5-6c5b-4434-85e6-dc54b111c7e2`, synced to GitHub `Smilinglion808s/btcpredictionlol` `main`. The sandbox is on an edit branch (`edit/edt-…`); HEAD is `4db1d201` ("Removed T30, T10, v6, M7 refs"). Commits are made by the platform, and direct `git push` has no GitHub auth.
- **New service folder:** `services/` already holds `binance-ob-collector`, `c85-worker`, `v12-worker` and `v12-executor`, all committed through this project. `services/v2-worker/` can be committed the same way. **Blocker:** new `supabase/functions/<name>/` folders are rejected by this editor, so V2 must not depend on a new Edge Function.
- **Backend:** Lovable Cloud, ref `alevdzyisibxcvwoyrqb`. It is the only database reachable from here and has 171 migrations. The betting project `ruxndqfjfdbtdbkheuge` (btc-trader) cannot be reached.
- **AGENTS.md:** has only the Lovable block: no force-push or history rewrites, and keep the connected branch working. Project memory adds: never delete from `predictions` (archive first), and `roadmap.md` is append-only.

## Reusable signed conventions

- Signature: `src/lib/c85/gateway.server.ts` `verifyC85Signature`. It uses HMAC-SHA256 over `${x-c85-timestamp}.${rawBody}` with `C85_GATEWAY_SECRET`, allows 60s of skew by default, and v12 uses 10s.
- Nonce and service client: `claimNonce`, `serviceClient` in `src/lib/c85/ops.server.ts`.
- Pattern to copy: `src/routes/api/public/hooks/v12-shadow.ts`. It checks a 32 KB cap, the signature, JSON, and that `open` is the current interval aligned to 900000, then runs `op` `context`/`publish` with a nonce claimed on publish.
- Worker ops RPC: `src/routes/api/public/hooks/c85-ops.ts` handles enumerated ops. Its Python client, `services/c85-worker/src/backend.py`, gives each request a new nonce and retries idempotently.
- Market/timing lookup: `GET /api/public/timing/btc-15m` (`src/lib/timing.server.ts`) returns `server_now_ms`, `next_close_ms` and `kalshi_ticker`. Kalshi helpers are in `src/lib/kalshi.server.ts`.
- Heartbeat/runtime: `src/lib/v12/runtime.server.ts` writes `v12_predictor_runtime`. The live tile reads it through `src/lib/v12/live.server.ts` + `src/lib/v12Live.functions.ts` (1s/5s polling; realtime is off).

## Outdated or stale items

- `services/v12-worker/README.md` and `service.py` point the adapter at the Edge Function (`…supabase.co/functions/v1/v12-shadow-adapter`). The site route `/api/public/hooks/v12-shadow` still exists but is the legacy hop.
- `services/c85-worker/.env.example` describes C85 as live. C85 is archived.
- Hook routes left over after the B4x4 removal: `b4x4-es1-warmup.ts`, `es1-boundary-run.ts`, `binance-ob-ingest.ts`, `binance-ob-finalize.ts`. These are not needed for V2.

## btc-trader recorder mapping

- The fixed receivers are `https://ruxndqfjfdbtdbkheuge.supabase.co/functions/v1/{v12-v1,v12-t45r2,v12-u}` (`src/lib/v12/receiver-destination.ts`, `docs/v12-webhook-handoff.md`). Each one records the signal and also runs the executor while the gate is `mode='live'`.
- **Blocker:** V2 must NOT post to any of them, because the gate is live and a post could place an order. Execution-OFF capture therefore means **no btc-trader webhook at all** in R1. A V2 recorder there would need a new function plus a table with no executor path, created in btc-trader by the user (as a prompt only). That is deferred.

## Minimal integration (execution OFF)

```text
services/v2-worker (Railway, Python)
  Binance spot BTCUSDT 15m + 1s klines -> T+8 / T+45 features (25/33 inputs)
  joblib: Direction8 > Fade8 > Direction45
  --signed HMAC--> POST /api/public/hooks/v2-record  (this site, predictor DB)
                    ops: heartbeat | publish(checkpoint T8|T45)
dashboard: V2 tile polls getV2Live (current interval only)
```

1. `services/v2-worker/`: the frozen package, the three joblib bundles under `artifacts/`, a pinned `requirements.txt`, a `Dockerfile`, and `src/service.py` with `V2_MODE=record` (refuses any other value). The worker gets no order or betting URLs and no DB keys, only `C85_GATEWAY_SECRET` (or a new `V2_GATEWAY_SECRET`) and `V2_RECORD_URL`.
2. Migration: `v2_predictions` (interval_open, checkpoint, route Direction8/Fade8/Direction45, side, probability, inputs_hash, model_hash, received_at, unique(interval_open, checkpoint)) and `v2_worker_runtime` (a single heartbeat row). Add grants, RLS, and an anon select policy for status only.
3. Route `src/routes/api/public/hooks/v2-record.ts` copies the v12-shadow checks (signature, 10s skew, current interval, nonce on publish) and upserts idempotently. It has no outbound calls.
4. Settlement: grade from Binance 15m close vs open, using the existing daily/sweeper pattern. Only when enabled; no extra cron in R1.
5. UI: `src/lib/v2Live.functions.ts` + `src/components/v2-card.tsx` on the stats page. Polling matches V1.2 but slower (5s pending, 30s settled) to keep network cost down.

## Decisions needed

- Secret: reuse `C85_GATEWAY_SECRET` or add a separate `V2_GATEWAY_SECRET` (recommended for isolation).
- Confirm R1 sends no btc-trader webhook (recording stays in the predictor DB only).
- Is the Binance `api.binance.com` spot endpoint reachable from your Railway region? It returns 451 from US regions; `data-api.binance.vision` is the fallback.
