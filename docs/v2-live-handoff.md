# V2 Final R1 live handoff

## Status
- Predictor recording: `/api/public/hooks/v2-record` (this site). Tables
  `v2_checkpoints` (immutable), `v2_candle_intents` (one per candle,
  `execution = 'OFF'` enforced by CHECK), `v2_worker_runtime`.
- Worker: `services/v2-worker`, journal/outbox at `/data/v2/journal.sqlite`.
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
