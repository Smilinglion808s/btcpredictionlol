# V1.2 discovery (read-only)

Nothing was changed: no files, data, secrets, or sends. Findings only, plus the architecture shape for adding later checkpoints.

## 1. Version 1.1 dashboard tile

- `src/components/v11-card.tsx` — `V11Card`, rendered first on `src/routes/_authenticated/stats.tsx` (imported with `LiteACard`).
- Data: `src/lib/v11.functions.ts` → `getV11Stats` (POST server fn, `cachedStats("v11-stats", …)`) → `src/lib/v11/statsQuery.server.ts` → `buildV11Stats()`. Sent-evidence match is by `dedupe_key` against `webhook_deliveries` rows with HTTP 2xx.
- Palette tokens live in `src/styles.css` (`--steel-vivid`, `--signal-orange-vivid`, `.v11-chip`).

## 2. Early V1 commit + T45R2 dispatch/claim

- V1 (Railway worker) posts to `src/routes/api/public/hooks/c85-decision.ts` or `c85-ops.ts` → `runC85Op` in `src/lib/c85/ops.server.ts` (commit_decision branch, ~lines 360-445) → `dispatchLiteaDecision`.
- `src/lib/litea/dispatch.server.ts`: `evaluateLiteaDispatch`, `liteaPayloadFromRecord`, `dispatchLiteaDecision`, `newDispatchOwner`, `LITEA_CLAIM_RPC = "c85_litea_claim_outbox"`, `liteaTransportDeadlineMs()` (8 s goal), `liteaSendHardCapMs()` (900 s cap), `liteaServerExecutionEnabled()`, `liteaEffectiveAllowlist()`.
- V1.1 fallback: `src/routes/api/public/hooks/t45-boundary-run.ts` → `v11ObservationGate` (`src/lib/v11/hookGate.ts`) → `v11ObserveAndDispatch` (`hookPipeline.ts`) → `observeV11Target` (`src/lib/v11/observer.server.ts`) → `dispatchV11FallbackForObservation` → `dispatchV11FallbackFromCommit` → `dispatchV11Fallback` (`src/lib/v11/dispatch.server.ts`, with `ownsClaim`, `v11EventDedupeKey`, `relabelV1PayloadAsV11`, `v11V1LegDeliver`, `v11V1LegClaimRelabel`, `v11V1LegGateReaders`, `v11DeliveryArmed`, `v1DeliveryDisabled`).
- Both legs claim the same canonical per-interval key in `c85_outbox` via the same RPC — at most one automatic outbound per interval.
- Storage helpers: `src/lib/v11/store.server.ts` (`readState`, `readLiveContext`, `upsertContextRow`, `readT45InputsFromSamples`, `readV1Snapshot`, `readV1SendClaim`, `commitObservation`, `insertDecision`, `appendScore`, `readMissingPredecessors`, `advanceState`).

## 3. Webhook payload and signature

- Payload builders: `src/lib/litea/webhook.server.ts` (`buildLiteAWebhookPayload`, `liteaDedupeKey`, `liteaExecutionGate`) and the V1.1 relabel in `dispatch.server.ts`.
- Transport: `src/lib/webhooks.server.ts` — HMAC-SHA256 of the body with each endpoint's own secret, header `x-btc15m-signature: sha256=<hex>`; per-model allow-list `WEBHOOK_ALLOWED_MODELS` (currently empty set) plus `dispatchAllowed` logic; deliveries recorded in `webhook_deliveries` (`attempt_started_at`, `attempt_start_offset_ms` are the authoritative send timings).
- Inbound signed hooks use a different scheme: `HMAC(secret, "<timestamp>.<rawBody>")` with headers `x-t45-timestamp` / `x-t45-signature` (`t45-ingest.ts`, `t45-boundary-run.ts`).

## 4. Railway litea worker and collector

- Worker: `services/c85-worker/src/litea/` — `worker.py`, `main.py`, `packet.py` (input freeze / `feature_window_end`), `engine.py`, `guard.py`, `heads.py`, `state.py`, `store.py`, `fit.py`/`fit_service.py`, `strike_policy.py`, `outcomes.py`, `dispatch.py` (`execution_enabled`, `transport_deadline_ms`, `send_hard_cap_ms`, `prepare_outbox`), `identity.py` (`MODEL_ID = lite-a-floor4-top10-r1`, `BASE_MODE = baseline`, `EXCEPTION_RANK = 0.90`), `bridge.py`, `remote.py`, `reconstruct.py`.
- Collector: `services/binance-ob-collector/src/t45Kline.js` — Binance global spot `btcusdt@kline_1s`, keeps FINAL bars at offsets 0..44 only, flushes to `/api/public/hooks/t45-ingest`, then fires the signed boundary trigger to `/api/public/hooks/t45-boundary-run`. Also present: `t10Kline.js`, `t30Kline.js`, `localBook.js` (order-book depth).

## 5. Data available for later checkpoints

- `t45_second_samples` — one-second spot bars, **offsets 0..44 only** (verified: max offset in the last day is 44, 45 distinct). Nothing beyond T+45 s is captured today.
- `t45_features` — derived 45 s PriceFlow + order-book depth/imbalance features.
- `candles` — 15 m BTC-USDT OHLCV (`symbol`, `timeframe`, `candle_ts`).
- Order book / perp: `b4x4_es1_binance_ob_observations`, `..._boundary_features`, `b4x4_ob_snapshots` (enum `binance_ob_market_kind`: SPOT, USD_M_PERP) — perp exists in this stack, on a boundary cadence, not a 1-minute series.
- Kalshi: `src/lib/kalshi.server.ts` (`buildKalshiEventTicker`, `fetchKalshiResolution`) and `src/lib/v11/kalshi.server.ts` (`fetchV11NativeResolution`) hit `api.elections.kalshi.com/trade-api/v2` events/markets — settlement and market fields; no stored quote/bid-ask time series table exists.
- No one-minute index-price feed and no stored Kalshi quote history exist today. Both would be new capture work.

## 6. Architecture for U checkpoints (120/180/300/480/600/720 s)

```text
collector (Railway)  ──1s bars, offsets 0..719──▶  /api/public/hooks/u-ingest (signed)
                     ──checkpoint trigger @120,180,300,480,600,720s──▶ /api/public/hooks/u-checkpoint-run
                                                       │
                                                       ▼
                        u observer  ──▶ u decision row (immutable, per checkpoint)
                                                       │
                     canonical per-interval claim (c85_outbox, existing RPC)
                                                       │
     priority: V1 (T+5) ▶ T45R2 (T+45) ▶ U checkpoints in ascending time
```

Shape that fits the existing code without touching V1 math:
- Extend the collector's retention window past offset 44 (new collector version string) and add a `u_second_samples` table rather than widening `t45_second_samples`, so T45 validation stays exactly as is.
- One new module tree `src/lib/u/` mirroring `src/lib/v11/` (config, features, head, decision, store.server, observer.server, dispatch.server, statsQuery.server) with its own tables `u_*`.
- Reuse the existing claim RPC and dedupe key so V1.1 keeps priority: a U checkpoint may only claim an interval that no earlier leg claimed. The guard stays untouched — U is an additional route, never a modifier of V1/V1.1 decisions.
- Route tracking: add a `route`/`leg` value (`V1`, `T45R2`, `U120`…`U720`) on the decision and payload; tile shows the three routes separately.
- Stake metadata per route: V1 4 % maker, T45R2 5 % taker, U 10 % maker, all on Boise-day opening bankroll (existing constant `V11_STAKE_FRACTION_OF_BOISE_OPEN = 0.04` in `src/lib/v11/config.ts`).
- Shadow first: U dispatch behind its own default-off switch, mocked transport in tests, no destination until reviewed.

## 7. Live gating (names only)

- `LITEA_SERVER_EXECUTION_ENABLED`, `LITEA_EXECUTION_ENABLED`, `V11_SERVER_EXECUTION_ENABLED` (`V11_EXECUTION_ENV`).
- `WEBHOOK_ALLOWED_MODELS` (in-code set, currently empty) + `webhook_endpoints.is_active` (one active `prediction.created` destination).
- Timing: `LITEA_TRANSPORT_DEADLINE_MS` (8 s goal), `LITEA_SEND_HARD_CAP_MS` (900 s), `V11_EVENT_CUTOFF_OFFSET_MS` 45 s, `V11_PUBLICATION_CEILING_MS` 60 s, `V11_SEND_HARD_CAP_MS` = 15 m.
- Inbound secrets (names): `T45_INGEST_SECRET` / `BINANCE_OB_INGEST_SECRET`, `C85_GATEWAY_SECRET`.

## 8. Deploy and commands

- No `.github` directory in this repo — no GitHub Actions workflow is present, so I cannot confirm GitHub main auto-deploy from the codebase; production goes out through the Lovable publish/deploy step (last one was a manual deploy you triggered).
- Commands: `bun run dev`, `bun run build`, `bun run test` (`bunx vitest run src/lib/v11` = 156 tests), `bunx tsgo --noEmit -p tsconfig.json`, `bun run lint`. Python worker: `pytest` under `services/c85-worker`.

## Open questions before building V1.2

1. U inputs: extend the existing 1 s collector to 720 s, or sample 1-minute bars from a REST source at each checkpoint?
2. Do U checkpoints need Kalshi quotes (bid/ask) at decision time? That requires a new capture path.
3. Should a U send be blocked for an interval where V1 or T45R2 already sent, or allowed as a second independent order?
