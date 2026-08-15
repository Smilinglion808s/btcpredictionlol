# Timing confirmation + finish the ES1 boundary fix

## Answer

Yes — same answer. Right now it is 10:52 PM local (04:52 UTC). The next candle is
11:00–11:15 PM local (05:00–05:15 UTC), and that is exactly what ES1 is designed to
publish at the 11:00 boundary: it uses the just-closed 10:45–11:00 candle to predict
11:00–11:15.

## But it is not doing that in production yet

Verified just now:

- The boundary cron job (`es1-boundary-run`, fires at :00/:15/:30/:45) is active and
  runs on schedule.
- Its HTTP calls are still coming back **404** — the newest response at 04:45:05 is the
  site's HTML 404 page, not the endpoint.
- Cause: the boundary route exists in the code but the published site has not been
  rebuilt since it was added, so the live URL does not have it.
- Consequence: ES1 rows are still being written by the older mid-candle path
  (e.g. the 04:30 target row was created at 04:46), which is the 15-minutes-off
  behavior you have been seeing, and no webhook is being sent.

## Steps

1. Publish the app so `/api/public/hooks/es1-boundary-run` exists on the live site.
2. Watch the next two boundaries (05:00 and 05:15 UTC) and confirm the cron response
   is `200` with `target_candle_ts` equal to the boundary that just opened.
3. Confirm the resulting prediction row carries `target_is_upcoming = true` and that
   the webhook fires within the first ~60 seconds of the candle.
4. If any boundary still misses, report the exact response body rather than adding
   more retry layers.

No model logic, thresholds, or frozen artifacts change here — this is purely getting
the already-written boundary route live and verifying it.
