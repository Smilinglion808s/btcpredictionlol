# Version 2 — connect predictions to the betting app

## What this does
Every time Version 2 settles on its single call for a 15-minute interval, this site sends a signed message to the betting app. That message says "bet up" or "bet down" on that interval. The betting app then places the bet with its own sizing: 4% of the balance, reset each Boise day, capped at $200.

Nothing is sent until you turn on a new "Version 2 betting" switch. It starts off.

## What I build in this project
1. **Lift the record-only rule** for Version 2 and write down the new rule: Version 2 sends to its own receiver in the betting app, never to the Version 1.2 receivers.
2. **Sending switch.** A stored on/off setting for Version 2 betting. It starts off, and I show its state on the Version 2 tile. The "Betting off (recording only)" label becomes "Betting ON" or "Betting OFF".
3. **Sending queue.** When a Version 2 call is saved, a message goes into a queue in the same save. If the switch is on, it is sent right away. Failed sends are retried for up to 2 minutes, and anything older is dropped rather than sent late. Each interval gets exactly one message, marked so the betting app can ignore repeats.
4. **Signed message.** It carries the interval, up/down, which sleeve (early or late check), the decision time, the model version, and the sizing policy text. It is signed with a shared secret so the betting app can confirm it came from here.
5. **Delivery log on the tile.** Shows the last messages sent, whether each was accepted, and how long each took.
6. **Handoff document for the betting app.** The exact message format, signature check, repeat handling and sizing rule, ready to paste into that project so it can build its receiving side.

## What you need to do
- **In the betting app (separate project, which I can't touch):** paste the handoff document and have it build a Version 2 receiver with its own on/off switch. It will give you a receiver address.
- **Give me two things** through a secure form: the receiver address, and a shared secret. Make the secret with a password manager, and put the same value in both projects.
- **Publish this site**, and start the Version 2 worker in Railway. The worker is what makes the predictions, so without it nothing gets sent.
- **Turn on both switches**, this site's and the betting app's, when you're ready.

## Safety
- I never send test bets or replay old calls.
- Nothing goes to the Version 1.2 receivers.
- Version 1.2 stays halted.
- The frozen model files, thresholds and seed are not changed.

## Technical details
- New migration: table `v2_forward_outbox` (candle_open PK, payload jsonb, status, attempts, last_error, sent_at, response_ms), with GRANTs to service_role only and RLS on. Also a table `v2_forward_settings` (enabled bool default false), and `v2_record_checkpoint` extended to insert the outbox row in the same transaction when an intent is created.
- `src/routes/api/public/hooks/v2-record.ts`: after a new intent, if enabled, POST to `V2_FORWARD_URL` with HMAC-SHA256 (`x-v2-timestamp`, `x-v2-signature`) using `V2_FORWARD_SECRET`, 5s timeout, and update the outbox. A retry sweep runs on each heartbeat, only for rows under 2 minutes old.
- `src/lib/v2/contract.ts`: `V2_EXECUTION` becomes derived from the setting.
- New doc: `docs/v2-betting-receiver-handoff.md`.
- Update the rule in `AGENTS.md`, plus the tests (contract and SQL checks).
