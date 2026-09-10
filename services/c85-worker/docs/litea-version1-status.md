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
| Code commit | see "Code identity" below |
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


## Code identity (reconciled)

The three SHAs in circulation are all real and none contradict each other:

| SHA | What it is |
| --- | --- |
| `22f4aede8c1543ae52f29c4ca9a5c9e80ce76271` | worker state at the end of the lifecycle/catch-up pass |
| `7500e2b3d927be310c9ef5f88e55d1126e9912df` | repository head when this document was first written, one commit later |
| `629779c81c147d5f5c9c315cbba6a779f9ded86c` | repository head after the Version 1 tile pass (frontend + read-only stats query only) |

No fit was re-run for any of these. The tile pass touched no worker code, no
engine, no guard, no thresholds.

## Release manifest — worker-only Railway deploy (after review)

Start command: `python -m src.litea.main` (working directory
`services/c85-worker`). Nothing else runs in that service.

Environment it needs:

| Key | Purpose |
| --- | --- |
| `C85_GATEWAY_URL` | signed gateway endpoint, `https://<host>/api/public/hooks/c85` |
| `C85_OPS_URL` | signed ops endpoint, `https://<host>/api/public/hooks/c85-ops`; derived from `C85_GATEWAY_URL` when unset |
| `C85_GATEWAY_SECRET` | HMAC key for those endpoints (already stored, never in an image) |
| `C85_WORKER_ID` | heartbeat identity for this instance (default `c85-worker-1`) |
| `C85_MODEL_VERSION` | `lite-a-floor4-top10-r1` |
| `C85_BUILD_SHA` | optional; reported in the heartbeat and matched against `LITEA_REQUIRED_BUILD_SHA` on the site when that is set |

Verified against `src/config.py::load_settings` at this commit: the worker reads
`C85_OPS_URL` / `C85_WORKER_ID`. There is no `LITEA_OPS_URL` or `WORKER_ID` in
the code; the earlier table was wrong. `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` must NOT be set — startup fails closed if they are.

No Supabase URL, anon key or service-role key is given to the worker: every
read and write goes through the signed endpoint, and every artifact goes
through a short-lived signed URL for the private `c85-artifacts` bucket.
Execution stays off structurally — the endpoint refuses an outbox entry under
this model version regardless of what the worker sends.

Serving state it restores at startup (verified by readback):

| Item | Value |
| --- | --- |
| Latest head cutoff | `2026-09-10T00:00:00+00:00`, valid until `2026-09-11T00:00:00+00:00` |
| Latest head SHA-256 | `7c489fd38e7c68488b519fbbde0d762f69eac0ddb56a34789cb7ffb5a6816a67` |
| Eligible training rows in that fit | 7,774 (`2026-06-10T19:45Z` … `2026-09-09T23:30Z`) |
| Training file SHA-256 | `cd6a8267183e8ba7ff6e77770e2437e404459bf91d9ec49c5dfc0de5cfe9525e` |
| Paired state SHA-256 | `70c39cfb092bc39dc6f64f5ff467c047efa3761a098dc7fecfcc620fab9214ad` (envelope digest `6e26bb0d…`) |
| State cursor — last scored target | `2026-09-10T01:30:00+00:00` |

Bucket keys (private, signed access only), under
`datasets/lite-a-floor4-top10-r1/`: `manifest.json`,
`checkpoints/state.json`, `training/training.parquet`,
`training/september_frame.parquet`, `training/september_decisions.csv`,
`training/catchup_summary.json`, `heads/2026-08-31.json` …
`heads/2026-09-10.json`, plus `reference/` (the two audited research archives,
never read at startup).

## Frontend release scope — Version 1 tile

Changed files: `src/components/litea-card.tsx` (new),
`src/lib/litea.functions.ts` (new), `src/lib/litea/statsQuery.server.ts` (new),
`src/routes/_authenticated/stats.tsx` (three lines: import, query, render).
No other card, model or service was touched.

Built client output inspected directly (`dist/client`, 13 files, 888 KB), not
inferred from the absence of a `public/` directory. Searched the emitted
bundles for `c85-artifacts`, `SUPABASE_SERVICE_ROLE`, `C85_GATEWAY_SECRET`,
`training.parquet`, `lite_a_engine`, `/mnt/documents`, `statsQuery.server` and
the model version string: **no match for any of them**. Two matches were
examined and are benign: the literal `sb_secret_` is a key-prefix test inside
the Supabase SDK, and the only JWT present decodes to `role: anon` — the
publishable key that is expected in client code. No model coefficients,
feature values, bucket keys or research rows reach the browser; the tile
receives only counts, statuses and timestamps from the server function.

Signed-ops restrictions re-confirmed unchanged: exact-body HMAC, timestamp
freshness, single-use nonce, write allowlist, and a hard dispatch prohibition
for `lite-a-floor4-top10-r1`.

## Remaining hookup action (one item)

Deploy the worker service with the start command and environment above, once
the publication review is resolved. On its first scheduled boundary the tile
moves itself from "Preparing" to "Waiting for live data" (heartbeat seen) and
then to "Live shadow" (a scheduled LIVE decision inside the last 40 minutes).
Nothing in the frontend can force that badge.
