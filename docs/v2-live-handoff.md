# V2 Final R1 live handoff

## Status
- Predictor recording: `/api/public/hooks/v2-record` (this site). Tables
  `v2_checkpoints` (immutable), `v2_candle_intents` (one per candle,
  `execution = 'OFF'` enforced by CHECK), `v2_worker_runtime`.
- Worker: `services/v2-worker`, journal/outbox at `/data/v2/v2.sqlite`, 15m
  history carried at `/data/v2/bars15.csv.gz`. Frozen model package in
  `services/v2-worker/package` (hash-verified, 16 files); continuous 80,160-bar
  indicator seed in `services/v2-worker/seed` (decoded SHA-256 verified).
- Railway: service `v2-predictor-worker`, root `services/v2-worker`, start
  `python src/service.py`, volume `/data/v2`, `V2_MODE=shadow`.
- Bundles valid 2026-09-14 → 2026-10-12 UTC. After expiry the worker fails
  closed with `refit_required=true`; auto-refit is unavailable (no causal
  index-direction label pipeline), promotion is manual via `src/promote.py`.
- Execution: OFF. V2 never calls `v12-v1`, `v12-t45r2`, `v12-u`, `place-trade`
  or any executor.

## Sizing metadata (informational only, no orders)
4% of entry-day opening principal, America/Boise midnight reset, same dollar
stake all day, floor to cents, $200 cap. No P2, no U, no doubling. The $50
backtest bankroll is not a live balance.

## Sources
Inputs: Binance spot BTCUSDT 15m + 1s. Lab labels: Binance index direction
proxy. Official Kalshi result: separate, never merged with lab grading.

## Pending: btc-trader record-only receiver (ruxndqfjfdbtdbkheuge)
Awaiting the user's strict V2 wire contract for the new `v2-record` function.
When it arrives: add a second outbox target, forwarded only after local durable
recording, signed with server-side `BTC15M_WEBHOOK_SECRET`. Until then the
worker delivers to the predictor site only.

## Review fixes (atomic recording)
- `/api/public/hooks/v2-record` stores checkpoint + single candle intent in one transaction via
  `public.v2_record_checkpoint(jsonb)` (service_role only). Retries re-verify the stored immutable
  row (`CONFLICTING_DUPLICATE` on any difference) and idempotently finish a missing intent; the
  response carries the actually persisted intent.
- Eligible calls only inside [T+8,T+9) / [T+45,T+46); T45 intents require a persisted T8 abstention.
- Heartbeat status is allowlisted (no principal, cash, secrets or raw exceptions); body read is byte-bounded.
- Local check: `NODE_PATH=<pglite> node scripts/check-v2-record-rpc.mjs` (never against production).
- External btc-trader forwarding remains disconnected (approval blocked).
