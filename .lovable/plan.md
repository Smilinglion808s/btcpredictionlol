# Fix: NO CLEAR EDGE predictions are being rejected, and route them to PUSH

## Root cause

For the 21:45 UTC candle (your 4:45), the cron ran and OpenAI returned a valid response (`call: "NO CLEAR EDGE"`, `confidence: "2/5"`). The insert into `predictions` then failed because of an old CHECK constraint:

```
predictions_prediction_check: prediction IN ('YES','NO')   ← rejects 'NO CLEAR EDGE'
```

The error was swallowed as `[object Object]` in `api_runs`, so it wasn't obvious.

## Fix

1. **DB constraint (already applied via migration just now):** allow `prediction` to be `YES`, `NO`, or `NO CLEAR EDGE`.

2. **`src/lib/prediction.server.ts`** — when the model returns `NO CLEAR EDGE`, write the row with `status = 'push'` instead of `'skip'`. Push is already in the status constraint and is already counted in `prediction_stats()` under the `pushes` bucket, so it shows up on the Stats page without any schema/RPC changes. The existing `push` win-rate exclusion in `prediction_stats` still applies (wins/losses denominator), so abstains will not pollute win rate.

3. **Error logging hygiene** — in the same file, the catch block currently stringifies the Postgres error object as `[object Object]`. Capture `error.message` (and stash full detail in `response_payload`) so future inserts that fail are debuggable from `api_runs` directly.

## UI

`src/routes/_authenticated/index.tsx` already treats `prediction === "NO CLEAR EDGE"` as abstain (the "NO CLEAR EDGE · model abstained" badge in the Current/Upcoming cards and Last 5 Trades). The only tweak: change the `status === "skip"` fallback check to `status === "push" && prediction === "NO CLEAR EDGE"` so historical abstains keep rendering as abstains, while genuine pushes (open == close on YES/NO) still render as a normal push.

## Verification

Next time the model returns NO CLEAR EDGE the row lands in `predictions` with `status='push'`, the Current/Upcoming cards show "NO CLEAR EDGE · model abstained", Last 5 Trades shows it as an abstain, and Stats counts it under Pushes without changing the overall win rate.
