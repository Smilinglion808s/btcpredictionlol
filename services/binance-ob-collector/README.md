# B4x4-ES1 Binance Order-Book Collector (R1)

Always-on external service. The main app runs on Cloudflare Workers, which
cannot hold a persistent WebSocket, so local order-book reconstruction lives
here and pushes derived observations to the app over a signed HTTP endpoint.

**Shadow only.** Nothing this service produces can change an ES1 decision,
direction, confidence, or webhook.

## What it does

- Connects to Binance **Global** BTCUSDT depth streams (Spot `@depth@100ms` and
  USD-M Perpetual `@depth@100ms`). Binance.US is never an acceptable
  substitute; an unreachable Global endpoint is recorded as `REGION_BLOCKED`.
- Reconstructs a local book per market using Binance's exact continuity rules,
  resyncing from a REST snapshot on any sequence gap.
- Samples one derived observation per integer second at offsets **T-60s through
  T-2s** before each 15-minute UTC boundary (59 rows per market).
- Sends signed batches plus a 5-second heartbeat to
  `POST /api/public/hooks/binance-ob-ingest`.

## Environment

| Variable | Required | Meaning |
| --- | --- | --- |
| `BINANCE_OB_INGEST_URL` | yes | `https://<app-host>/api/public/hooks/binance-ob-ingest` |
| `BINANCE_OB_INGEST_SECRET` | yes | Shared HMAC secret; must match the app secret of the same name |
| `BINANCE_OB_CONFIG_HASH` | no | Frozen config hash for audit parity |
| `BINANCE_OB_FEATURE_SCHEMA_HASH` | no | Frozen feature schema hash |
| `BINANCE_OB_BUILD_ID` | no | Deploy identifier recorded on every row |

## Run

```bash
npm install
BINANCE_OB_INGEST_URL=... BINANCE_OB_INGEST_SECRET=... npm start
```

Docker:

```bash
docker build -t binance-ob-collector .
docker run -d --restart=always \
  -e BINANCE_OB_INGEST_URL=... \
  -e BINANCE_OB_INGEST_SECRET=... \
  binance-ob-collector
```

Any always-on host works (Fly.io, Railway, Render, a small VPS). It must sit in
a region where Binance Global is reachable and should have low latency to
`stream.binance.com`.

## Request signing

Each request sends `x-binance-ob-timestamp` (epoch ms) and
`x-binance-ob-signature` = `HMAC_SHA256(secret, "<timestamp>.<raw body>")` in
hex. The app rejects signatures older than five minutes.

## Health

The app exposes collector liveness through the Binance OB health view: a
heartbeat older than 15 seconds marks the market as not alive, and boundaries
captured while unhealthy are stored with an explicit non-`FRESH` capture
status rather than being silently dropped.
