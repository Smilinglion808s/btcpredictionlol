
Priority order matches your #1 → #6. #1 and #4 are bugs and ship first.

## What I found in the DB just now

Pulled `api_runs` + `predictions` for the last 36h.

- **Freeze root cause today = OKX HTTP 429.** Every `fetch-okx-candles` run today errors with `OKX HTTP 429: {"msg":"Too Many Requests","code":"50011"}`. The freshness guard we added last turn is working — it forces NO CLEAR EDGE and marks `freshness_action = forced_no_clear_edge_refetch_failed: OKX HTTP 429...`. So the model isn't running on stale data anymore, but it's also barely running at all because the single ingest source is being throttled. Fix = give Path A a fallback so a 429 on OKX doesn't blind the pipeline.
- **Resolution writer is actually correct in current code.** Latest resolved rows in `predictions` show populated `actual_next_candle_open/high/low/close` and `actual_direction` values of both GREEN **and** RED (18:45 → RED, 17:30 → RED, etc.). The "blank actual_open / 0-1 in actual_close / no RED" pattern you're seeing in CSV is either from an older export or from a second `model_version` whose insert path isn't setting the audit fields (I see two 19:15 rows: one NO CLEAR EDGE with `input_candle_ts` populated, one NO with it null — likely two model versions running in the same cron tick). Ship a verification pass + normalize the second write path.

## Changes

### 1. Fetch redundancy + hard freeze detection *(bugfix)*

`src/lib/okx.server.ts` + `src/lib/prediction.server.ts`

- Add `fetchAndUpsertCandles(supabase)` that tries OKX first, then Coinbase (`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=900`) normalized to the same `candles` row shape, and writes a `fetch_source` column (`okx` | `coinbase`) on each candle row.
- On 429 specifically, honor `Retry-After` and skip OKX for that run rather than retrying 3× in-loop (wastes the tick).
- Log both attempts to `api_runs` with `response_payload.attempts = [{source, status, rows_upserted}]`.
- In `runAiPredictionServer`, after the freshness age check, also assert **`max(candle_ts) advanced since the previous prediction's `input_candle_ts` for this model_version`**. If it did not advance, force NO CLEAR EDGE with `freshness_action = "no_advance_since_last_prediction"`. This catches the "fetch returned 200 with 0 new rows" case that pure age can't see.
- Backfill any missing 15m boundaries between the last DB row and now before predicting — walk the returned array, upsert every gap, and log `backfilled_count`.

### 2. Feed the in-progress candle explicitly *(biggest signal upgrade)*

`src/lib/okx.server.ts` + `src/lib/prediction.server.ts`

- Add `fetchCurrentPartialCandle()`: hit OKX (`bar=15m&limit=1`) or Coinbase 1m aggregated to the current 15m boundary, return `{ open, high, low, close, volume, minutes_elapsed, confirm: false }` for the **currently open** candle.
- In the prompt payload, add a top-level `current_candle_partial` field (not appended to the `candles` array, so no model confusion about which candle is closed):
  ```json
  "current_candle_partial": {
    "start_ts": "...", "minutes_elapsed": 14, "o":..., "h":..., "l":..., "c":...,
    "distance_to_vwap_pct": ..., "distance_to_ema9_pct": ...,
    "reclaiming_level": "...", "losing_level": "..."
  }
  ```
- Update `DEFAULT_INSTRUCTIONS` to describe how to weight it: real-time snapshot of the candle *before* the target, use for momentum/level-reclaim reads, not lookahead.
- Persist the same object in `predictions.full_ai_response.current_candle_partial` so it's auditable in CSV.

### 3. Betting-feed alignment *(needs your input)*

I don't know which feed your platform settles on — question is asked below. Once known, either:
- Swap Path A's primary source to that feed, or
- Add a second parallel ingest (`candles_settlement` table keyed on the settlement feed) used only by `resolvePredictionsServer`, leaving OKX as the feature source.

### 4. Verify + harden the resolution writer *(bugfix)*

`src/lib/prediction.server.ts` + `src/routes/_authenticated/history.tsx`

- Current writer already sets `actual_next_candle_open/high/low/close` and `actual_direction = close>open?GREEN:close<open?RED:DOJI`. Recent rows prove it works. Add:
  - A safety assertion before the update: reject writes when `resolution.candle.open === 0 || !Number.isFinite(open|close)` — logs to `api_runs.error_message` instead of silently poisoning a row.
  - Coerce actual_direction on read in the CSV `enrich()` too (already there as fallback) — belt-and-suspenders.
- Find the second insertion path that produced the 19:15/19:30 rows with null `input_candle_ts` and route it through the same `freshnessFor()` + payload builder. If it's a per-model loop, extract a shared `buildPredictionInsert()` helper so audit fields can't be skipped.
- One-shot repair migration for any pre-fix rows that still have `actual_next_candle_open IS NULL AND status IN ('win','loss','push')`: refetch OHLC from OKX/Coinbase and backfill.

### 5. Auditability

Add columns to `predictions` and `predictions_archive`: `fetch_source text` (which feed produced the candle used at prediction time), `advance_check_passed boolean`, `current_partial_minutes_elapsed int`. Extend the CSV export in `history.tsx` to include them.

### 6. Cron split + per-phase timing

- Log per-phase durations in `scheduled-15m-run` response payload (`fetch_ms`, `resolve_ms`, `predict_ms`, `total_ms`).
- Split the cron: keep `predict + fetch` at :14/:29/:44/:59, and move `resolve` to its own :01/:16/:31/:46 job so an AI-gateway 20s spike can never delay the predict tick.

## Execution order

1. Migration: add audit columns + backfill NULL resolutions (needs your approval).
2. Ship #1 (fetch redundancy + advance assertion) — unblocks predictions today.
3. Ship #4 (writer verification + unified insert helper).
4. Ship #2 (in-progress candle) — the actual edge upgrade.
5. Ship #5 + #6 (auditability + cron split).
6. #3 waits on your feed answer.

## One clarifying question before I plan the ingest source

Which feed does the platform settle green/red on? If you don't know, best proxy is: paste one recent borderline candle where you thought it was green and it settled red (or vice versa) and I'll diff feeds. Options:
- **Coinbase spot** (BTC-USD)
- **Binance spot** (BTC-USDT)
- **Kalshi index** (they publish which feed)
- **CME BRR / CF Benchmarks** (an oracle blend)
- **Don't know — investigate**

I'll default to "Coinbase spot" for the ingest fallback in step 1 regardless, since Path A needs a second source no matter what.
