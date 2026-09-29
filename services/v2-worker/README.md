# V2 Final R1 recording worker

Separate from `services/v12-worker`. IDs: `v2-final-r1`; sleeves
`v2-direction8-r1`, `v2-fade8-r1`, `v2-direction45-r1` (priority in that order).

**Execution is unconditionally OFF.** No setting routes V2 to orders; `V2_MODE`
other than `record` refuses startup; the database rejects any intent whose
execution is not `OFF`.

Railway: root `services/v2-worker`, Dockerfile, one replica, volume at `/data/v2`
(SQLite journal + outbox), health `/healthz`.

Env: `V2_RECORD_URL=https://project--23a724c5-6c5b-4434-85e6-dc54b111c7e2.lovable.app/api/public/hooks/v2-record`,
`C85_GATEWAY_SECRET` (reference existing Railway secret), optional `V2_WORKER_ID`,
`V2_BINANCE_REST` (default `https://data-api.binance.vision`, US-safe).

Signing: HMAC-SHA256 over `<ms timestamp>.<raw body>` in `x-c85-signature`,
timestamp in `x-c85-timestamp` (10 s skew), single-use nonce per request.

Settlement: lab labels are Binance INDEX direction proxies. Spot candle
grading is not lab-equivalent; official Kalshi results are a separate source.
