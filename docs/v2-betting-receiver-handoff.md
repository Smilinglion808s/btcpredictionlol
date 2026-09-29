# Version 2 bet-signal receiver: handoff for the betting app

Paste this into the betting app project. It describes the one message the predictor site sends for each 15-minute interval where Version 2 makes a call.

## Endpoint to build
- A new route, separate from Version 1.2. Example: `POST /api/public/hooks/v2-bet-signal`.
- It needs its own **Version 2 betting on/off switch**, starting OFF. While the switch is off, return `200 {"ok":true,"ignored":"DISABLED"}` and place no bet.
- Its public URL is the value for `V2_FORWARD_URL` in the predictor site.

## Authentication
The predictor sends these headers:
- `x-v2-timestamp`: milliseconds since the epoch, as a string.
- `x-v2-signature`: lowercase hex of HMAC-SHA256(`V2_FORWARD_SECRET`, `"<timestamp>.<raw body>"`).
- `x-v2-dedupe-key`: the same value as `dedupe_key` in the body.

The receiver must:
- Read the raw body as text before parsing it.
- Recompute the signature and compare it in constant time.
- Reject with 401 if the timestamp is more than 30 seconds from its own clock.
- Use the same shared secret stored in both projects.

## Body (`schema: "v2-bet-signal/1"`)
```json
{
  "schema": "v2-bet-signal/1",
  "model_version": "v2-final-r1",
  "dedupe_key": "v2-final-r1:2026-09-29T16:15:00Z",
  "candle_open": "2026-09-29T16:15:00Z",
  "candle_close": "2026-09-29T16:30:00Z",
  "side": "UP",
  "sleeve": "v2-direction8-r1",
  "checkpoint": "T8",
  "probability": 0.61,
  "decision_at": "2026-09-29T16:15:08.412Z",
  "stake_policy": { "fraction_of_entry_day_opening_principal": 0.04, "day_reset": "America/Boise midnight", "same_dollar_stake_all_day": true, "rounding": "floor_cents", "cap_usd": 200, "p2": false, "doubling": false }
}
```
- `side` is `UP` or `DOWN`: whether BTC closes the interval above or below its open. Map it to the matching Kalshi 15-minute BTC market for `candle_close`.
- Each interval gets at most one signal.

## Rules
1. **Repeats:** delivery is at-least-once. Store `dedupe_key` with a unique constraint. For a repeat, return 200 with `{"ok":true,"duplicate":true}` and never bet twice.
2. **Late signals:** reject with 409 `LATE` if the time now is after `decision_at` + 90 seconds, or less than 60 seconds before `candle_close`.
3. **Sizing:** 4% of the balance at the start of the Boise day (floored to cents). Use the same dollar stake all day, capped at $200 per bet. No doubling, and no P2.
4. **Responses:** return 2xx once the signal is accepted (bet placed, queued, or deliberately ignored). Return 4xx for a permanent rejection; the predictor will not retry it. Return 5xx, 408 or 429 for a temporary failure; the predictor retries for up to 120 seconds after `decision_at`.
5. Keep this separate from the halted Version 1.2 path.
