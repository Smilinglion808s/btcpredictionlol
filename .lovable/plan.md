# Public Prediction API + Webhook for External Bots

Two ways for another bot to consume the 15m prediction the moment it's made:

1. **Pull:** a public JSON endpoint the bot can hit any time.
2. **Push:** a webhook we POST to the bot's URL the instant a prediction is created.

## 1. Public GET endpoints

Stable published host: `https://btcpredictionlol.lovable.app`

- `GET /api/public/predictions/latest` — most recent prediction.
- `GET /api/public/predictions/upcoming` — prediction for the next 15m boundary (or `{ prediction: null }` if not yet generated).

No auth. JSON only. `Cache-Control: no-store`. CORS `*` + `OPTIONS` handler.

### Response shape

```json
{
  "model_version": "btc15m_m2_1",
  "candle_ts": "2026-07-01T20:15:00Z",
  "candle_ends_at": "2026-07-01T20:30:00Z",
  "prediction": "YES" | "NO" | "NO CLEAR EDGE",
  "confidence": 60,
  "confidence_fraction": "3/5",
  "btc_price_at_prediction": 62450.12,
  "setup_type": "bullish reclaim",
  "reasoning_summary": "flip: 62200 • confirm: 62650 • trade: TRADE",
  "status": "pending" | "win" | "loss" | "push",
  "created_at": "2026-07-01T20:14:02Z",
  "resolved_at": null
}
```

## 2. Outbound webhook (push)

We POST the same JSON to a URL you provide, right after each prediction is created (and again when it resolves, so the bot sees win/loss).

### Delivery details

- Method: `POST`
- Content-Type: `application/json`
- Headers:
  - `X-BTC15M-Event: prediction.created` or `prediction.resolved`
  - `X-BTC15M-Signature: sha256=<hex>` — HMAC-SHA256 of the raw body using your shared secret (bot verifies to confirm it's really us).
- Body: same shape as the GET endpoint, plus `"event": "prediction.created" | "prediction.resolved"`.
- Retries: up to 3 attempts with backoff (2s, 10s, 30s). Non-2xx = retry. All attempts logged in `api_runs` for debugging.
- Timeout: 5s per attempt.

### Config

Stored in a new `webhook_endpoints` table (so you can add/disable without a redeploy). Fields: `url`, `secret`, `events` (array), `is_active`, `created_at`, `last_delivery_at`, `last_status`.

To register your bot's endpoint I'll need from you (after the plan is approved):

- The **URL** to POST to.
- Whether you want `created`, `resolved`, or **both** (default: both).

The HMAC secret will be auto-generated and shown to you once so you can paste it into the bot.

## Implementation (technical)

1. `src/routes/api/public/predictions/latest.ts` and `.../upcoming.ts` — GET handlers using a publishable-key Supabase client, projecting only safe columns.
2. Migration:
   - `GRANT SELECT` (safe columns) + `TO anon` SELECT RLS policy on `predictions` so publishable reads work. Sensitive columns (`full_ai_response`, `indicators`) stay non-anon via column-level grant.
   - New `webhook_endpoints` table (service_role write, no anon access) + `webhook_deliveries` log table.
3. `src/lib/webhooks.server.ts` — `deliverWebhook(event, payload)` that loads active endpoints, signs with HMAC, POSTs with retry, logs to `webhook_deliveries`.
4. Hook it into `prediction.server.ts`:
   - After successful insert → fire `prediction.created`.
   - Inside `resolvePredictionsServer` after each update → fire `prediction.resolved`.
5. No changes to cron, UI, or the model pipeline.

## Sample verification (for the bot)

```js
const expected = crypto
  .createHmac("sha256", process.env.BTC15M_WEBHOOK_SECRET)
  .update(rawBody)
  .digest("hex");
const ok = header === `sha256=${expected}`; // timing-safe compare
```
