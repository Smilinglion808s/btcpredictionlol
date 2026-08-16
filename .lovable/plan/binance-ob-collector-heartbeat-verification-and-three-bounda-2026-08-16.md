# Binance OB collector: heartbeat verification and three-boundary capture

## Current state (verified just now)

Both markets are healthy after the region switch:

| Market | Status | region_blocked | error | reconnects | book synced | seq ok | heartbeat age |
|---|---|---|---|---|---|---|---|
| SPOT | READY | false | none | 0 | yes | yes | ~4s |
| USD_M_PERP | READY | false | none | 0 | yes | yes | ~4s |

New deployment id `9900c060daad-1`. The 451 region block is gone.

Two things still need to clear before the capture run can be called a pass:

- Observations so far: 58 rows, all `USD_M_PERP`, sampled 08:14:03–08:14:57 (the pre-boundary window for the 08:15 boundary). Zero `SPOT` rows have ever landed.
- `b4x4_es1_binance_ob_boundary_features` is empty (0 rows).

Most likely explanation: the SPOT local book finished syncing after that window had already started, so only the perp collector produced samples for the 08:15 boundary. Both books report initialized now, so the 08:30 boundary should carry both markets. This is a hypothesis, not a confirmed fact — step 1 below is to confirm or refute it before proceeding.

## Plan

1. **Boundary 1 (08:30) — confirm dual-market capture.** After the boundary, check that observations exist for both SPOT and USD_M_PERP, that sample offsets are contiguous integer seconds with no gaps, that every `sample_ts` and `received_at` is at or before T-2s (no target-candle leakage), and that a boundary_features row was produced. If SPOT is still absent, stop the checklist and diagnose the ingest path (validation rejects vs. collector never sampling) instead of continuing.
2. **Boundary 2 (08:45) — repeat the same checks** plus sequence integrity (`sequence_gap_count`, `resync_count`, `snapshot_sync_count` stable) and confirm the six frozen policies evaluate against real features.
3. **Boundary 3 (09:00) — repeat**, then confirm three consecutive clean boundaries with no reconnects, no region blocks, and no leakage.
4. **Write `docs/binance-ob/PRODUCTION_CAPTURE_VERIFICATION.md`** with per-boundary evidence tables, row counts, offset coverage, latency stats, sequence counters, and a final PASS/FAIL.

Binance stays SHADOW_ONLY for the whole run. No ES1 decision logic, webhook routing, or model config is touched; this is verification plus one documentation file.

## Technical detail

Checks are read-only SQL against `b4x4_es1_binance_ob_collector_health`, `b4x4_es1_binance_ob_observations`, `b4x4_es1_binance_ob_boundary_features`, and `b4x4_es1_binance_ob_policy_shadows`. The only write is the markdown verification report. Each boundary is 15 minutes apart, so the full run needs roughly 45 minutes of wall clock and will span several messages — I check after each boundary and report.
