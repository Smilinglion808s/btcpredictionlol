# V1.2 prediction webhooks

The predictor sends a separate HTTPS POST according to the selected model leg.
These endpoints belong to the separate betting project's recording interface.
The prediction worker has no exchange credentials and places no orders.

| Leg | Model ID | Destination |
|---|---|---|
| V1 | `v12-v1-r1` | `https://ruxndqfjfdbtdbkheuge.supabase.co/functions/v1/v12-v1` |
| T45 R2 fallback | `v12-t45r2-r1` | `https://ruxndqfjfdbtdbkheuge.supabase.co/functions/v1/v12-t45r2` |
| Original U | `v12-original-u-r1` | `https://ruxndqfjfdbtdbkheuge.supabase.co/functions/v1/v12-u` |

All use `combined_model_version: v12-original-u-4-5-10-r1`.
The body contains `leg`, `model_version`, `market`, `prediction` (YES/NO),
`candle_starts_at`, `decision_at`, `sent_at`, and a route-independent
`interval_key`. Times are ISO UTC. The body currently carries `mode: shadow`:
the installed receivers store signals and return `execution_enabled: false`.
Delivery is live; this flag describes receiver behavior, not historical data.

U additionally includes `checkpoint_seconds`, `u_source` (L/R), `probability`
(selected-side probability), `known_ask`, `arrival_ask`, `limit_all_in`,
`fit_version`, and the rechecked V1/T45 eligibility evidence. It retains the
original checkpoints at 120/180/300/480/600/720 seconds, with L available at
480/600/720 and L preferred before testing arrival price. No U alert is sent
for a V1/T45 price rejection, closed daily floor, claimed interval or stale fit.

## Authentication and identity

`x-btc15m-signature` is `sha256=` plus the lowercase HMAC-SHA256 hex digest
over the exact UTF-8 request body, using the existing shared webhook secret.
Verify the raw body before parsing. Never expose this secret in a browser.

Additional headers identify the same signed body values:

- `x-v12-leg`: V1, T45R2 or U.
- `x-v12-model`: the corresponding model ID above.
- `x-v12-event-id`: `<interval_key>:<leg>`.

The receiver must rely on signed body identity; headers alone are not proof.
Use the event ID for signal deduplication and the shared interval key to
coordinate any downstream decisions across routes. A different model ID does
not authorize an additional position in the same market.

## Delivery and downstream ownership

V1/T45 messages are accepted only within their first-minute decision window;
U uses the original five-second checkpoint window. All signals have a short
freshness limit. On a timeout, the predictor marks the receipt unconfirmed and
does not replay an expired prediction. A restart does not fabricate missed
quotes or send old checkpoints. The recording receiver also deduplicates the
exact body hash. No heartbeat or authentication probe is a prediction.

The predictor's `v12_prediction_events` contains per-leg delivery receipts;
`v12_predictor_runtime` contains authenticated worker status. The destination's
`v12_shadow_signals` retains the full signed prediction payload and receipt ID.
All are private server-side tables. The tile shows aggregate route counts.

The locked 4% V1 / 5% T45 / 10% U and maker-only / taker-only / maker-only
fields are downstream metadata. There is no predictor dependency on a bankroll
snapshot. `DAY_OPENING_UNAVAILABLE` from the recording endpoint means the signal
was stored without a calculated betting budget; it is still an acknowledged
prediction. Actual bet sizing, order selection, fees, fills and account risk
are handled by the user's external betting system.

## Fit refresh

Original U refits every 21 days using the preceding 84 days and a one-day
embargo, preserving the recovered estimators and selection policy. The initial
fit expires Oct5 2026 00:00 UTC. New features and official outcomes are captured
for refresh; inadequate recent data or a failed fit pauses U when its fit
expires. The V1 and T45 model schedules remain unchanged. Dashboard delivery
counts and model outcomes are separate from actual trading profits.
