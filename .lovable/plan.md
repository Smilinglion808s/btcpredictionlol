# C85 rebuild after the workspace wipe

## What was lost, and why

Nothing you uploaded is gone, and no code is gone. What disappeared is the large *working scratch area* the rebuild used: unpacked archives, downloaded Binance/Kalshi history, the intermediate feature files, and the stage progress checkpoints.

That folder (`evaluation-fixtures/cache/`) is deliberately excluded from the saved project because it holds several gigabytes of derived data. It lives on the temporary sandbox disk, which the platform clears periodically. It was cleared mid-run, before the last stage results could be written anywhere durable.

Confirmed still present:
- All original uploaded archives (recovery kits, upstream packages, model kit).
- All rebuild code, including the archived-prefix splice fix that resolved the 65 midnight mismatches.
- The model artifacts shipped with the worker.

So this is lost *time*, not lost work product.

## How long a rebuild takes

Roughly 3-5 hours of machine time, mostly unattended downloading and feature building:

| Step | Time |
|---|---|
| Unpack recovery archives, restore workspace | ~15 min |
| Download Binance context + cross-asset + 1s daily archives (~250 MB, checksum-verified) | ~60-90 min |
| Build long-context features (capped at 2 workers to avoid the crash seen before) | ~45-60 min |
| Build technical-expansion feature matrix (~159 MB) | ~30-45 min |
| Run the stage graph in dependency order to the frozen end | ~45 min |
| Advance stages to the current quarter-hour, verify parity | ~30 min |

## Preventing a third loss

1. After each stage completes, copy its checkpoint JSON and a small stage manifest (row counts, cursor, hashes) into the tracked repository, so progress survives any wipe.
2. Persist the fitted artifacts and checkpoints to the Railway worker's own storage as soon as the bootstrap finishes, rather than at the very end.
3. Re-download only what is missing on restart — the setup script is already idempotent, so a wipe costs download time, not correctness.

## Plan

1. Re-run the workspace restore from the uploaded archives.
2. Re-download the market archives, verifying checksums.
3. Rebuild the two heavy feature matrices with the capped worker settings.
4. Run the stage graph to the frozen end and confirm the archived-prefix splice gives zero structure-validation mismatches.
5. Advance every stage to the current quarter-hour and report exact cursors, row counts and any genuine data gaps (kept visible, never filled in).
6. Checkpoint progress into the repository as each stage lands.
7. Push fitted artifacts and checkpoint to Railway, verify restart-resume, then begin prediction logging at the next valid boundary.

Throughout: T45 execution stays untouched, and C85 stays excluded from live betting until verification passes.

## Technical notes

- Durable progress record: per-stage manifest files under `services/c85-worker/continuation/manifests/`, tracked in the repo (small JSON only, no data).
- The `_splice_archived_prefix` fix in `continuation/stages.py` remains in place; the archived ledger it needs is recreated by the workspace restore from `C85_Ancestor_Recovery.zip`.
- Long-context feature build stays capped at 2 processes; higher counts reproduced `BrokenProcessPool`.
