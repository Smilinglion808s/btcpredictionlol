
## Goal

Autobetter should bet on **Variant B2's** decision. Model 6 keeps running (feature snapshot + stats + shadow lineage) but its outbound webhook is disabled. Timing stays post-boundary as today. Fix the misaligned `candle_starts_at` in the payload so the bot targets the correct Kalshi market.

## Critical bug found while scoping this

`src/lib/webhooks.server.ts` currently sets `candle_starts_at = candle_ts`, but in `src/lib/model6/engine.ts` `candle_ts` is set to `exchangeTiming.nextCloseMs` — that is the target candle's **close**, not its open. Today's payload therefore reports the wrong candle window (starts_at 15m late, ends_at 15m past the actual close). The B2 cutover MUST fix this in the same change or the bot bets on the wrong market — exactly the failure you flagged.

Correct mapping:
- `candle_starts_at` = `candle_ts - 15m`
- `candle_ends_at`   = `candle_ts`
- `target_candle_close_at` = `candle_ts` (new, explicit)

## What changes

### 1. New unified webhook payload builder — B2-first

Rename/rework `buildPredictionPayload` (or add `buildB2WebhookPayload`) so the outbound event describes B2's decision joined onto the Model 6 feature-snapshot row for context. Payload shape:

```json
{
  "event": "prediction.created",
  "model": "model7_variant_b2",
  "model_artifact_sha256": "…",
  "decision_policy_version": "model7-b2-no-nce-v1",
  "decision": "YES" | "NO" | "SKIP",
  "trade": true | false,
  "probability_green": 0.63,

  "candle_starts_at": "…",              // = candle_ts − 15m (FIXED)
  "candle_starts_at_mt": "…",
  "candle_ends_at": "…",                // = candle_ts (FIXED)
  "candle_ends_at_mt": "…",
  "target_candle_close_at": "…",        // = candle_ts, explicit alias

  "dedupe_key": "BTC-USDT-15m-<candle_starts_at>",
  "prediction_id": "<uuid of predictions row>",
  "shadow_id":     "<uuid of model7_shadow B2 row>",

  "btc_price_at_prediction": …,
  "market_condition": …,
  "timing_status": "ON_TIME" | "LATE_WARNING",
  "boundary_delta_ms": 1523,
  "sent_at": "…", "sent_at_mt": "…", "timezone": "America/Denver"
}
```

Keep the legacy Model 6 keys (`prediction`, `confidence`, `setup_type`, `reasoning_summary`) **out** of the new payload — they belong to a different model and their meaning would silently change under the same key.

### 2. Emit only on eligible B2 rows

B2 emits **only when** all of the following hold on its `model7_shadow` row:

- `status = 'pending'` (i.e. actually scored, not `skipped`/`error`)
- `leakage_check_passed = true`
- `timing_status IN ('ON_TIME','LATE_WARNING')`
- `decision IS NOT NULL` and `probability_green IS NOT NULL`
- `model_fit_id != 'timing_wait_exceeded'`

For `decision = 'SKIP'`, the payload is still sent with `trade: false, decision: "SKIP"` so the bot has an explicit "no order" signal instead of silence — the bot must refuse to order on `trade=false`. If you'd rather suppress SKIPs entirely, we flip one flag.

### 3. Delete Model 6's outbound webhook call

In `src/lib/model6/engine.ts`, remove the `deliverWebhook("prediction.created", buildPredictionPayload(inserted))` block right after the production insert. Model 6 still writes to `predictions`, still runs stats, still produces the snapshot that Model 7 features off of — it just stops calling out.

### 4. B2 becomes the emission site

Extend `runVariant` in `src/lib/model7/shadow.ts` (only when `variant === 'B2'` and eligibility holds) to call the new `deliverWebhook(...)` after the shadow row is inserted. This runs inside the existing shadow try/catch so a webhook failure never blocks shadow logging.

### 5. Idempotency

- Payload dedupe key: `BTC-USDT-15m-<candle_starts_at ISO>`. No model name in the key — future models replacing B2 must not double-bet.
- DB backstop: unique index on `model7_shadow (variant, candle_ts)` so B2 can never insert two rows for the same candle. (Migration adds the index if not already present.)

### 6. Resolution webhook (`prediction.resolved`)

Today `prediction.resolved` fires from the Model 6 resolver. Keep it firing but strip the Model-6-specific fields (`prediction`, `confidence`, `setup_type`) and add:
- `dedupe_key` (same format)
- `b2_decision`, `b2_would_trade`, `b2_probability_green` (looked up from the B2 shadow row for the same candle)
- `actual_direction: "GREEN" | "RED" | "DOJI"`
- `b2_result: "win" | "loss" | "push" | null`

This gives the bot a clean matched pair without changing your existing resolution plumbing.

## What does NOT change (deliberate)

- Model 6 continues running exactly as today: features, indicators, module points, partial snapshot, stats. Its `predictions` rows remain the input Model 7 reads.
- Model 6 stats card on `/stats` is untouched (you said not to wipe it).
- Model 7 shadow card (A / B / B2) is untouched.
- Model 6 → Model 7 retraining path is untouched — trainer reads resolved `predictions` rows, which still exist.
- No table drops. No column renames. No cron changes.

## Cutover order (single deploy)

1. Migration: unique index on `model7_shadow(variant, candle_ts)`.
2. Add new B2 payload builder in `src/lib/webhooks.server.ts` (with the fixed `candle_starts_at`).
3. In `src/lib/model7/shadow.ts` `runVariant`, add B2-only webhook call for eligible rows.
4. In `src/lib/model6/engine.ts`, remove the Model 6 `deliverWebhook("prediction.created", …)` call.
5. Update `prediction.resolved` builder to the neutral shape.
6. Add tests: payload timestamps (`candle_starts_at = candle_ts − 15m`), dedupe key format, SKIP → `trade:false`, blocked/leakage/timing rows → no emit, Model 6 no longer emits.

## Risks explicitly handled

| Risk you raised | Handling |
|---|---|
| Wrong candle in payload | `candle_starts_at` fixed to `candle_ts − 15m` |
| Duplicate bets during cutover | Model 6 webhook removed in same deploy; dedupe key excludes model name |
| Blocked/leakage/timing rows treated as bets | Explicit eligibility gate; those rows never emit |
| SKIP silently reinterpreted | Payload always includes `trade: false, decision: "SKIP"` |
| B vs B2 confusion under same artifact | `model_artifact_sha256` + `decision_policy_version` both logged |
| Stale bets | `boundary_delta_ms` and `timing_status` in payload; bot enforces window |
| Model 6 feature producer accidentally killed | Only the webhook call is removed; everything upstream stays |

## Open item (not blocking cutover)

Phase 3 rename (`model6/runPrediction` → `sharedFeatures/buildPredictionSnapshot`) is deliberately **not** in this change. It's a pure rename with zero behavior change and can ship later once B2 has a clean week of live data.
