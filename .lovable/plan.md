# BTC 15m Prediction Dashboard — Build Plan

A private, auth-gated dark dashboard that pulls BTC-USDT 15m candles from OKX, runs OpenAI predictions, tracks outcomes, and surfaces stats — all updating in realtime.

## Stack note

This project is on **TanStack Start** (React + TS). You asked for "Supabase Edge Functions" for all external API calls — I'll honor that intent: every OKX and OpenAI call runs server-side with secrets, never in the browser. Concretely:

- **External API logic (OKX fetch, OpenAI call, resolve, scheduled tick)** → Supabase Edge Functions (Deno). This is what you asked for and matches the "scheduled every 15m" requirement cleanly (pg_cron → edge function).
- **App-internal reads (list predictions, stats, settings CRUD)** → TanStack server functions hitting Supabase with RLS as the signed-in user. (TanStack Start convention; keeps the UI fast and type-safe.)

Frontend calls edge functions via the Supabase client (with the user's JWT) — keys stay server-side.

## Auth

- Email/password + Google sign-in via Lovable Cloud.
- Every app route protected under `_authenticated/`.
- No public pages besides `/auth`.

## Database (migration)

Tables exactly as specified:

- `candles` — unique on `(symbol, timeframe, candle_ts)`.
- `predictions` — status enum-checked; resolved fields nullable.
- `model_settings` — one active row; `indicator_weights jsonb`, `prompt_template text`.
- `api_runs` — request/response log for every edge function call.

Plus:
- `app_users` allow-list table (so only invited users can use the dashboard; RLS uses it).
- RPC `prediction_stats()` returning a single JSON row with: totals, wins/losses/pushes/pending, overall WR, last-10/25/50 WR, YES WR, NO WR, avg confidence (overall, wins, losses), by setup_type, by confidence bucket, by market_condition.
- Realtime publication on `predictions`, `candles`.
- pg_cron job every 15 minutes hitting the `scheduled-15m-run` edge function via stable `project--{id}.lovable.app` URL with a shared `CRON_SECRET` header.

RLS: all four tables — authenticated read/write; service_role full. No anon access.

Seed: one `model_settings` row for **"BTC 15m Model 1.9"** with `is_active=true`, `confidence_threshold=55`, `auto_run_enabled=false`, full `indicator_weights` JSON (failed-breakout/wick-rejection highest), and the exact prompt_template you provided.

## Secrets

- `OPENAI_API_KEY` — added via secure form.
- `OKX_REST_BASE_URL` — default `https://www.okx.com`, overridable.
- `CRON_SECRET` — generated, used by pg_cron → edge function.

## Edge Functions

1. **`fetch-okx-candles`** — GET `${OKX_REST_BASE_URL}/api/v5/market/candles?instId=BTC-USDT&bar=15m&limit=200`, normalize, upsert into `candles`, return latest 200. Logs to `api_runs`.
2. **`run-ai-prediction`** — load last 100 candles, compute indicators (EMA 9/21/50, body/wick ratios, volume trend, S/R proximity, failed-breakout/reclaim heuristics, range/chop score), call OpenAI Responses API with your exact system prompt + user prompt template, parse strict JSON, insert into `predictions` with `status='pending'` (or `'manual_review'` if settings require approval). Returns the saved row.
3. **`resolve-predictions`** — for each pending prediction whose target candle is closed, compare next-candle open vs close, update status + actual OHLC + `resolved_at`.
4. **`scheduled-15m-run`** — verifies `CRON_SECRET`, calls fetch → resolve → (if `auto_run_enabled`) run-ai-prediction. Also callable from the UI via the "RUN NEXT CANDLE" button (auth path, no cron secret needed).

OpenAI model: `gpt-5` via Responses API with `response_format: json_object` and the system instruction you provided verbatim.

## Pages

- **`/` Dashboard** — header (price, 24h Δ, 15m countdown, last-updated, model version), candlestick chart with EMA 9/21/50 + volume (lightweight-charts), latest prediction card (color-coded), buttons: RUN NEXT CANDLE, Refresh Candles, Auto-Run toggle (writes to active `model_settings`). Disclaimer footer.
- **`/stats`** — KPI grid + breakdown tables (by setup, confidence bucket, market condition) + recent history table. All from `prediction_stats` RPC.
- **`/history`** — filterable table (date range, YES/NO, status, confidence range, setup, model version), inline manual-override dropdown that writes `status` + `notes`.
- **`/settings/model`** — form to edit active model: name/version, confidence threshold, auto-run toggle, manual-approval toggle, indicator weights (per-key number inputs from the jsonb), prompt template (textarea). Creates a new row when version name changes; flips `is_active`.
- **`/auth`** — sign in / sign up.

## Design

Dark trading-terminal palette in `src/styles.css` design tokens — deep slate background, neon-green for YES/wins, red for NO/losses, amber for pending/manual-review, cyan accent for charts. JetBrains Mono for numerics, Inter for UI. No purple. Cards, badges, semantic tokens — no hardcoded colors in components.

## Realtime

Subscribe to `predictions` and `candles` channels in the dashboard + stats + history pages; invalidate React Query keys on change.

## Out of scope (per your note)

No order placement, no trade execution, no wallets. Tracking and stats only. Disclaimer visible on dashboard.

---

Approving this will: enable Lovable Cloud, prompt you once for `OPENAI_API_KEY`, then ship the full app.