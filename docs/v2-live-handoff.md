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

## P0 worker review — findings A–G (applied, source only)

| # | Finding | Fix |
| --- | --- | --- |
| A | Scheduler fired once at exactly `sec.000`, before the last closed 1s bar had arrived | `run_window()` polls locally inside `[T+8,T+9)` / `[T+45,T+46)`, scores **once** the instant every required closed bar and a current pre-open frame are present, and only records the real blocking reason (or `CHECKPOINT_LATE`) at the deadline. No REST/network work in the scoring loop. |
| B | Worker wrote a fake frozen `decisions` row on a T+8 error, letting T+45 run | Removed. Errors go to the worker's own audit journal only. A candle with no frozen T+8 record fails closed at T+45 with `T8_UNRESOLVED`; only a genuine frozen T+8 ABSTAIN permits T+45. Frozen package bytes untouched (16-hash check still passes). |
| C | Receipt time was `max(last_message_ms, last_close_ms)` — clamped and polluted by unrelated traffic | Each closed bar stores its own real `received_at_ms` at `put()`. `tape()` returns the max over the **required** bars only, unclamped. A receipt after the decision time, in the future, or earlier than the bar's close fails closed with `INVALID_RECEIPT_TIME`. |
| D | An intent committed to the frozen store but not yet journaled was lost on restart | `reconcile_store()` runs at startup and before every score: it rebuilds the journal record from the immutable frozen payload (original decision time, sleeve, side, confidence, `event_id`) and acks the frozen row **only after** the journal + outbox write is durable. Exactly-once, and T+45 stays blocked afterwards. |
| E | Decision time could be re-read at serialization | `decision_at` is always the model's own `decision_time`, normalized only in format. Runtime measurements live in separate fields: `receipt_latency_ms`, `scoring_latency_ms`. |
| F | A failed startup warmup left `history_ready` false forever; stored CSV trusted on row count alone | `refresh_boundary()` retries the full warmup; readiness returns only after a complete verified history **and** a current pre-open frame. The persisted CSV is read with `float_precision="round_trip"` and accepted only if its leading rows still equal the verified seed byte-for-byte. |
| G | `/healthz` undocumented; readiness keyed off historical backfill; risk of raw response bodies in logs | `/healthz` documented as the Railway health-check path (`/health`, `/` identical). `prediction_ready` now requires `preopen_current` **and** `feed_ready` (current target covered + socket live/fresh). Receiver rejections log an allow-listed error code only. |

Regression tests: `python -m unittest discover -s tests` — **41 passed, 0 skipped**
(new: late final second scores inside the window; missing until the deadline
fails closed; T+45 blocked after a failed T+8; T+45 after a genuine frozen
abstention; unrelated later bar does not move the required receipt time;
receipt after decision fails closed; crash between store commit and journal
write recovers exactly once; tampered stored history falls back to the seed;
round-trip history accepted; readiness recovers after a failed warmup;
readiness requires current target + feed).
App-side: V2 contract 11/11, vitest 490/490, tsc clean, build clean.

Still recording-only: no btc-trader forwarding, no V1.2 receiver contact, no
orders. Nothing deployed — deploy from Railway when you are ready.
