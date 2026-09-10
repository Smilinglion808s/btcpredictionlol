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

## Duplicate-send protection — resolved in software, still not activation-ready

The three defects reported against `9c711e...` are fixed in the current source.
They were:

1. **Duplicate `PENDING` on reserve** — replaced by an exclusive atomic claim.
   Only `CLAIMED` entitles a caller to deliver; a competing caller gets
   `HELD_BY_OTHER`, `ALREADY_SENT`, `TERMINAL`, `AMBIGUOUS` or `UNAVAILABLE`
   and makes no attempt. A lapsed claim on a row that already had an attempt is
   `AMBIGUOUS` and is never re-granted.
2. **Delivery used the incoming body** — the payload is now rebuilt only from
   the committed row, re-read by the returned target id under the exact model
   identity. An altered replay body cannot change the destination signal.
3. **Unchecked retry** — the Version 1 path now makes exactly **one** automatic
   attempt per configured endpoint (`maxAttempts: 1`): no background resend for
   any response, timeout, exception or cancellation. Legacy callers keep their
   backoff behaviour. Immediately before that attempt, claim ownership is read
   first and then the kill switch, allow-list and original (never extended)
   ceiling are evaluated with nothing awaited in between; ownership errors fail
   closed. The terminal write is conditional on owner AND `PENDING`, and its
   affected rows are inspected before the version-scoped target row is amended.

What this is and is not: one exclusive dispatch operation per event identity,
and at most one attempt per configured endpoint. It is **not** a claim of a
single global signal when several endpoints are configured, and **not**
exactly-once broker execution — the bot must honour `dedupe_key` itself.

Still not activation-ready: both human controls remain absent/false, nothing is
deployed, and the claim RPC migration is **prepared but not applied** in
`supabase/prepared/20260910_litea_outbox_exclusive_claim.sql`. Until it is
applied the claim returns `UNAVAILABLE` and nothing is ever delivered. The SQL
was exercised on a disposable local PostgreSQL 17.9 instance (create/compete/
re-entrant/lapsed/terminal outcomes plus two genuinely concurrent sessions on
one key returning `CLAIMED` + `HELD_BY_OTHER`); it has NOT been run against
production.

Also unresolved / unknown: the destination bot's fill, fee, order-ID and P&L
capabilities are unknown; bid/ask/depth are unavailable. Measured publication
sits at roughly 5.7–6.1s after the target opens.


## Standing constraints observed by this release

No deployment, no publication, no production or shared-state writes, no second
writer (Railway remains sole writer), no local live worker, no real-money webhook
enabled and no test against any real destination. T45 Price Flow webhooks remain
off with scoring running. Execution controls remain off by default and unwired.
