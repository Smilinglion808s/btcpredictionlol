# Version 1.1 — manual cutover (NOTHING is armed)

Version 1.1 is one stream with two legs and **at most one bet per interval**:

| Leg | When | Source | Claim |
| --- | --- | --- | --- |
| `V1` | T+5s, on the ORIGINAL Version 1 early commit path | the persisted, admitted `lite-a-floor4-top10-r1` decision, gates/guard/floor/deadline untouched | canonical interval key |
| `T45R2` | T+45s, only after a signed, on-time `LIVE_SHADOW` observation committed atomically | `v11_decisions` row, rank >= admission gate AND >= 0.80, original V1 recorded `CONFIDENCE_ABSTAIN` with its floor open | the SAME canonical interval key |

Because both legs claim the same key in the same durable table, the two can
never both deliver for one interval.

## Current state (all OFF)

| Control | Where | Value today | Effect |
| --- | --- | --- | --- |
| `LITEA_SERVER_EXECUTION_ENABLED` | project secret | **absent** | original Version 1 delivery paused |
| `V11_SERVER_EXECUTION_ENABLED` | project secret | **absent** | Version 1.1 delivery off |
| `WEBHOOK_ALLOWED_MODELS` | project secret | empty | no static allow-list entry |
| webhook endpoint `446848c3-…` | `webhook_endpoints` | `is_active = false` | no destination at all |

Version 1 and Version 1.1 both keep predicting, scoring, grading and recording
while every control is off. Only delivery is suppressed.

## Manual activation steps (a human does these, in this order)

1. **External bot first.** Confirm with the bot operator that it accepts the
   combined identity. This project cannot verify the bot, and nothing here
   configures it:
   - model id `v11-original-confidence-rank80-4` (both legs), with
     `leg` = `V1` or `T45R2` and `source_model_version` =
     `lite-a-floor4-top10-r1` on the V1 leg;
   - the bot's own model/whitelist filter must admit that id — a filter that
     only knows `lite-a-floor4-top10-r1` will silently ignore every message;
   - `stake_fraction_of_boise_day_opening_principal = 0.04` is **metadata**.
     The bot sizes and executes; this project never places an order.
2. **Re-activate the destination.** Set `is_active = true` on webhook endpoint
   `446848c3-c6b1-476c-86be-450e5571a3e0` (paused 04:10 UTC 2026-09-12). With
   no active endpoint, an armed control still delivers nothing.
3. **Set the control.** Project Settings → Secrets → add
   `V11_SERVER_EXECUTION_ENABLED = true`.
   Leave `LITEA_SERVER_EXECUTION_ENABLED` **absent** — Version 1.1 refuses to
   send while the original Version 1 sender is enabled.
4. **Load the environment.** Secrets are read by the running deployment's
   process. Publish/redeploy after step 3 so the live worker actually sees the
   new value; until then the site keeps running with the old (off) environment.
5. **Verify on the next boundary**, without sending anything yourself:
   - `POST /api/public/hooks/c85-decision` dry-run reports the V1 route;
   - the signed T+45 hook response carries `v11_dispatch.verdict`;
   - `c85_outbox` gains at most one row per interval (shared key);
   - `webhook_deliveries` carries `attempt_started_at` for the single attempt.

## Turning it off again

Delete `V11_SERVER_EXECUTION_ENABLED` (and/or set the endpoint inactive), then
redeploy. Both legs stop delivering; predictions, grading and history continue.

## What is deliberately NOT claimed

- The external betting bot is **not** configured or verified by this project.
- No profitability, fill, odds or loss-cap guarantee is made anywhere.
- Old `PENDING` outbox rows expired at 04:11 UTC 2026-09-12 are history only;
  no code path resends them.
