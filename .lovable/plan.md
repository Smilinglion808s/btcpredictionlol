# V3 Kalshi grading — production verification (read-only)

## What was verified (21:47 UTC)
- Published site https://btcpredictionlol.lovable.app/stats returned HTTP 200.
- The live stats bundle `assets/stats-BBPbq498.js` (loaded from the live `index-C7bhOXzV.js`) contains "Finalized Kalshi outcomes", "Kalshi grading unavailable" and `GRADING_UNAVAILABLE`. The old wording "confirmed 15-minute candles" is not in any live bundle checked.
- Cache table: 137 final, 3 not final (Oct 8 07:00Z, 07:45Z, 08:45Z — HTTP_404, attempts=2, last tried 21:44:29Z, which is after the 21:43Z backfill). That shows a dashboard refresh ran the new server code against the shared backend. Preview and production share this backend, so this can't prove which one ran it.
- Current tally: 142 recorded calls → 94W / 43L / 5 pending (3 unavailable markets, 21:30Z just closed, 21:45Z still open). The fixed Oct 11 pre-21:30Z cohort stays 8W/4L; 21:30Z and 21:45Z are separate and still ungraded.

## Not verifiable here
- No tool here reads the status of deployment cd860632. Live files show the new frontend was served, not that this specific deployment finished.
- The server side of getV3Live in production wasn't called directly: the stats page is behind sign-in and calling the server function needs a session. Only an authenticated production load can confirm what production returns at runtime.

## Optional next step (needs approval; still read-only)
- Load the published /stats signed in, using a minted session in a headless browser. Check that the V3 tile shows "Finalized Kalshi outcomes" with totals matching 94W/43L (or later). Confirm a production-triggered `last_attempt_at` update for the 21:30Z market in the cache.
- No code, model, worker, betting, secret or setting changes.
