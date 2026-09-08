# C85 live-computation status — corrections and boundary wiring

Written 2026-09-08 (UTC). Supersedes the corresponding claims in
`docs/c85-recovery-status.md`. No historical rebuild was run, no site was
published, C85 betting stays suppressed and T45 execution is untouched.

## 1. Corrections to the serving audit

### 1.1 There is no live leaf producer (open blocker)

`src/experts/leaf.py::LeafExperts.evaluate` **passes through already-computed
upstream fields**. Its own docstring states it: all nine leaf outputs raise
`MissingUpstreamSignalError` "unless the caller has independently supplied the
already-computed upstream field in `packet`". `directional_matrix` and the
fitted live inference for those outputs are explicitly not implemented there.

Search for an alternate live implementation, by file:

| Candidate | Verdict |
|---|---|
| `src/experts/leaf.py` | pass-through only; fails closed. No live producer. |
| `src/experts/c42.py`, `c51.py`, `c54.py` | consume leaf outputs; they cannot originate them. |
| `src/features.py` | builds the C85 direction/meta frames from market data; it does **not** produce the nine ancestor leaf outputs. |
| `reproduction/repro_*.py`, `continuation/stages.py` | offline historical producers over archives; batch, not a boundary-path producer. |

Conclusion: **`REPRODUCED` status for a historical stage does not establish a
live producer.** Live raw-feature production is an **open live-computation
blocker**, tracked as the sole reason `UnavailablePacketSource` is wired into
the boundary path.

### 1.2 "No checkpoint ever written" — scoped, then verified

The earlier statement was based only on the files present in the sandbox. It has
now been checked against the backend itself:

```
c85_state_checkpoints   0 rows   (max checkpoint_seq: null)
c85_targets             0 rows
c85_settlements         0 rows
c85_outbox              0 rows
c85_worker_health       2 rows
```

So the claim is now backed by the durable store, not by a directory listing.
`c85_worker_health` also shows a **live Railway worker heartbeating**:

| worker_id | readiness | blocking_reason | updated |
|---|---|---|---|
| `c85-worker-amsterdam-1` | BLOCKED | `C85_FEEDS_STALE: binance_spot, binance_um, binance_cm, binance_usdc, binance_index, binance_1m, kalshi` | 2026-09-08 23:17Z |
| `probe` | WARMING | `C85_PIPELINE_INCOMPLETE` | 2026-09-07 03:58Z |

The deployed worker reaches the backend and is blocked before any feed is fresh.

### 1.3 Auxiliary retention: LONG is expanding, not 90 days, not Dec-1-2025

From the original producer `src/c85/auxiliary_source.py::run`:

```python
tr = valid & (avail < month.value) & np.isin(y, [-1, 1]) & np.isfinite(target)
if window == 'RECENT': tr &= ts >= (month - pd.Timedelta(days=90)).value
```

* **LONG** has *no lower time bound*: it trains on **every eligible row in the
  supplied dataset** whose proxy label was available before the fit month. Its
  minimum retention is therefore "all prior eligible rows the original training
  dataset contained", whose earliest row is a property of that dataset — not a
  universal 2025-12-01 start, and never truncated to 90 days.
* **RECENT** is the only 90-day window.
* Fit cadence: monthly, `pd.date_range('2025-03-01', end-1d, freq='MS')`, with a
  5,000-row minimum per fit.
* C51/C71/C85 daily heads keep the trailing `TRAIN_WINDOW_ROWS = 8640`
  (`src/config.py`), minimum 672 rows.

Practical rule: keep the full minute-level training dataset durably, outside
serving memory; the serving process only needs the fitted bundles plus the
bounded live buffers.

## 2. Boundary path: implemented

`src/orchestration.py` (`BoundaryOrchestrator.run_target`) is the shared
one-target path, used identically by the live scheduler and by chronological
historical replays. `Worker.on_boundary` now delegates to it; the
`C85_PIPELINE_INCOMPLETE` raise is gone.

Order of one pass:

1. duplicate/retry suppression against `last_processed_target_utc` (state is
   mutated exactly once per target; the backend row is idempotent on its key);
2. ticker resolution **verified against market metadata** (`src/tickers.py`);
3. raw packet from the injected `PacketSource` — the production default is
   `UnavailablePacketSource`, which fails closed and names the missing producer;
4. settlement intake, consumed only strictly before the original decision
   instant inside `engine.evaluate`;
5. the unchanged chain: direction → validity → meta+aux → admission rank →
   confirmed extension → deterioration → filter rank → final keep;
6. publication-deadline re-check, then decision row + checkpoint + outbox in one
   `decision.commit` transaction, then dispatch.

Deliberately **not** on this path: fitting, catch-up bridging, history rebuild.

### Clocks (taken from existing configuration, not redefined)

| Clock | Value | Source |
|---|---|---|
| input cutoff (packet freeze) | `T + (PUBLICATION_DEADLINE_MS - COMPUTE_BUDGET_MS)` = T+3800 ms | `src/config.py`, already used by `scheduler.BoundaryScheduler` |
| computation budget | `COMPUTE_BUDGET_MS` = 1200 ms | `src/config.py` |
| publication/receipt deadline | `T + PUBLICATION_DEADLINE_MS` = T+5000 ms | `src/config.py` |
| settlement consumption cutoff | original decision instant, T+5 s | `engine.evaluate` |

Missing the publication deadline records `EXPIRED` with the measured overrun and
dispatches nothing. Nothing is back-dated and no deadline is extended.

### Ticker semantics

`Worker._ticker_for` formatted the stamp from the target instant while claiming
it was the close. That ambiguity is removed rather than guessed: `src/tickers.py`
forms **both** candidate stamps and accepts one only if the venue reports a
market whose window is exactly `[target_open, target_open + 15m)`. An
unlisted interval fails closed as `C85_TICKER_UNRESOLVED`; because
`target.missed` requires a ticker string (`src/lib/c85/ops.server.ts`), the row
carries an `UNVERIFIED-…` label that cannot be mistaken for a listed contract.

### Startup audit

`Worker.run` computed the bridge plan and then ignored it. Now the plan is
retained and readiness refuses to arm the scheduler while it is non-empty
(`C85_BRIDGE_PENDING: n targets from … to …`), and a boundary whose UTC day has
no fitted direction/meta head is blocked with `C85_NO_APPLICABLE_FIT` instead of
reaching for stale weights. `UnavailablePacketSource` is itself a readiness
blocker, so a deployment can never be READY without a live producer.

## 3. Storage direction

* research/derived data → the verified durable recovery cache
  (`/mnt/documents/.lovable/c85-cache`), reached through the now-safe
  `reproduction/link_durable_cache.sh`;
* code → git;
* immutable serving artifacts (heads, aux bundles, C51 states, feature order) →
  packaged with the image, hash-verified by `ArtifactStore`;
* runtime state → the existing checkpoint backend
  (`c85_state_checkpoints` via the signed ops endpoint), which is already the
  worker's restart-resume mechanism and needs no new resource.

**Access gap:** this sandbox has no Railway API token or project configuration
(`/dev-server` contains no `railway.json`/`railway.toml` and no Railway
credentials), so Railway service settings and volume state could not be
inspected directly. The only observable Railway evidence is the heartbeat above.
No paid resource was provisioned.

## 4. Next smallest implementation step

Implement `LivePacketSource.build` for the **direction head only**, from the
already-running Binance collectors via `src/features.py`, and assert it against
an archived boundary row. That is the first slice of the raw-input live parity
that today's supplied-feature tests deliberately do not cover.
