"""Incremental C85 policy state.

The recovered reference implements the rank queues and the deterioration filter
as a batch pass over the whole history. A live worker must produce byte-identical
decisions one target at a time and survive restarts, so this module re-expresses
exactly the same recurrences as an online, serialisable state machine.

The semantics below are transcribed from `c85/original_policy.py`
(`directional_rank`, `rank_stream`, `run`) and must not be "improved":

* Two independent rank families, each with side-specific queues of the latest
  768 finite scores. Family 1 ranks the correctness probability by the direction
  proposal; family 2 ranks confidence in the final base side.
* Midrank excludes the current score, then appends it. Ranks are only produced
  once at least 96 prior scores exist on that side; otherwise NaN.
* The deterioration stream is pooled over every nonzero counterfactual base call
  (core plus extension, before the final filter), including base calls whose
  structure is invalid. Settlements are consumed exactly once, only when the
  settlement instant is strictly before the decision time T+5s, in stable
  settlement order.
* EWMAs start at 0.60 with alpha = 2/(span+1). Before 128 settled base calls the
  warmup gate passes. Thereafter a call is weak when
  EWMA16 < 1/1.8 and EWMA128 - EWMA16 >= 0.08.

`to_dict`/`from_dict` are the durable checkpoint format. Replaying the same
inputs over a restored checkpoint must reproduce the same state, which
`tests/test_state_parity.py` asserts against the kit fixtures.
"""
from __future__ import annotations

import hashlib
import json
import math
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Deque

from .config import (
    DETERIORATION_GAP,
    DETERIORATION_INIT,
    DETERIORATION_MINIMUM,
    DETERIORATION_ODDS,
    DETERIORATION_SPANS,
    RANK_HISTORY,
    RANK_MINIMUM,
)


def _is_finite(x: float | None) -> bool:
    return x is not None and isinstance(x, (int, float)) and math.isfinite(x)


class RankFamily:
    """Side-specific 768-score midrank queues (one of the two rank families)."""

    def __init__(self, history: int = RANK_HISTORY, minimum: int = RANK_MINIMUM) -> None:
        self.history = history
        self.minimum = minimum
        self.queues: dict[int, Deque[float]] = {
            1: deque(maxlen=history),
            -1: deque(maxlen=history),
        }

    def observe(self, score: float | None, side: int, eligible: bool = True) -> tuple[float | None, int]:
        """Return (midrank, prior_count) for `score` on `side`, then record it.

        `eligible` mirrors the source's per-family guard: family 1 skips rows
        whose side is 0 or whose score is not finite; family 2 additionally skips
        rows whose structure is invalid, and counts a row (count only) even when
        the score is not finite.
        """
        side = int(side)
        if side not in (-1, 1) or not eligible:
            return None, 0
        queue = self.queues[side]
        count = len(queue)
        rank: float | None = None
        if _is_finite(score):
            if count >= self.minimum:
                below = sum(1 for v in queue if v < score)
                equal = sum(1 for v in queue if v == score)
                rank = (below + 0.5 * equal) / count
            queue.append(float(score))
        return rank, count

    def to_dict(self) -> dict[str, Any]:
        return {"history": self.history, "minimum": self.minimum,
                "yes": list(self.queues[1]), "no": list(self.queues[-1])}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "RankFamily":
        obj = cls(int(data.get("history", RANK_HISTORY)), int(data.get("minimum", RANK_MINIMUM)))
        obj.queues[1] = deque([float(v) for v in data.get("yes", [])], maxlen=obj.history)
        obj.queues[-1] = deque([float(v) for v in data.get("no", [])], maxlen=obj.history)
        return obj


@dataclass
class DeteriorationState:
    """Pooled DUAL_SPEED deterioration stream over counterfactual base calls."""

    count: int = 0
    ewma: dict[int, float] = field(
        default_factory=lambda: {n: DETERIORATION_INIT for n in DETERIORATION_SPANS}
    )
    last_settlement_ns: int = -1
    # Base calls awaiting an official settlement: identity -> record.
    pending: dict[str, dict[str, Any]] = field(default_factory=dict)
    # Settlement identities already folded in; guarantees exactly-once learning.
    consumed: list[str] = field(default_factory=list)

    def register_base_call(self, identity: str, side: int, decision_ns: int) -> None:
        """Record a nonzero counterfactual base call (before the final filter)."""
        if int(side) == 0:
            return
        if identity in self.consumed or identity in self.pending:
            return
        self.pending[identity] = {"side": int(side), "decision_ns": int(decision_ns)}

    def consume_settlements(self, decision_ns: int) -> int:
        """Fold in every pending settlement strictly before `decision_ns`.

        Ordering is stable by (settlement_ns, identity), matching the source's
        stable sort on settlement time.
        """
        ready = [
            (rec["settlement_ns"], identity)
            for identity, rec in self.pending.items()
            if rec.get("settlement_ns") is not None
            and int(rec["settlement_ns"]) < int(decision_ns)
            and rec.get("label") in (-1, 1)
        ]
        ready.sort()
        for settlement_ns, identity in ready:
            rec = self.pending.pop(identity)
            won = 1 if int(rec["side"]) == int(rec["label"]) else 0
            self.count += 1
            for span in DETERIORATION_SPANS:
                alpha = 2 / (span + 1)
                self.ewma[span] = (1 - alpha) * self.ewma[span] + alpha * won
            self.last_settlement_ns = int(settlement_ns)
            self.consumed.append(identity)
        # Bound the consumed ledger; the durable table remains the audit trail.
        if len(self.consumed) > 20000:
            self.consumed = self.consumed[-20000:]
        return len(ready)

    def attach_settlement(self, identity: str, label: int | None, settlement_ns: int | None) -> None:
        rec = self.pending.get(identity)
        if rec is None:
            return
        rec["label"] = None if label is None else int(label)
        rec["settlement_ns"] = None if settlement_ns is None else int(settlement_ns)

    def evaluate(self) -> dict[str, Any]:
        """Return the DUAL_SPEED gate for the current pooled state."""
        warm = self.count < DETERIORATION_MINIMUM
        keep = not (
            self.ewma[16] < 1 / DETERIORATION_ODDS
            and self.ewma[128] - self.ewma[16] >= DETERIORATION_GAP
        )
        return {
            "warm": warm,
            "keep": keep,
            "weak": (not warm) and (not keep),
            "count": self.count,
            "ewma16": self.ewma[16],
            "ewma128": self.ewma[128],
            "latest_available_ns": self.last_settlement_ns,
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            "count": self.count,
            "ewma": {str(k): v for k, v in self.ewma.items()},
            "last_settlement_ns": self.last_settlement_ns,
            "pending": self.pending,
            "consumed": self.consumed,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DeteriorationState":
        obj = cls()
        obj.count = int(data.get("count", 0))
        stored = data.get("ewma", {})
        obj.ewma = {n: float(stored.get(str(n), DETERIORATION_INIT)) for n in DETERIORATION_SPANS}
        obj.last_settlement_ns = int(data.get("last_settlement_ns", -1))
        obj.pending = dict(data.get("pending", {}))
        obj.consumed = list(data.get("consumed", []))
        return obj


@dataclass
class C85State:
    """Everything the worker must persist to resume without replaying history."""

    admission_ranks: RankFamily = field(default_factory=RankFamily)
    filter_ranks: RankFamily = field(default_factory=RankFamily)
    deterioration: DeteriorationState = field(default_factory=DeteriorationState)
    expert_state: dict[str, Any] = field(default_factory=dict)
    source_watermarks: dict[str, Any] = field(default_factory=dict)
    applicable_fits: dict[str, Any] = field(default_factory=dict)
    last_processed_target_utc: str | None = None
    next_target_utc: str | None = None
    checkpoint_seq: int = 0
    parent_sha256: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "admission_rank_state": self.admission_ranks.to_dict(),
            "filter_rank_state": self.filter_ranks.to_dict(),
            "deterioration_state": self.deterioration.to_dict(),
            "expert_state": self.expert_state,
            "source_watermarks": self.source_watermarks,
            "applicable_fits": self.applicable_fits,
            "last_processed_target_utc": self.last_processed_target_utc,
            "next_target_utc": self.next_target_utc,
            "checkpoint_seq": self.checkpoint_seq,
            "parent_sha256": self.parent_sha256,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "C85State":
        return cls(
            admission_ranks=RankFamily.from_dict(data.get("admission_rank_state", {})),
            filter_ranks=RankFamily.from_dict(data.get("filter_rank_state", {})),
            deterioration=DeteriorationState.from_dict(data.get("deterioration_state", {})),
            expert_state=dict(data.get("expert_state", {})),
            source_watermarks=dict(data.get("source_watermarks", {})),
            applicable_fits=dict(data.get("applicable_fits", {})),
            last_processed_target_utc=data.get("last_processed_target_utc"),
            next_target_utc=data.get("next_target_utc"),
            checkpoint_seq=int(data.get("checkpoint_seq", 0)),
            parent_sha256=data.get("parent_sha256"),
        )

    def sha256(self) -> str:
        payload = self.to_dict()
        payload.pop("checkpoint_seq", None)
        payload.pop("parent_sha256", None)
        blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
        return hashlib.sha256(blob.encode()).hexdigest()
