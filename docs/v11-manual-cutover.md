# Version 1.1 — manual cutover (NOTHING is armed)

Version 1.1 is one stream with two legs, and this project makes **at most one
automatic outbound attempt per interval**:

| Leg | When | Source | Claim |
| --- | --- | --- | --- |
| `V1` | T+5s, on the ORIGINAL Version 1 early commit path | the persisted, admitted `lite-a-floor4-top10-r1` decision, gates/guard/floor/deadline untouched | canonical interval key |
| `T45R2` | T+45s, only after a signed, on-time `LIVE_SHADOW` observation committed atomically | `v11_decisions` row, rank >= admission gate AND >= 0.80, original V1 recorded `CONFIDENCE_ABSTAIN` with its floor open | the SAME canonical interval key |

Both legs claim the same key in the same durable table, and both require
**exactly one** active destination, so this project transmits at most one
signal per interval. What the external betting bot then does with that signal —
including whether it places an order, and how many — is owned by the bot and is
not guaranteed by anything here.

## Current state (no delivery possible)

| Control | Where | Value today | Effect |
| --- | --- | --- | --- |
| `LITEA_SERVER_EXECUTION_ENABLED` | Lovable secret (server env) | present but **empty**, i.e. not `"true"` | original Version 1 delivery paused |
| `V11_SERVER_EXECUTION_ENABLED` | Lovable secret (server env) | not set | Version 1.1 delivery off |
| `WEBHOOK_ALLOWED_MODELS` | **source constant** in `src/lib/webhooks.server.ts` (not a secret) | empty `Set` | no static sender entry for any model |
| webhook endpoint `446848c3-…` | `webhook_endpoints` | `is_active = false` | no destination at all |

Both models keep predicting, scoring, grading and recording while delivery is
off. Only transmission is suppressed.

## Manual activation steps (a human does these, in this order)

1. **Confirm the external bot.** The bot operator must accept the combined
   identity before anything is switched on. This project cannot verify the bot
   and never configures it:
   - model id `v11-original-confidence-rank80-4` (both legs), with
     `leg` = `V1` or `T45R2` and `source_model_version` =
     `lite-a-floor4-top10-r1` on the V1 leg;
   - the bot's own model filter must admit that id — a filter that only knows
     `lite-a-floor4-top10-r1` silently ignores every message;
   - `stake_fraction_of_boise_day_opening_principal = 0.04` is **metadata**.
     The external bot owns sizing and order placement; this project never
     places an order.
2. **Leave the endpoint paused for now.** Keeping the destination inactive
   means the following steps cannot transmit anything by accident.
3. **Set the control.** In Lovable: **More → Cloud → Secrets**
   (<https://docs.lovable.dev/features/secrets>) add
   `V11_SERVER_EXECUTION_ENABLED = true`.
   Leave `LITEA_SERVER_EXECUTION_ENABLED` off — Version 1.1 refuses to send
   while the original Version 1 sender is enabled.
4. **Publish / reload.** Secrets are read by the running deployment's process,
   so the app must be republished before the live process sees the new value.
5. **Verify read-only, before any destination exists.** The Version 1.1 tile
   should read "Switched on · no destination", and the Version 1 sender should
   still be off. Confirm from the hook's ordinary responses and logs — the
   signed T+45 hook already returns `v11_dispatch.verdict`, and
   `decision.commit` already returns `dispatch`. Do not invent or issue any
   extra request to produce evidence.
6. **Activate the destination LAST.** Set `is_active = true` on webhook
   endpoint `446848c3-c6b1-476c-86be-450e5571a3e0`. Exactly one active
   destination must be subscribed to `prediction.created`; with zero or several
   the combined stream refuses to transmit. From this point an admitted call is
   actually sent.

## Turning it off again

Delete `V11_SERVER_EXECUTION_ENABLED` (and/or set the endpoint inactive), then
republish. Both legs stop transmitting; predictions, grading and history
continue.

## What is deliberately NOT claimed

- The external betting bot is **not** configured or verified by this project,
  and this dashboard cannot see whether it placed an order.
- No profitability, fill, odds or loss-cap guarantee is made anywhere.
- Old `PENDING` outbox rows that expired on 2026-09-12 are history only; no
  code path resends them.
