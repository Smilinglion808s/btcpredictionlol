# Cut network and storage use

## What's using the most
- 9 scheduled jobs still run, several for models you already retired (T45, B4x4, Model 7 / Model C audits, Binance order-book capture). The T45 watchdog runs **every minute** (1,440 calls a day). Each one calls the site and writes rows.
- About 1.5 GB of stored data, mostly from retired models:
  - B4x4 order-book observations/snapshots: ~400 MB
  - C85 checkpoints: 221 MB, plus 39 MB of old one-time request codes
  - Scheduled-job run log: 125 MB
  - Run log (`api_runs`): 78 MB
  - T30 / T45 / T10 / Model 7 / V6 retired history: ~600 MB
- The dashboard polls the V1.2 status every 1s and full stats every 10s.

## Changes
1. **Stop retired jobs**: t45-boundary-watchdog, t45-resolve-backlog, b4x4-ob-shadow-capture, binance-ob-finalize, prewarm-b4-2, model7-nightly-audit, modelc-nightly-audit. Keep btc15m-predict and btc15m-resolve (V1).
2. **Clear logs that are safe to wipe**: scheduled-job run log, `api_runs` (keep last 7 days), expired C85 request codes, B4x4 raw order-book observations and snapshots.
3. **Retired model history** (T30, T45, T10, Model 7, V6, C85 checkpoints): export each one to a CSV file in your Files, then delete it from the database. `predictions` and `predictions_archive` are **never touched**.
4. **Add auto-cleanup**: one daily job that keeps the job log and `api_runs` to 7 days.
5. **Slow the dashboard**: V1.2 status polls every 3s while waiting (not 1s), 15s once settled, and stops when the tab is hidden. Full stats every 60s instead of 10s.
6. After cleanup, reclaim the disk space and report before/after sizes.

## Not touched
V1 prediction/resolve, V1.2 sender and adapter, betting receivers, Railway, live gate, `predictions` history.

## Technical details
- `cron.unschedule(...)` for each retired job; `delete from cron.job_run_details`; `VACUUM (FULL)` on the affected tables where allowed.
- Before dropping each retired table's rows, check `rg` in src/ for live readers; tiles for retired models get removed from the stats page with their server reads.
