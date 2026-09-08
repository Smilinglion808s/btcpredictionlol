# C85 deployment split

C85 is no longer built and served in the same place. Three components, one
contract between them:

```text
  offline bootstrap/refit job        deployment bundle          Railway worker
  (durable, resumable)        --->   (versioned, hashed)  --->  (serving only)
  historical producers +             models + state +           loads bundle,
  scheduled fits                     cutoffs + watermarks       predicts by T+5
```

Lovable's role is limited to the signed backend (persistence, bundle registry,
webhook dispatch) and a simple status view at `/c85`. No bankroll simulator, no
second betting engine.

## A. Bootstrap / refit job (`services/c85-worker/bootstrap/`)

Runs outside the interactive workspace, in its own image
(`Dockerfile.bootstrap`), with the continuation cache on a persistent volume so
a workspace reset cannot erase progress.

| Command | What it does |
| --- | --- |
| `python -m bootstrap.cli inventory` | Measured file inventory, split serving / refit / research |
| `python -m bootstrap.cli advance [--end ISO]` | Resumable historical rebuild; completed stages skipped by cursor |
| `python -m bootstrap.cli refit-status` | Which daily/monthly fits exist, which are missing |
| `python -m bootstrap.cli build --state <state.json>` | Builds `dist/c85-<version>.tar.gz` + manifest |
| `python -m bootstrap.cli publish <summary.json> [--activate]` | Signed upload, register, optionally activate |

The job holds no database credentials: it uses the same signed
`/api/public/hooks/c85-ops` endpoint as the worker.

## B. Deployment bundle

`manifest.json` + `state/checkpoint.json` + only the applicable fitted
artifacts. Every file is SHA-256 pinned; the archive hash is pinned in the
registry. The bundle carries the model cutoffs, source watermarks, rank/filter
and deterioration state, pending outcomes and the checkpoint timestamp.

Registered in `c85_deployment_bundles`; the archive lives in the private
`c85-bundles` storage bucket. Exactly one bundle per model version is `ACTIVE`.

Excluded by construction: research archives, parity fixtures, recovery source,
the continuation cache.

## C. Serving worker (`services/c85-worker/src/`)

Startup: load the ACTIVE bundle (local dir, else signed download), verify every
hash, restore the durable checkpoint or adopt the bundle state, start
collectors, advance one target at a time.

Fail-closed readiness now also covers the bundle:

* `C85_BUNDLE_MISSING` / `C85_BUNDLE_CORRUPT` / `C85_BUNDLE_SHA_MISMATCH`
* `C85_NO_ACTIVE_BUNDLE`
* `C85_BUNDLE_STALE` — active bundle older than `C85_BUNDLE_MAX_AGE_HOURS`
  (default 36). Old weights are never silently extended.

Webhook guards live in `src/dispatch.py`: the dedupe key is
`<model>:<ticker>:<target>` (unique in the transactional outbox) and the expiry
is the T+5s deadline, so a late payload is recorded MISSED instead of sent.

### Worker environment

| Variable | Purpose |
| --- | --- |
| `C85_OPS_URL`, `C85_GATEWAY_URL`, `C85_GATEWAY_SECRET` | Signed backend + decision gateway |
| `C85_BUNDLE_DIR` (default `/bundle`) | Where the bundle is unpacked; mount a volume to survive restarts |
| `C85_BUNDLE_DOWNLOAD` (default `true`) | Fetch the ACTIVE bundle when the directory is empty |
| `C85_BUNDLE_MAX_AGE_HOURS` (default `36`) | Staleness ceiling |
| `C85_ALLOW_LIVE_PUBLICATION` | Still `false` while C85 is being verified |

## Measured inventory (current tree)

| Class | Files | Size | Contents |
| --- | ---: | ---: | --- |
| Serving | 456 | 10.4 MB | feature order, fitted heads, auxiliary bundles, `src/`, lockfile, Dockerfile |
| Refit | 18 | 105.7 MB | continuation harness + its cache (ledgers, cursors, recovered feeds) |
| Research | 486 | 2.7 MB | parity fixtures, reference packet, reproduction scripts, tests |

A published bundle is far smaller than the serving class above, because it
carries only the applicable heads (8-day tail) and the current auxiliary month.

## Acceptance checks

1. Connected historical parity stays exact — reproduction tests unchanged.
2. Deployed checkpoint is current — `bundle_age_hours` on `/c85`.
3. Restart resumes without a full-history rebuild — worker startup adopts the
   checkpoint/bundle state; the continuation cache is not consulted at runtime.
4. Live predictions observed from real inputs by T+5 —
   `publication_offset_ms` / `deadline_met` on `/c85`.
5. Webhook payload verified without placing a bet — C85 stays out of
   `WEBHOOK_ALLOWED_MODELS`; T45 execution is unchanged.

## Remaining tasks and blockers

* **Missing scheduled fits** — daily direction and correctness heads stop at
  2026-08-31, auxiliary at 202608. Until the bootstrap job produces the current
  fits, no bundle should be activated. (`refit-status` lists them.)
* **Continuation stages 3-13** — C42, Polymarket, C51, C54, C57, C61, C63,
  C67/C68/C69, C71, C85 heads still need to be appended to `STAGES` and run.
  Polymarket ancestor inputs cannot be substituted with Kalshi history.
* **Expert chain** — `LiveExpertChain` stays disconnected until those stages
  produce their state; readiness reports it.
* **Railway** — deploy the serving image with a `/bundle` volume, prove
  restart-resume, then begin prediction logging at the next boundary.

C85 is not live. Its betting route stays switched off until prediction
readiness is reported.
