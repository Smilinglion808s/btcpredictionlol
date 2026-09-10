# Version 1 — shadow latency release: what is ready, what is not

Scope: `lite-a-floor4-top10-r1`, worker only. Model coefficients, the 60 features,
the full `[T, T+5s)` window, head/rank thresholds, the guard, the free-fallback
strike provenance and official-only outcome grading are all unchanged by this
release. Nothing here enables execution.

## Ready for review as a shadow-only worker performance patch

- **Pre-boundary preparation.** The undelivered-queue drain and the sole-writer
  lease acquisition now happen at the existing prepare lead, in a worker thread,
  before the target opens — not between the scheduler's `T+5s` wake and the
  packet freeze. Isolated overhead comparison: 756.7ms → 503.8ms, i.e. ~253ms
  removed per simulated 250ms backend round trip. Nothing about the model moves
  earlier; no feed is read and no packet is frozen during preparation.
- **Ownership is proven before the pair is touched.** The lease is validated,
  and if necessary renewed, *before* any engine or guard mutation. A denial, an
  expired lease, or a grant with no parsable expiry all abandon the boundary
  with the paired state hash unchanged, nothing queued, and no row written over
  the real owner's interval.
- **One critical section per decision.** The engine's rank advance, the guard's
  reservation, the observation timestamp, the watermark cursor, the local paired
  save and the checkpoint payload happen under a single lock hold. The decision's
  observation is captured inside that section, after any settlement that got in
  first, so a concurrent settlement cannot advance the pair clock past it.
- **No network call under the lock.** Durable commits, the pending drain and the
  amending write all run outside it, so a slow backend cannot stall settlements,
  the heartbeat snapshot or the next interval. Heartbeat and checkpoint I/O run
  off the collector event loop.
- **Fits run on an immutable copy.** The frame is snapshotted coherently and
  fitted outside the lock. The fit's input identity is recorded in its own
  cursors (`fit_input_*`); the live `training_*` cursors keep describing the
  frame actually on disk, which is what a restart verifies against.
- **Private timing diagnostics** ride inside the existing private payload of each
  durable record — no new public column, nothing user-visible.

Test evidence: 27/27 in `tests/test_litea_boundary_latency.py`; 136 passed across
the Version 1 suites, plus one pre-existing unrelated strike-policy failure
(`test_non_finite_value_is_left_to_the_fitted_imputation`) that this release does
not touch.

## NOT ready — do not treat as activation-ready

The dispatch path delivered under `9c711e...` remains default-OFF and unwired,
and these defects are unresolved:

1. **Duplicate `PENDING` on reserve.** `dispatch.reserve` returns `PENDING` for a
   duplicate, and both callers can then proceed to deliver. This is not a
   single-delivery guarantee.
2. **Delivery uses the incoming body.** The ops path passes `body.target` rather
   than re-reading the persisted row after the idempotent commit, so what is sent
   is not provably what was durably recorded.
3. **Unchecked retry.** The retry loop in `deliverWebhookNow` does not re-check
   the Version 1 switch or the transport deadline before the POST, so a retry can
   fire after the control has been turned off.

Also unresolved / unknown: the destination bot's fill, fee, order-ID and P&L
capabilities are unknown; bid/ask/depth are unavailable. Measured publication
sits at roughly 5.7–6.1s after the target opens.

## Standing constraints observed by this release

No deployment, no publication, no production or shared-state writes, no second
writer (Railway remains sole writer), no local live worker, no real-money webhook
enabled and no test against any real destination. T45 Price Flow webhooks remain
off with scoring running. Execution controls remain off by default and unwired.
