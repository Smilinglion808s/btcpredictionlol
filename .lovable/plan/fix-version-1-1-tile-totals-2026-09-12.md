# Fix Version 1.1 tile totals

## Changes
- Replace the tile’s custom sign-in check with the app’s standard authenticated server-function guard so valid signed-in requests receive real Version 1.1 totals instead of the empty fallback.
- Make an authentication failure display as a load error rather than believable zero statistics.
- Keep the existing 5-second server cache, 10-second refresh, model calculations, webhook controls, and delivery behavior unchanged.

## Verification
- Confirm the returned aggregate matches current records: 11 live calls, 7 wins, 3 losses, and 1 pending at the time of diagnosis.
- Verify the stats page renders those nonzero values and recent confirmed-send indicators.
- Check focused tests and the latest preview build result.

## Technical details
- Update only the Version 1.1 stats server-function wrapper and its page query handling.
- No database writes, webhook sends, control changes, or model changes.
