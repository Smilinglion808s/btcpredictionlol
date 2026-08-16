# Fix Binance collector region block (Railway)

The collector is alive and heartbeating every 5s, but both markets report HTTP 451 with `region_blocked = true`, which means the service's outbound IP is still in a US region. Binance Global refuses those hosts. Nothing in this project's code needs to change — the fix is entirely on the Railway service.

## Prompt to paste into the Railway assistant

```text
My service `binance-ob-collector` (root directory `services/binance-ob-collector`,
deployed from GitHub repo Smilinglion808s/btcpredictionlol) is currently running in a
US region. Its outbound requests to Binance Global (wss://stream.binance.com and
https://api.binance.com) are being rejected with HTTP 451, which Binance returns for
US-based IPs.

Please do the following:

1. Tell me the exact region this service is currently deployed in, and confirm the
   region of its outbound/egress traffic (not just the build region).
2. Move the service to europe-west4 (Amsterdam). If my plan does not allow changing
   the region of an existing service, tell me that explicitly and instead recreate the
   service in europe-west4 from the same GitHub repo, keeping:
   - Root Directory: services/binance-ob-collector
   - Builder: Dockerfile (the Dockerfile in that directory)
   - Restart Policy: Always
   - All existing environment variables (BINANCE_OB_INGEST_SECRET,
     BINANCE_OB_INGEST_URL, NODE_ENV=production)
3. Trigger a full redeploy (not a restart) so the new region takes effect.
4. After it is up, show me the last 50 log lines and confirm you see
   "[collector] started" plus successful WebSocket connections for both SPOT and
   USD_M_PERP, with no 451 errors.
5. Confirm the final region and the service's outbound IP geolocation.
```

## After Railway reports success

Ping me and I will:
1. Re-read collector health for both markets and confirm `region_blocked = false`, `collector_status = READY`, and `sequence_ok = true`.
2. Confirm order-book observation rows are landing at ~1s cadence.
3. Run the three-consecutive-boundary production capture checklist and write the verification report.

Binance stays SHADOW_ONLY throughout — no change to ES1 decisions or webhooks.

## Fallback if europe-west4 still returns 451

Retry in `asia-southeast1` (Singapore). If both fail, the remaining option is routing the collector's Binance traffic through a non-US egress proxy, which I would spec separately.
