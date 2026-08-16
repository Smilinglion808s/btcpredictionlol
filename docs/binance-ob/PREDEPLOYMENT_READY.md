# B4x4-ES1 Binance Order-Book R1 — PREDEPLOYMENT READY

Status: **CODE COMPLETE — COLLECTOR NOT DEPLOYED, BINANCE NOT ACTIVATED**
Mode: `SHADOW_ONLY` · webhook eligibility: permanently `false` for every policy row.

## 1. What is implemented

| Requirement | State | Where |
| --- | --- | --- |
| Strict T-2s cutoff (`sample_ts`, `received_at`, `feature_cutoff_ts`) | Done | `src/lib/b4x4es1/binanceOb/timing.ts` (+ DB CHECKs) |
| Signed ingest, validation, in-batch + DB de-duplication, idempotent replay | Done | `binanceOb/ingest.ts`, `routes/api/public/hooks/binance-ob-ingest.ts` |
| 1s observation stream, 60s window, OLS slopes, sign persistence, OFI, replenishment | Done | `binanceOb/features.ts` |
| Empirical rank percentiles over exactly 96 strictly-prior valid boundaries | Done | `features.ts` (`history_valid_count` is the single canonical counter) |
| Six frozen policies, one row per target per policy incl. abstentions | Done | `binanceOb/policies.ts`, `config.ts` |
| Full runtime audit vocabulary via `api_runs` | Done | `binanceOb/audit.ts`; collector side `services/binance-ob-collector/src/runtimeEvents.js` |
| Collector heartbeat (5s), deployment identity, resync/gap/rollover counters | Done | `runtimeEvents.js` → `b4x4_es1_binance_ob_collector_health` |
| Missing-boundary watchdog writing explicit failure rows | Done | `binanceOb/watchdog.server.ts`, wired into `hooks/binance-ob-finalize` (pg_cron T+2m) |
| Dashboard: connection, capture coverage, latency p50/p90/p95, gaps, warm-up, policy table, follow-vs-fade, spot-vs-consensus | Done | `getBinanceObDashboard`, `components/binance-ob-card.tsx` |
| Dedicated combined CSV `B4x4-ES1-Binance-OB.csv` (spot + perp + 6 policies + resolution) | Done | `binanceOb/exports.ts`, `exportBinanceObCombinedCsv` |
| Compact `binance_ob_*` block appended to the main ES1 CSV | Done | `src/lib/b4x4es1.functions.ts` |
| Deterministic test suite | Done — 30/30 passing | `src/lib/b4x4es1/binanceOb/__tests__/binanceOb.test.ts` |

## 2. Test suite coverage (all synthetic, no network/DB/clock)

- Timing: cutoff-inclusive accept, T-61s reject, post-cutoff reject, receive-time-authoritative
  reject, exchange-event-after-target reject, cutoff mismatch, non-boundary target, offset
  inconsistency, mixed-batch partition with untouched timestamps.
- Features: ready boundary from a complete 59-row stream; not-ready below the minimum count;
  not-ready without the T-2s final row; percentiles withheld below 96 history rows; leaked
  post-cutoff row dropped even if it reaches the builder; OLS slope, sign persistence, sign
  changes, empirical rank.
- Policies: six rows always emitted including abstentions, fade inverts follow, inclusive band
  edges qualify, out-of-band and zero-imbalance abstain, consensus requires sign agreement,
  WIN/LOSS/PUSH scoring.
- Ingest: eligible-only storage with audited rejections, idempotent batch replay, in-batch
  de-duplication, reportable-event allowlist, health upsert.
- Watchdog: zero observations → `NO_DATA`, partial → incomplete with a failure reason.
- Collector runtime: every reportable transition is emitted by the collector's own state machine,
  counters and heartbeat interval (≤5s) land in the health row, and every emitted event name is
  accepted by the ingest allowlist.
- Export: combined join is one row per target with all six policies, missing markets/policies stay
  empty rather than fabricated, header-only file when no data exists.

## 3. ES1 before/after comparison

Executed against production data at report time:

| Metric | Value |
| --- | --- |
| ES1 predictions in table | 2210 |
| Binance observations / features / policy rows | 0 / 0 / 0 |
| ES1 rows with any `binance_ob_*` capture value | 0 |
| ES1 rows where `binance_ob_influenced_decision` is true | 0 |
| Activation mode | `SHADOW_ONLY` |

**Result: byte-identical.** No ES1 decision, direction, confidence, gate, or webhook payload
changed. The Binance layer only ever writes into its own tables plus the read-only
`binance_ob_*` annotation columns on `b4x4_es1_predictions`; nothing in the ES1 decision chain
reads them. This is enforced structurally (the annotation link runs after the ES1 decision is
finalized) rather than by convention.

## 4. Known limitation — blocked, not skipped

The always-on collector (`services/binance-ob-collector`) requires a persistent host with
Binance Global reachability. The Lovable runtime is a stateless edge worker and cannot host a
24/7 WebSocket process, so the collector has not been deployed and no live capture exists yet.
Every server-side counterpart is complete and tested against synthetic streams; the first live
boundary will exercise ingest, features, policies, watchdog and dashboard without further code
changes.

## 5. Deployment checklist (for when a host is available)

1. Set on the host: `BINANCE_OB_INGEST_URL`, `BINANCE_OB_INGEST_SECRET`,
   `BINANCE_OB_DEPLOYMENT_ID`, optionally `BINANCE_OB_BUILD_ID`.
2. Start the collector; confirm `collector-startup` + `deployment-identity` events appear in
   `api_runs` and both markets report `LIVE` on the stats card.
3. Watch the first boundary: expect 59 observations per market, `capture_status = FRESH`,
   `ready = true`, and `history_valid_count` climbing toward 96.
4. Percentiles and therefore all six policies stay abstained until 96 valid prior boundaries
   exist per market — this is expected, not a fault.
5. Keep `mode = SHADOW_ONLY`. Activation is a separate, explicit decision.
