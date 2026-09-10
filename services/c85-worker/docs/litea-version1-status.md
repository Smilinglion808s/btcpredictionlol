# Version 1 — `lite-a-floor4-top10-r1` service status

Execution is HARD OFF: no outbox row is written under this identity, and the
gateway rejects one if it were. T45 is untouched. Nothing here is published to
a public URL.

## What changed in this pass (service lifecycle)

1. **Recording no longer depends on scoring.** `LiteAWorker.scoring_readiness()`
   is now separate from `evaluate_readiness()`, which returns `RECORDING_ONLY`
   when a head is expired or a feed is stale. The heartbeat arms the scheduler
   for `RECORDING_ONLY` too. Previously an expired head stopped the scheduler,
   which stopped the UTC-midnight row from being recorded, which meant the next
   daily head could never be fitted — a permanent silent stall.
2. **Undelivered decisions are a queue, not a single blocking slot.**
   `pending/<target>.json` per target; `reconcile_pending()` drains them in
   target order and is also driven by a new 30-second `recovery_loop()` off the
   boundary path. A transport failure no longer suppresses later targets, and
   the committed cursor only moves forward.
3. **Restore picks the newest coherent position.** The bucket snapshot is staged
   as `state.remote.json` and never overwrites the live file. Startup compares
   local snapshot, bucket snapshot and the signed backend checkpoint envelope,
   and adopts the latest committed target. A checkpoint that predates the
   sealed paired envelope is refused, not reassembled.
4. **Absent and broken are different.** `RemoteArtifacts._get(required=True)`
   raises on an unreachable backend, missing signed URL, download error or 5xx;
   only a genuinely absent manifest returns empty. Reads are sent with
   `cache-control: no-cache` after a stale CDN copy of a just-replaced object
   was observed during verification.
5. **Settlements trigger a due fit** instead of waiting up to five minutes.

## Current position (measured)

| Item | Value |
| --- | --- |
| Code commit | `7500e2b3d927be310c9ef5f88e55d1126e9912df` |
| Latest scored target | `2026-09-10T01:30:00+00:00` |
| Latest head cutoff | `2026-09-10` (valid until `2026-09-11T00:00Z`) |
| Heads present | 11 (`2026-08-31` … `2026-09-10`) |
| Training rows | 20,358 (`2026-02-06T23:00Z` … `2026-09-10T01:30Z`) |
| Training file SHA-256 | `cd6a8267183e8ba7ff6e77770e2437e404459bf91d9ec49c5dfc0de5cfe9525e` |
| Paired state SHA-256 | `6e26bb0dfd8f3bdf52808f3a48b725bcc9967be9218c2ac088033bc9f3bb5198` |
| Decisions in catch-up | 871 — `CONFIDENCE_ABSTAIN` 625, `MODEL_CALL` 237, `INPUT_UNAVAILABLE` 9 |
| Floor outcomes | `ORDINARY_CALL` 228, `DAILY_FLOOR_ABSTAIN` 6, `HIGH_CONFIDENCE_EXCEPTION` 3 |
| Feature coverage | Sep 1 – Sep 10 01:30: 871 targets, 862 input-valid and labelled |

Sep 9 and Sep 10 have no Binance **daily archive** yet (HTTP 404 on every
required dataset). Those two days were built from the same venue's public REST
endpoints — the identical exchange data read from the live API instead of the
archive mirror. It is still a post-hoc reconstruction, so the rows are RESEARCH,
never a live capture; `litea_september_frame.py` only takes the REST path when
`_archive_available()` says the archive is absent.

## Durability evidence

All 16 objects were uploaded through short-lived signed URLs and then read BACK
and hash-compared (`tools/litea_publish.py`); every digest matched. A blank
directory restored 13 objects from the bucket and came up with the correct
state (`last_target 2026-09-10T01:30Z`), 20,358 training rows and a head that
validly scores the next boundary — i.e. a fresh container resumes today, not
from a day-old snapshot.

## Release scope (evidence only — publication is NOT requested here)

- Route that would need deploying: `src/routes/api/public/hooks/c85-ops.ts`
  (plus its helper `src/lib/c85/ops.server.ts`). It verifies an HMAC over the
  exact request bytes with a timestamp freshness window, burns a single-use
  nonce, restricts writes to `C85_WRITABLE_MODEL_VERSIONS`, and forbids any
  outbox entry for `lite-a-floor4-top10-r1`.
- Storage stays private: `c85-artifacts` is only reachable through per-object
  signed URLs minted by that authenticated route.
- Client/public surface inspected: there is no `public/` directory, and the only
  client-reachable file naming this model is `src/lib/c85/config.ts`, which
  contains identity strings and display names — no keys, no research data, no
  bucket paths. Model artifacts are never imported into client code.
- Start command: `python -m src.litea.main`.

## Exact remaining blocker

The service has never been run against a **live, pre-armed boundary**: every
row so far is reconstructed after the target. Proving live operation requires
the worker process running continuously against the deployed signed endpoint.
The deployed endpoint is currently stale (the preview URL answers 401 and the
published one predates these ops), and updating it is a publication action that
is explicitly on hold. Until that is resolved, Version 1 remains
shadow/reconstruction only.
