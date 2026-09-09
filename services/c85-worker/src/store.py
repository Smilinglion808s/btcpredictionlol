"""Durable persistence for the C85 worker, over the signed backend endpoint.

The worker no longer holds SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Database
credentials stay inside Lovable Cloud; this module speaks only the enumerated
C85 operations (`src/lib/c85/ops.server.ts`).

Persistence semantics are unchanged:

* one logical row per (model_version, ticker, target), abstains included,
* nanoseconds as 64-bit values and nullable numerics as JSON null — never 0,
  never NaN,
* monotonic hashed checkpoints that never overwrite an earlier one,
* settlements consumed exactly once,
* decision + checkpoint advancement + outbox committed in ONE backend
  transaction, so an interrupted commit cannot leave inconsistent state.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any

from .backend import BackendClient, BackendError
from .reconstruction import identity as reconstruction_identity
from .reconstruction import logging_model_version
from .engine import Decision
from .state import C85State


def _num(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _iso(dt: datetime | None) -> str | None:
    return None if dt is None else dt.astimezone(timezone.utc).isoformat()


def target_row(decision: Decision, *, published_at: str | None = None) -> dict[str, Any]:
    """The exact c85_targets column payload for one decision.

    `published_at` is written ONLY by the caller that has a gateway acceptance
    in hand. A decision that was computed and durably logged but not accepted
    (suppressed, expired, dispatch failed) is never stamped as published.
    """
    open_utc = decision.target_open.astimezone(timezone.utc)
    timing = decision.timing
    row: dict[str, Any] = {
        "model_version": logging_model_version(),
        "ticker": decision.ticker,
        "target_open_utc": open_utc.isoformat(),
        "deadline_utc": (open_utc + timedelta(seconds=5)).isoformat(),
        "run_mode": decision.run_mode,
        "status": decision.status,
        "status_reason": decision.status_reason,

        "binance_complete": decision.validity.get("binance_complete"),
        "anchor_valid": decision.validity.get("anchor_valid"),
        "cm_valid": decision.validity.get("cm_valid"),
        "auxiliary_valid": decision.validity.get("auxiliary_valid"),
        "source_ok": decision.validity.get("source_ok"),
        "core_valid": decision.validity.get("core_valid"),
        "structure_valid": decision.validity.get("structure_valid"),
        "market_q1": decision.validity.get("market_q1"),
        "probability_yes": _num(decision.probability_yes),
        "proposal": decision.proposal,
        "probability_correct": _num(decision.probability_correct),
        "aux_long_logit": _num(decision.features.get("LONG_logit")),
        "aux_long_logscale": _num(decision.features.get("LONG_logscale")),
        "aux_recent_logit": _num(decision.features.get("RECENT_logit")),
        "aux_recent_logscale": _num(decision.features.get("RECENT_logscale")),
        "admission_rank": _num(decision.admission_rank),
        "admission_rank_count": decision.admission_rank_count,
        "filter_rank": _num(decision.filter_rank),
        "filter_rank_count": decision.filter_rank_count,
        "core_side": decision.core_side,
        "extension": decision.extension,
        "last_yes_price": _num(decision.last_yes_price),
        "base_side": decision.base_side,
        "weak": decision.weak,
        "deterioration_ewma16": _num(decision.deterioration.get("ewma16")),
        "deterioration_ewma128": _num(decision.deterioration.get("ewma128")),
        "deterioration_settled_count": decision.deterioration.get("count"),
        "deterioration_warmup": decision.deterioration.get("warm"),
        "final_side": decision.final_side,
        "gate_reasons": decision.gate_reasons,
        "consumed_state_cutoff_ns": decision.deterioration.get("latest_available_ns"),
        "direction_fit_id": decision.fits.get("direction_fit_id"),
        "meta_fit_id": decision.fits.get("meta_fit_id"),
        "aux_fit_month": decision.fits.get("aux_fit_month"),
        "feature_order_sha256": decision.fits.get("feature_order_sha256"),
        "features": decision.features or None,
        "source_ids": timing.get("source_ids"),
        "source_hash": timing.get("source_hash"),
        "target_open_ns": timing.get("target_open_ns"),
        "packet_freeze_ns": timing.get("packet_freeze_ns"),
        "last_event_ns": timing.get("last_event_ns"),
        "last_receipt_ns": timing.get("last_receipt_ns"),
        "feed_watermarks": {
            **(timing.get("feed_watermarks") or {}),
            "reconstruction": reconstruction_identity(),
        },
        "compute_started_ns": timing.get("compute_started_ns"),
        "compute_complete_ns": timing.get("compute_complete_ns"),
        "decision_durable_ns": timing.get("decision_durable_ns"),
        "dispatch_ns": timing.get("dispatch_ns"),
        "publication_offset_ms": _num(timing.get("publication_offset_ms")),
        "deadline_met": timing.get("deadline_met"),
    }
    if published_at is not None:
        row["published_at"] = published_at
    return row



class C85Store:
    """Same interface the worker always used; the transport is now the endpoint."""

    def __init__(self, backend: BackendClient, worker_id: str) -> None:
        self.backend = backend
        self.worker_id = worker_id
        self._last_seq: int = 0
        self._lease_fence: int | None = None


    # -- checkpoints -----------------------------------------------------------
    def latest_checkpoint(self) -> dict[str, Any] | None:
        row = self.backend.call("checkpoint.latest").get("checkpoint")
        if row:
            self._last_seq = int(row.get("checkpoint_seq") or 0)
        return row

    def bootstrap(self) -> dict[str, Any]:
        """Checkpoint, applicable fits, pending settlements and recent base calls."""
        data = self.backend.call("state.bootstrap")
        cp = data.get("checkpoint")
        if cp:
            self._last_seq = int(cp.get("checkpoint_seq") or 0)
        return data

    def checkpoint_payload(self, state: C85State, stage: str) -> dict[str, Any]:
        """Serialize a checkpoint whose hash covers exactly what is persisted.

        The reconstruction identity is a SIBLING field, deliberately not merged
        into `expert_state`: `state_sha256` hashes the state, and `from_dict`
        reads `expert_state` straight back, so injecting identity there made a
        restored state hash differently from the checkpoint it came from.
        """
        payload = state.to_dict()
        return {
            "model_version": logging_model_version(),
            "reconstruction": reconstruction_identity(),
            "as_of_utc": datetime.now(timezone.utc).isoformat(),
            "last_processed_target_utc": state.last_processed_target_utc,
            "next_target_utc": state.next_target_utc,
            "stage": stage,
            "admission_rank_state": payload["admission_rank_state"],
            "filter_rank_state": payload["filter_rank_state"],
            "deterioration_state": payload["deterioration_state"],
            "pending_base_calls": list(state.deterioration.pending.keys()),
            "consumed_settlements": state.deterioration.consumed[-5000:],
            "expert_state": state.expert_state or {},
            "applicable_fits": state.applicable_fits,
            "source_watermarks": state.source_watermarks,
            "state_sha256": state.sha256(),
            "expected_parent_seq": self._last_seq,
        }


    def save_checkpoint(self, state: C85State, stage: str) -> int:
        """Append a monotonic, hashed checkpoint. Never overwrites an earlier one."""
        res = self.backend.call("checkpoint.append", checkpoint=self.checkpoint_payload(state, stage))
        seq = int((res.get("checkpoint") or {}).get("checkpoint_seq") or 0)
        state.checkpoint_seq = seq
        self._last_seq = seq
        return seq

    def restore_state(self) -> tuple[C85State, dict[str, Any] | None]:
        row = self.latest_checkpoint()
        if row is None:
            return C85State(), None
        return C85State.from_dict(row), row

    # -- scheduler ownership ---------------------------------------------------
    def acquire_lease(self, ttl_seconds: int = 60, lease_key: str = "c85:boundary") -> dict[str, Any]:
        """Only the lease owner may process a target; overlapping deploys stand down."""
        try:
            res = self.backend.call("lease.acquire", lease_key=lease_key, ttl_seconds=ttl_seconds)
        except BackendError as exc:
            if exc.status == 409:
                return {"granted": False, "reason": "held_by_other_worker"}
            raise
        return res.get("lease", {"granted": False})

    def verify_lease(self, ttl_seconds: int = 60, lease_key: str = "c85:boundary") -> dict[str, Any]:
        """Re-assert ownership immediately before a commit.

        LIMITATION, stated rather than hidden: `c85_commit_decision` takes no
        lease token and performs no fence check (see the migration body), so the
        backend cannot reject a write from a superseded worker. The strongest
        available guard is this fresh round-trip — `c85_acquire_lease` renews for
        the same owner and hands the lease to a different owner with a strictly
        higher fence — checked against the fence this worker last held. A
        competing worker therefore invalidates us before we write, but the race
        window between this call and the commit is NOT closed by the database.
        """
        lease = self.acquire_lease(ttl_seconds=ttl_seconds, lease_key=lease_key)
        owner = lease.get("owner_id")
        fence = lease.get("fence")
        held = self._lease_fence
        ok = bool(lease.get("granted")) and owner == self.worker_id and (
            held is None or (fence is not None and int(fence) == int(held))
        )
        if ok and fence is not None:
            self._lease_fence = int(fence)
        return {"ok": ok, "lease": lease, "held_fence": held}

    def note_lease(self, lease: dict[str, Any]) -> None:
        fence = lease.get("fence")
        if lease.get("granted") and fence is not None:
            self._lease_fence = int(fence)

    # -- sequence handling -----------------------------------------------------
    def _adopt_sequence(self, response: Any, state: C85State | None, *, required: bool) -> int | None:
        """Adopt the checkpoint sequence the backend actually assigned.

        `c85_append_checkpoint` validates `expected_parent_seq` against the
        stored head and raises on mismatch, so a sequence that is written but
        not adopted here makes the NEXT write fail with a stale parent. Every
        successful write that carried a checkpoint must land its sequence in
        both `self._last_seq` and the in-memory state.
        """
        if not isinstance(response, dict) or response.get("ok") is False:
            raise BackendError(0, f"C85_MALFORMED_COMMIT_RESPONSE: {response!r}")
        checkpoint = response.get("checkpoint")
        seq_raw = (checkpoint or {}).get("checkpoint_seq") if isinstance(checkpoint, dict) else None
        if seq_raw is None:
            if required:
                raise BackendError(
                    0, "C85_MISSING_CHECKPOINT_SEQ: checkpoint was sent but no sequence returned"
                )
            return None
        seq = int(seq_raw)
        if seq <= 0:
            raise BackendError(0, f"C85_INVALID_CHECKPOINT_SEQ: {seq_raw!r}")
        self._last_seq = seq
        if state is not None:
            state.checkpoint_seq = seq
        return seq

    @property
    def last_seq(self) -> int:
        return self._last_seq

    # -- targets ---------------------------------------------------------------
    def commit_decision(
        self,
        decision: Decision,
        *,
        published_at: str | None = None,
        state: C85State | None = None,
        stage: str = "READY",
        outbox: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Atomic: decision row + checkpoint advancement + outbox, or nothing.

        `outbox` must match the signed contract in src/lib/c85/ops.server.ts:
        {dedupe_key, payload, expires_at}. Anything else is rejected by Zod.
        """
        res = self.backend.call(
            "decision.commit",
            target=target_row(decision, published_at=published_at),
            checkpoint=None if state is None else self.checkpoint_payload(state, stage),
            outbox=outbox,
        )
        self._adopt_sequence(res, state, required=state is not None)
        return res

    def commit_dispatch_result(
        self,
        decision: Decision,
        *,
        published_at: str | None,
    ) -> dict[str, Any]:
        """Second, prediction-preserving write recording the dispatch outcome.

        The immutability trigger (`c85_targets_guard_immutable`) blocks changes
        to final_side / probabilities / features / identity on a published live
        row and allows exactly this: timing, status and published_at. No new ops
        contract is invented — this is the same `decision.commit` op.
        """
        res = self.backend.call(
            "decision.commit",
            target=target_row(decision, published_at=published_at),
            checkpoint=None,
            outbox=None,
        )
        self._adopt_sequence(res, None, required=False)
        return res


    def committed_identity(self) -> dict[str, Any] | None:
        """Read back the durable checkpoint to resolve an ambiguous commit."""
        return self.latest_checkpoint()

    def upsert_target(self, decision: Decision, *, published_at: str | None = None) -> dict[str, Any]:
        res = self.commit_decision(decision, published_at=published_at)
        return {"id": res.get("target_id")}


    def mark_missed(self, ticker: str, target_open: datetime, reason: str) -> None:
        """An expired target becomes an explicit row and never a catch-up webhook."""
        self.backend.call(
            "target.missed",
            ticker=ticker,
            target_open_utc=_iso(target_open),
            reason=reason,
        )

    # -- settlements -----------------------------------------------------------
    def record_settlement(self, **kwargs: Any) -> None:
        self.backend.call("settlements.record", settlements=[kwargs])

    def unconsumed_settlements(self, since: datetime | None = None) -> list[dict[str, Any]]:
        res = self.backend.call("settlements.pending", since=_iso(since))
        return res.get("settlements", [])

    def consume_settlements(
        self, settlement_ids: list[str], state: C85State | None = None, stage: str = "READY"
    ) -> dict[str, Any]:
        """Exactly-once: already-consumed ids are not returned a second time."""
        res = self.backend.call(
            "settlements.consume",
            settlement_ids=settlement_ids,
            checkpoint=None if state is None else self.checkpoint_payload(state, stage),
        )
        self._adopt_sequence(res, state, required=state is not None)
        return res


    # -- fits ------------------------------------------------------------------
    def save_fit(self, **fields: Any) -> dict[str, Any]:
        return self.backend.call("fits.save", **fields)

    def applicable_fits(self, as_of: datetime | None = None) -> list[dict[str, Any]]:
        return self.backend.call("fits.applicable", as_of_utc=_iso(as_of)).get("fits", [])

    # -- outbox ----------------------------------------------------------------
    def enqueue_outbox(self, target_id: str, dedupe_key: str, payload: dict[str, Any],
                       expires_at: datetime) -> dict[str, Any] | None:
        """Outbox rows are only ever written together with their decision."""
        raise RuntimeError(
            "C85_OUTBOX_IS_TRANSACTIONAL: pass outbox=... to commit_decision so the "
            "decision, the state advance and the outbox row share one transaction."
        )

    # -- health ----------------------------------------------------------------
    def heartbeat(self, **fields: Any) -> None:
        self.backend.call("health.heartbeat", **fields)
