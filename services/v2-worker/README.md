# v2-predictor-worker — V2 Final R1 (recording only)

Independent shadow worker for the frozen V2 Final R1 model
(`v2-final-r1`; sleeves `v2-direction8-r1`, `v2-fade8-r1`, `v2-direction45-r1`).

**Execution is unconditionally OFF.** This service holds no exchange or betting
credentials, imports no executor, and contains no code path that submits,
cancels or retries an order. It never contacts a V1.2 receiver. Its only
outbound calls are Binance public market data (read-only) and the signed
recording endpoint `/api/public/hooks/v2-record` on the predictor site.

## Layout

| Path | Contents |
| --- | --- |
| `package/` | Frozen model package, byte-identical to the delivered ZIP. Verified at startup against `package/CONTENT_HASHES.json` (16 files). Never edit. |
| `package/models/current/` | `direction8`, `fade8`, `direction45` joblib bundles + manifest. Valid **2026-09-14 → 2026-10-12 UTC**. |
| `seed/spot15_seed.csv.gz` | 80,160 continuous Binance spot BTCUSDT 15m bars, 2024-06-01 → 2026-09-13 23:45 UTC. Prices/volume/quote_volume/trade_count/complete from `spot15`, `taker_buy_volume` joined from `activity15` on `bar_open`. Decoded SHA-256 recorded in `seed/SEED_SHA256.json` and verified on every load. |
| `src/service.py` | Engine: readiness, checkpoints, journaling, health. |
| `src/marketdata.py` | 15m history (seed + REST backfill) and the 1s websocket feed. |
| `src/journal.py` | Durable SQLite checkpoint journal + at-least-once outbox. |
| `src/promote.py` | `inspect` / `promote` for model bundles (atomic manifest swap). |
| `tests/test_worker.py` | Offline tests; no network, no orders. |

## Timing

- Pre-open frame is computed off the hot path right after each 15m boundary,
  from the full continuous history (never truncated, never OKX). The previous
  closed bar finalizes at T0; `preopen_asof` is exactly `T-1ms`; the target's
  own bar is never an input. Normalizers (`vol`, `meanvol`, `meancount`) are
  refreshed in the same pass.
- **T+8** uses exactly seconds 0–7 (internally 0–6 for Direction8, second 7 for
  the Fade8 price gate). **T+45** uses exactly seconds 0–43.
- Evaluation must land inside `[8,9)` / `[45,46)`. Outside the window, or with
  any missing second, the worker fails closed and records the reason. Missing
  seconds are never filled.
- The sender runs on its own thread; delivery never delays scoring.

## Fail-closed reasons

`MODEL_EXPIRED`, `PACKAGE_INVALID`, `CLOCK_SKEW` (>1.5s vs Binance server time),
`PREOPEN_NOT_READY`, `PREOPEN_STALE`, `FEED_NOT_READY`, `MISSING_SECONDS`,
`CHECKPOINT_WINDOW_MISSED`, `CHECKPOINT_LATE`, `SCORE_FAILED`,
`DUPLICATE_INTENT`. Every attempt — call, abstention or error — is journaled
locally and posted to the dashboard with `receipt_latency_ms` and `inputs_hash`.

## Health

`GET /healthz` is the Railway health check path (`GET /health` and `GET /`
answer identically). It always returns 200 while the process is alive: `alive`
is process liveness only, and `prediction_ready` is reported separately — it is
true only when the package, model validity, clock skew, a complete history, a
pre-open frame **for the current candle** (`preopen_current`) and a live/fresh
feed covering that candle (`feed_ready`) all hold. Also reported:
`feed_connected`, `feed_age_ms`, `clock_skew_ms`, `history_bars`,
`preopen_target`, `model_valid_until`, `refit_required` and `outbox_pending`.
`GET /checkpoints` returns the last 20 journaled attempts. Receiver rejections
are logged as an allow-listed error code only; raw HTTP response bodies are
never logged or exposed.

## Refit

Auto-refit is **not** available: refitting needs causal index-direction labels
settled at least a minute before the fit cutoff, and no label pipeline exists in
this repository. After **2026-10-12T00:00:00Z** the bundles expire, the worker
fails closed and `refit_required` turns true. A human runs `package/refit.py`
in the lab, then `python src/promote.py promote --candidate <dir> --activate`
here (hash-verified, atomic swap, previous bundle kept) and updates
`package/CONTENT_HASHES.json`.

## Railway

Service name `v2-predictor-worker`, root directory `services/v2-worker`,
start command `python src/service.py`, health check path `/healthz`,
persistent volume mounted at `/data/v2`.

```
V2_DATA_DIR=/data/v2
V2_MODE=shadow
V2_RECORD_URL=https://btcpredictionlol.lovable.app/api/public/hooks/v2-record
C85_GATEWAY_SECRET=<copied securely from the existing worker>
```

Optional: `V2_WORKER_ID` (default `v2-predictor-worker`), `V2_BINANCE_REST`
(default `https://data-api.binance.vision`), `V2_BINANCE_WS`
(default `wss://data-stream.binance.vision/ws/btcusdt@kline_1s`), `PORT`.
`V2_MODE` accepts only `shadow` or `record`; anything else exits at start.

Python 3.12; dependencies pinned in `requirements.txt` (matching the package pins).

## Tests

```
python -m unittest discover -s tests
```
