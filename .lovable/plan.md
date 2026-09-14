# V1.1 send timing — read-only diagnosis and the smallest fix

Diagnosis run on HEAD `28a7e65620ae202e18dc836d24e9b49d7967fb3b` (unchanged). No code, flags, endpoints, DB rows or webhooks were touched.

## What the real timestamps show

Every `prediction.created` delivery in the last 3 days (62 rows, all HTTP 200). `attempt_start_offset_ms` is the moment the HTTP request actually started, measured from candle open — not a "built at" time.

| Leg | Sends | Earliest | Average | Latest |
|---|---|---|---|---|
| V1 (early leg) | 40 | 5.97 s | 6.37 s | 7.62 s |
| T45R2 (fallback leg) | 18 | 49.48 s | 50.03 s | 50.61 s |

**There is no 20-second send.** Zero deliveries in the whole 3-day window started between 9 s and 45 s. The early leg is already going out ~0.6 s after the decision is committed.

Per-interval trace of a typical candle:

```text
T+5.10s  model decision published by the worker (publication_offset_ms)
T+5.50s  immutable V1 row committed (c85_targets.created_at)
T+6.10s  HTTP request starts   <-- V1 leg on the wire
T+7.10s  200 back from the destination

T+45.15s last finalized one-second bar received
T+45.33s that bar persisted
T+45.62s signed collector trigger reaches the hook
T+48.6s  V1.1 observation committed (v11_decisions.created_at)
T+49.9s  HTTP request starts   <-- T45R2 leg on the wire
T+50.9s  200 back
```

## Where the remaining delay actually is

The only avoidable time is on the T45R2 leg, and it is ~4.3 s, not 20 s:

- **~3.0 s between trigger and commit** — `observeV11Target` in `src/lib/v11/observer.server.ts` (`observeV11TargetOnce`, lines ~141-200) performs seven independent database round-trips strictly one after another: `decisionExists`, `readState`, `readMissingPredecessors`, `readLiveContext`, `upsertContextRow`, `readT45InputsFromSamples`, `readV1Snapshot`. None of the first six depend on each other's results.
- **~1.3 s between commit and the wire** — `dispatchV11FallbackForObservation` → `dispatchV11FallbackFromCommit` → `dispatchV11Fallback` in `src/lib/v11/dispatch.server.ts` (lines 463, 752, 814) re-reads the committed row, then the source V1 row, then the claim, then the endpoint, again sequentially.

Everything else already behaves correctly and needs no change:

- `src/routes/api/public/hooks/t45-boundary-run.ts` already starts V1.1 first and attaches dispatch to the observer's own continuation (`hookPipeline.ts`), so the legacy T45 legs never delay it.
- There is no T+20 watchdog, no polling loop and no batching on the send path.
- The V1 leg (`src/lib/c85/ops.server.ts` lines ~360-445 → `dispatchLiteaDecision`) already sends inside the same signed request that commits the decision.

The T45R2 leg cannot fire before T+45 by construction: its R2 inputs are the 0-44 s one-second bars of the candle it is predicting. That part of the 45 s is the model, not latency.

## Proposed fix (smallest change that helps)

1. **`src/lib/v11/observer.server.ts`** — issue the six independent pre-commit reads as one `Promise.all` batch instead of six awaits in series, keeping the exact same values, the same order of use, the same failure handling (a failed `readV1Snapshot` still yields the ambiguous, non-eligible snapshot), and the same commit-time clock capture. Expected saving ~1.5-2.5 s.
2. **`src/lib/v11/dispatch.server.ts`** — fetch the committed V1.1 row, the source V1 row and the destination endpoint in parallel before the claim, rather than serially. The claim itself stays exactly where it is, still last, still the single ownership gate. Expected saving ~0.5-0.8 s.

Net effect: T45R2 goes on the wire around T+46.5-47.5 s instead of T+50 s. The V1 leg is untouched at ~T+6.

## Explicitly unchanged

Model math and input windows for both legs, the T+45 R2 cutoff, the 60 s publication ceiling, payload format and field names, the single destination, source/eligibility checks, all gates, one-send-per-interval claim protection, and the original V1 path. `Remaining_Fixes.patch` is not reapplied.

## Verification after the change

Run the V1.1 test suites, then compare `attempt_start_offset_ms` for the next several T45R2 sends against the 49.5-50.6 s baseline above. No replays, no synthetic sends.
