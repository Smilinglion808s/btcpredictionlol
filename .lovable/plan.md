# Version 1.1 watchdog race — fix already applied, evidence confirmed

No further code work is proposed. The collector evidence you supplied matches the fix that is already in the working tree, and it needs no change.

## What the evidence confirms

- Railway collector deployment `9d077777-ad8f-43a1-9b45-be849cba9f47` (service `a2410abe-6bc1-4a18-8ce5-799e940bae65`) is unchanged and SUCCESS.
- Collector log: `[t45] boundary trigger 2026-09-12T03:30:00.000Z -> 200` at `03:30:49.400Z`.
- Worker request log independently shows the signed production POST at `03:30:45.659Z`.
- The unsigned watchdog (fired `03:30:04.537Z`, waited to T+45.25) committed the V11 row at `03:30:45.753Z`, ahead of the signed trigger. So the primary trigger did arrive successfully; it simply lost the race, which is exactly the mislabelling cause reported.

## The fix in place (hook only, no strategy/math/guard change)

- `src/lib/v11/hookGate.ts` — pure gate: inside the 60s publication ceiling only the signed collector may run the V11 observer; unsigned/watchdog calls skip the observer entirely. At or after 60s, unsigned calls may recover still-unobserved targets truthfully as RECOVERY. Already-recorded rows are never promoted and signatures are never faked.
- `src/routes/api/public/hooks/t45-boundary-run.ts` — consults the gate; the signed path stays immediate and awaited with all existing timing, data and claim checks. Legacy T45 logic unchanged.
- `src/lib/v11/__tests__/hookGate.test.ts` — 6 focused tests: unsigned T+45.25 leaves the target unclaimed, signed T+45.753 records LIVE_SHADOW, post-60s recovery still works when the collector is absent, recorded RECOVERY is never promoted.

## Status

- V11 suite 103/103, typecheck clean, build OK.
- Source SHA `c5d25b213b80950e7225773e2a4fc8ff0e6fe58d`.
- Nothing published, no bets or webhooks sent, no collector or credential changes.

Approve to close this out as-is; root can publish and observe the next natural 03:45 boundary.
