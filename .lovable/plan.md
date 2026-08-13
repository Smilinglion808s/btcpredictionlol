# Stability hardening + page cleanup

## 1. Remove the Home and Settings pages

- Delete `src/routes/_authenticated/index.tsx` (Home dashboard) and `src/routes/_authenticated/settings.model.tsx` (Model Settings).
- Add a new index route that immediately redirects `/` to `/stats`, so the app opens on Stats.
- Remove the "Home" and "Settings" links from the top nav in `src/routes/__root.tsx`; make the logo link to `/stats`.

Note: model settings (including auto-run) stay stored in the database and keep driving predictions — only the editing screen goes away. If you ever need to change them, it can be done directly in the backend.

Removing Home also removes its live candle polling and realtime subscriptions, which were part of the read load.

## 2. Additional fixes to prevent the freeze/outage

The outage was caused by the database being saturated by repeated heavy stats reads, which then blocked the prediction writes. Layered protections:

1. **Server-side cache for stats reads.** Cache each stats aggregate in memory for 30-60s per server instance, so N viewers hitting the page produce one database query instead of N. This is the single biggest win.
2. **Query timeouts + graceful degradation.** Give the stats server functions a short statement timeout and return the last cached values with a "stale" flag instead of erroring, so a slow database never cascades into hanging requests.
3. **Single-flight guard.** Prevent duplicate concurrent executions of the same stats query; late callers await the in-flight one.
4. **Pause polling when the tab is hidden or the window is unfocused**, and back off automatically after a failure (exponential backoff up to ~5 minutes) instead of hammering at a fixed interval.
5. **Isolate the prediction path.** Predictions/webhooks get their own client with a short timeout and retry, so read pressure can never starve a write. Log a clear error whenever a boundary run is skipped.
6. **Catch-up watchdog.** On each scheduled run, detect any missed 15m boundary in the last hour and backfill it automatically, so a transient outage self-heals instead of leaving gaps.
7. **Cheaper aggregates.** Where stats still scan large tables, precompute rollups (daily win/loss counts) so cards read a tiny summary rather than aggregating full history each time.

## Technical notes

- Redirect route: `src/routes/_authenticated/index.tsx` replaced with a `beforeLoad` that throws `redirect({ to: "/stats" })`.
- Caching/single-flight lives in a shared server-side helper wrapped around the existing stats server functions; model logic and stored data are untouched.
- No changes to any model rules, thresholds, or webhook behaviour.
