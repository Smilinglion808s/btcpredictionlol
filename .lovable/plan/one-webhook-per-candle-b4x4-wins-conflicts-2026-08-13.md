# One webhook per candle: B4x4 wins conflicts

Today V6 waits only ~6 seconds for B4x4's decision before assuming B4x4 published nothing, then sends its own webhook. When B4x4 is slow or lands via the catch-up watchdog (seen at 01:45 today: V6 sent at 01:46:09, B4x4 row written at 01:50:56), V6 ships first and B4x4 ships later — two webhooks, and if directions differ, two conflicting trades.

## The rule

- B4x4 is the authority. If B4x4 publishes a directional trade for the candle, only B4x4's webhook goes out.
- V6 ships only when B4x4 agrees, or when B4x4 published nothing for that candle (abstain, no trade, catch-up/audit row).
- V6 never delays or alters B4x4, and no model logic, feature, threshold or decision changes.

## The fix

Gate V6's webhook on B4x4's decision being final for that exact target candle, instead of a 6-second guess:

1. V6 waits for the B4x4 row for the same `target_candle_ts` to exist and be in its final published state. Waiting happens only in the webhook step — the V6 prediction row is still written immediately, so the stats card is unaffected.
2. The wait uses a generous ceiling (matching the catch-up watchdog window) rather than 6 seconds, polling at a short interval.
3. If B4x4's decision is directional and disagrees, V6 records the suppression on its row exactly as today (`webhook_conflict_with_b4x4`, `webhook_suppressed_reason`) and sends nothing.
4. If the ceiling is reached with still no B4x4 row, V6 does **not** send. Fail-closed is the safe default under a "never two conflicting webhooks" rule; the row is marked with a distinct suppression reason so these cases are visible and countable.
5. Every outcome is recorded on the V6 row (`b4x4_direction_at_send`, eligibility, suppression reason) so the CSV export shows exactly why each candle did or did not ship.

## Technical notes

- All changes live in `src/lib/v6/webhook.server.ts`: replace the fixed 6-attempt/1s poll in `b4x4DirectionFor` with a bounded wait that distinguishes "row absent" from "row present, non-directional", and treat "absent at deadline" as suppress rather than send.
- The atomic `webhook_sent_at` claim stays exactly as-is, so no double sends.
- No changes to `src/lib/b4x4/*`, V6 inference, or the parallel `runV6` scheduling in `src/lib/model7/shadow.ts`.
