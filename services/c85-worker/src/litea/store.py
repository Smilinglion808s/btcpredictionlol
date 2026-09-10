"""Durable, signed, suppressed decision logging for Version 1.

Every row is written under the version-scoped identity `lite-a-floor4-top10-r1`
through the SAME signed backend the C85 worker uses. Version 1 holds no
database credentials, and because all C85 tables are keyed on `model_version`
it can never touch a `c85-multi-meta-r1` or `c85-reconstruction-r1` row.

Two things are deliberately NOT done here:

* no outbox entry is ever enqueued — Version 1 has no execution path at all, so
  there is nothing to dispatch and nothing that could reach a betting webhook;
* the C85 meta/auxiliary/ancestor columns are left NULL, never zero-filled. A
  null there means "this model does not have that quantity", which is true.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timedelta, timezone
from typing import Any

from ..features import DIRECTION_ORDER
from .identity import MODEL_ID

FEATURE_ORDER_SHA256 = hashlib.sha256(
    json.dumps(list(DIRECTION_ORDER), separators=(",", ":")).encode()
).hexdigest()


def _num(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def target_row(
    *,
    target_open: datetime,
    ticker: str,
    engine_output: dict[str, Any],
    guard_output: dict[str, Any] | None,
    packet: Any,
    timing: dict[str, Any],
) -> dict[str, Any]:
    """The exact `c85_targets` payload for one Version 1 decision."""
    open_utc = target_open.astimezone(timezone.utc)
    reasons = [engine_output.get("reason")]
    if guard_output:
        reasons.append(guard_output.get("reason"))
    reasons = [r for r in reasons if r]

    final_side = int(guard_output["prediction"]) if guard_output else 0
    status = (guard_output or engine_output).get("reason") or "UNKNOWN"

    return {
        "model_version": MODEL_ID,
        "ticker": ticker,
        "target_open_utc": open_utc.isoformat(),
        "deadline_utc": (open_utc + timedelta(seconds=5)).isoformat(),
        "run_mode": "LIVE",
        "status": status,
        "status_reason": " -> ".join(reasons) or None,

        # Version 1 sourcing validity. The C85-specific validity flags
        # (cm_valid, auxiliary_valid, structure_valid, source_ok, market_q1)
        # belong to a model this one does not run, and stay NULL.
        "binance_complete": bool(packet.input_valid),
        "anchor_valid": bool(packet.features.get("anchor_valid", packet.input_valid)),

        "probability_yes": _num(engine_output.get("p_yes")),
        "core_side": int(engine_output.get("direction") or 0),
        "base_side": int(engine_output.get("candidate") or 0),
        "final_side": final_side,
        "admission_rank": _num(engine_output.get("rank")),
        "admission_rank_count": engine_output.get("rank_count"),
        "gate_reasons": reasons,

        "feature_order_sha256": FEATURE_ORDER_SHA256,
        "features": {
            "direction60": packet.as_engine_features(),
            "lite_a": engine_output,
            "daily_floor": guard_output,
            "input_valid": bool(packet.input_valid),
            "blockers": packet.blockers or None,
            "model_id": MODEL_ID,
            "execution_enabled": False,
        },

        "target_open_ns": str(timing.get("target_open_ns")),
        "packet_freeze_ns": _str(timing.get("packet_freeze_ns")),
        "last_receipt_ns": _str(timing.get("last_receipt_ns")),
        "compute_started_ns": _str(timing.get("compute_started_ns")),
        "compute_complete_ns": _str(timing.get("compute_complete_ns")),
        "publication_offset_ms": _num(timing.get("publication_offset_ms")),
        "deadline_met": timing.get("deadline_met"),
        "feed_watermarks": packet.source.get("feed_watermarks"),
    }


def _str(value: Any) -> str | None:
    return None if value is None else str(value)


class LiteAStore:
    """Narrow persistence surface for Version 1 over the signed backend."""

    def __init__(self, backend: Any, worker_id: str) -> None:
        # A single client bound to this model identity. The backend refuses any
        # nested payload whose model_version disagrees with the envelope, so a
        # Version 1 row cannot land under a C85 identity by accident.
        self.backend = backend
        self.worker_id = worker_id

    # -- reads -----------------------------------------------------------------
    def latest_checkpoint(self) -> dict[str, Any] | None:
        return self.backend.call("checkpoint.latest").get("checkpoint")

    def pending_settlements(self) -> list[dict[str, Any]]:
        return self.backend.call("settlements.pending").get("settlements") or []

    # -- writes ----------------------------------------------------------------
    def commit(
        self, row: dict[str, Any], checkpoint: dict[str, Any] | None
    ) -> dict[str, Any]:
        """One transaction: the decision row and the paired checkpoint.

        `outbox` is omitted, permanently. Version 1 never dispatches.
        """
        return self.backend.call("decision.commit", target=row, checkpoint=checkpoint)

    def mark_missed(self, ticker: str, target: datetime, reason: str) -> None:
        self.backend.call(
            "target.missed",
            ticker=ticker,
            target_open_utc=target.astimezone(timezone.utc).isoformat(),
            reason=reason[:500],
        )

    def heartbeat(self, **payload: Any) -> None:
        self.backend.call("health.heartbeat", **payload)

    def acquire_lease(self, ttl_seconds: int) -> dict[str, Any]:
        return self.backend.call(
            "lease.acquire", lease_key=f"{MODEL_ID}:boundary", ttl_seconds=ttl_seconds
        ).get("lease", {})


def checkpoint_payload(state: Any, *, next_target: datetime | None) -> dict[str, Any]:
    """The paired Version 1 state, in the backend checkpoint shape.

    `expert_state` carries the ORIGINAL paired envelope verbatim — both member
    snapshots, every cursor and the pair digest that sealed them. Restoring from
    a checkpoint therefore re-verifies the digest that was actually written
    instead of manufacturing a fresh one over reassembled parts.
    """
    envelope = state.snapshot()
    cursors = state.cursors.as_dict()
    return {
        "model_version": MODEL_ID,
        "as_of_utc": datetime.now(timezone.utc).isoformat(),
        "last_processed_target_utc": state.engine.last_target,
        "next_target_utc": None if next_target is None else next_target.isoformat(),
        "stage": "LOGGING",
        # The engine's rank queues ARE the admission state for this model.
        "admission_rank_state": envelope["state"]["engine"],
        # The daily floor is the only risk owner.
        "deterioration_state": envelope["state"]["guard"],
        "pending_base_calls": state.guard.pending,
        "consumed_settlements": cursors["consumed_settlements"],
        "applicable_fits": {
            "last_fit_cutoff": cursors["last_fit_cutoff"],
            "last_fit_result": cursors["last_fit_result"],
            "training_sha256": cursors["training_sha256"],
            "training_rows": cursors["training_rows"],
            "training_last_target": cursors["training_last_target"],
        },
        "source_watermarks": cursors["source_watermarks"],
        "state_sha256": envelope["sha256"],
    }
