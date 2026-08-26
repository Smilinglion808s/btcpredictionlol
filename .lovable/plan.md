# T10 Bridge R1 — implementation plan

A new, fully independent T+10s BTC 15-minute model, built on the proven T30 PriceFlow
skeleton. T30, T45, ES1, A2, V6 code, tables, rolling state and webhooks are untouched.

## What exists today (inspected)

- `services/binance-ob-collector/src/t30Kline.js` — always-on Railway collector already
  holds a dedicated `btcusdt@kline_1s` Binance Global Spot WebSocket, buffers offsets
  0..29 per 15m target, flushes at offset 29 and calls the T30 boundary hook.
  T10 will reuse this exact stream: flush offsets 0..9 the instant offset 9 finalizes,
  fire the T10 hook, and keep collecting for T30 independently. No second socket.
- `src/lib/t30/*` — config / ingest / features / head (fit + L-BFGS) / store / orchestrator /
  webhook / statsQuery / exportStream, plus `t30-ingest` and `t30-boundary-run` routes.
  T10 mirrors this file-for-file under `src/lib/t10/`.
- `src/lib/t45pf/*` — certified L-BFGS fit service, day-balanced weights, absolute source
  index blocks, streaming CSV. T10 reuses these conventions.
- Prior-candle Spot + Futures technicals already exist in the ES1/T45 feature code and will
  be reused for the 65 completed-candle features.

## Build steps

1. **Migration**: `t10_bridge_samples` (target_ts + offset_seconds + collector_version),
   `t10_bridge_predictions` (one idempotent row per target, all prediction-time fields
   immutable), `t10_bridge_fits`, `t10_bridge_activation` (singleton, seeded
   `SHADOW_ONLY`, webhooks disabled), `t10_collector_health`. Service-role grants, RLS on,
   read-only anon policy matching the T30 tables.
2. **`src/lib/t10/config.ts`** — the frozen identity block verbatim (version, variant,
   schema, epoch, 2784 / 96 / 8640, 768 / 96 windows, 0.75 / 0.60 floors, C = 0.0003,
   quantiles 10/90, both frozen hashes) plus the frozen 94-name feature order.
3. **`features.ts`** — every current-packet formula exactly as specified, direction-aligned
   with `d`, plus the prior completed Spot/Futures candle technicals and basis/session terms.
   Strict packet validator: exactly offsets 0–9, all finalized, no gaps/dupes, no offset ≥10,
   all finite.
4. **`head.ts` / `fitService.server.ts`** — RobustScaler(10,90) + certified L-BFGS
   (C 0.0003, max_iter 2000, tol 1e-6, day-balanced weights normalised to mean 1),
   fits anchored to the immutable source epoch: first fit at absolute index 2784, refit each
   96 rows, ≤8640 strictly-prior rows. Full artifact provenance persisted; uncertified fits
   fail closed.
5. **Ranks** — strict past-only long (exactly 768) and fast (exactly 96) windows over
   certified probabilities, equality included, own state only, checksums persisted.
6. **`orchestrator.server.ts`** — the frozen 9-step first-match decision tree with the
   listed reasons, policy fields kept separate from activation/webhook fields, atomic
   webhook claim (`${predictionId}:${model_version}`), OKX canonical resolution
   (idempotent, updates only resolution fields).
7. **Collector + hooks** — `t10Kline` flush inside the existing T30 collector,
   `/api/public/hooks/t10-ingest` and `/api/public/hooks/t10-boundary-run` (HMAC-signed,
   cron watchdog as backup, offsets 0–9 only). T10 errors are caught and can never delay
   T30/T45.
8. **Backfill + parity** — replay engine over reconstructed history; run the frozen
   checkpoints and both decision-stream hashes and report any first mismatch timestamp.
9. **Dashboard card + CSVs** — `T10-Bridge.csv` and `T10-Bridge-last-24h.csv` as streaming
   endpoints (same pattern as the fixed T30/T45 exports, no 1,000-row truncation), plus the
   T10 card with every listed metric.
10. **Tests** — the full deterministic list in the spec, then the whole suite + typecheck.

## Risks I want to flag before starting

- **Historical source**: the spec's parity numbers come from your research pipeline over
  official Binance 1s archives (Dec 2025 → Aug 2026). I can download and checksum those
  archives, but exact reproduction of `cc606f24…` / `061dd471…` depends on your pipeline's
  serialisation details. If a hash differs I will report the first row-level mismatch rather
  than tune anything.
- **Volume**: ~260 days of 1s spot klines plus 15m spot/futures history, ~25k targets and
  ~235 sequential refits. This is a long-running job; I'll run it as a background replay and
  report progress.
- Everything through step 7 (live shadow predictions on natural LIVE packets) is
  deliverable independent of parity results.

T10 stays `SHADOW_ONLY` with webhooks disabled at the end of this work.
