# Plan: Pre-Warm B4.2 Inputs Before Boundary

## Goal
Reduce time between candle close and B4.2 webhook emission by caching everything that's already knowable **before** the target candle closes. No model, feature, or timing-rule changes. B4.2 still scores strictly after boundary.

## What gets pre-warmed (all safe — none depend on the target candle)
1. **Prior candle history** (last ~40 rows) used by B2 + B4.2 featurizers
2. **Active Model 7 Variant B fit** (coefficients, scaler, feature order)
3. **B4.2 day state row** from `model7_b4_2_state` (edge score, cooldown)
4. **Recent B4.2 NO-history** rows (last 2, for Extreme-NO guard)

None of these change in the final 10 seconds of a candle. Loading them early is equivalent to loading them at boundary+1.5s.

## Architecture

### New in-memory warm cache (`src/lib/model7/warmCache.ts`)
- Module-level `Map<targetBoundaryIso, WarmedInputs>` with 60s TTL
- `warmForBoundary(targetIso)` — fetches all 4 inputs in parallel, stores by target boundary key
- `consumeWarmed(targetIso)` — returns cached inputs and deletes the entry
- Fail-open: if cache miss or expired, B4.2 falls back to fetching live (current behavior)

### New pre-warm hook (`src/routes/api/public/hooks/prewarm-b4_2.ts`)
- POST endpoint, no body params
- Computes the next 15m boundary
- Calls `warmForBoundary(nextBoundaryIso)`
- Returns `{ warmed: true, target: <iso>, ms_before_boundary: <n> }`
- Wrapped in try/catch — always returns 200 so a failed pre-warm never breaks the schedule

### pg_cron schedule
- New job `prewarm-b4-2` at `*/15 * * * *` offset by 50 seconds past the minute
- Runs at HH:00:50, HH:15:50, HH:30:50, HH:45:50 — i.e. **~10s before** each boundary at HH:01:00, HH:16:00, etc.
- Note: pg_cron minimum granularity is 1 minute, so we schedule at minute :14, :29, :44, :59 and rely on the SQL body running near-instantly (typical <200ms). Actual pre-warm lands ~55–58s into that minute → 2–5s before boundary. If we need earlier, we schedule at minute :13/:28/:43/:58 for ~60s lead.

### Integration in `src/lib/model7/shadow.ts`
- At the top of the B2 → B4.2 path (after `waitUntilScoreable` returns), check `consumeWarmed(targetIso)`
- If present: use cached history, fit, state, NO-history instead of re-fetching
- If absent: fall back to existing fetch code (no regression)

## Expected impact
- Eliminates 3–4 sequential Supabase round-trips from the critical path
- Typical savings: **300–700ms** per candle (depends on DB latency)
- Zero risk of leakage — pre-warmed data is strictly older than target boundary
- Zero risk of "predicting before close" — scoring still gated by `waitUntilScoreable`

## Rollout safety
- Cache is in-memory per-worker; on cold start or worker recycle, we fall back to live fetch — same behavior as today
- If the pre-warm hook errors, B4.2 runs unchanged
- Add a `warm_cache_hit` boolean column to the `model7_shadow` insert for B4.2 rows so we can measure hit rate and latency delta in the audit

## Files touched
- New: `src/lib/model7/warmCache.ts`
- New: `src/routes/api/public/hooks/prewarm-b4_2.ts`
- Modified: `src/lib/model7/shadow.ts` (consume warm cache in B2/B4.2 path)
- Migration: add `warm_cache_hit boolean` to `model7_shadow`
- pg_cron insert (via supabase insert tool, not migration): schedule prewarm job at minute :14/:29/:44/:59

## Verification after build
1. Confirm cron job appears in `cron.job`
2. Watch `api_runs` / server logs for pre-warm hits vs misses
3. Compare `boundary_delta_ms` on B4.2 rows before/after (should shrink by ~300–700ms once cache warms)
4. Confirm `warm_cache_hit = true` on the majority of new B4.2 rows
