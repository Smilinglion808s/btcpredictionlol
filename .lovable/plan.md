## Problem

Confirmed via DB check: `predictions.candle_ts` (and mirrored `model7_shadow.candle_ts`) actually stores the **start of the target candle we're predicting**, not the close. Example row: `candle_ts = 02:15:00`, `scored_at = 02:15:01` (1.5s after the 02:00→02:15 candle closed), `previous_candle_ts = 02:00:00`.

Current `buildB2WebhookPayload` computes `candle_starts_at = candle_ts − 15m`, which yields `02:00:00` — the start of the just-closed input candle, not the target. Comment in the file ("candle_ts is target close") is stale.

## Changes — `src/lib/webhooks.server.ts`

### 1. Fix candle window in `buildB2WebhookPayload`
- `candle_starts_at = candle_ts` (target candle start, e.g. `02:15:00Z`)
- `candle_ends_at   = candle_ts + 15m` (target candle close, e.g. `02:30:00Z`)
- `target_candle_close_at = candle_ends_at`
- `candle_starts_at_mt` / `candle_ends_at_mt` recomputed from the corrected values
- `dedupe_key` updates automatically since it embeds `candle_starts_at` — now `BTC-USDT-15m-2026-07-11T02:15:00.000Z`

### 2. Add three new fields (keep all existing fields untouched)
Added alongside current `decision` / `probability_green`, mapped from the shadow row:

- `prediction: "YES" | "NO" | "NO CLEAR EDGE"`
  - `would_trade === false` → `"NO CLEAR EDGE"`
  - else `decision === "YES"` → `"YES"`
  - else `decision === "NO"` → `"NO"`
  - fallback (null decision + would_trade) → `"NO CLEAR EDGE"`
- `confidence: number` (integer 0–100)
  - YES → `Math.round(probability_green * 100)`
  - NO → `Math.round((1 - probability_green) * 100)`
  - NO CLEAR EDGE → `Math.round(Math.max(probability_green, 1 - probability_green) * 100)` (highest-side confidence, still 0–100)
  - `probability_green == null` → `0`

### 3. Mirror the timestamp fix in `buildResolvedWebhookPayload`
Same off-by-one applies. Fix `candle_starts_at`, `candle_ends_at`, `target_candle_close_at`, `dedupe_key` so the resolved payload references the same window as the created payload for a given candle. No `prediction`/`confidence` fields added here (only meaningful on `.created`).

### 4. Update the stale comment
Rewrite the header comment on `buildB2WebhookPayload` to state: "`candle_ts` in the DB is the target-candle START (open time); ends_at = candle_ts + 15m."

## Out of scope

- `buildPredictionPayload` (legacy `/api/public/predictions/{latest,upcoming}`) has the same off-by-one, but Model 6 no longer emits outbound webhooks per prior work. Not touching it in this pass — flag only. Can fix in a follow-up if the public API consumers matter.
- No schema changes. No changes to shadow scoring, resolver, or UI.

## Verification

- Re-emit path unchanged; only payload shape differs.
- Confirm from `webhook_deliveries` after next candle that `candle_starts_at` matches `model7_shadow.candle_ts` exactly, and `prediction`/`confidence` fields are populated.
