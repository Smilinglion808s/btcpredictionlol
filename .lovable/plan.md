Shift the prediction trigger from 60s before candle close to 30s before.

## Changes

1. **Update pg_cron schedule** for the predict phase:
   - Current: fires at `:14, :29, :44, :59` (1 minute before each 15m boundary)
   - New: fires at `:14:30, :29:30, :44:30, :59:30` (30 seconds before)
   - Since `pg_cron` only supports minute-level precision natively, use `cron.schedule('...30 seconds')` syntax (pg_cron 1.5+ supports sub-minute) OR run at `:14, :29, :44, :59` and add a 30-second `pg_sleep(30)` before the `net.http_post` call.

2. **No server code changes required** — `runAiPredictionServer` already snaps `targetCandleTs` via `Math.ceil` to the next 15m boundary, so it will correctly target the upcoming candle regardless of firing at T-60s or T-30s.

3. **Resolve cron stays unchanged** (still fires at `:03/:18/:33/:48` after candle close).

## Trade-off note
Firing 30s before (vs 60s) gives the model 30 more seconds of the in-progress candle's price action to react to, but leaves less buffer if OpenAI is slow. Typical response is 3–8s so 30s is safe.