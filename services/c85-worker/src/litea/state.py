"""Atomic PAIRED state for Version 1.

The engine and the guard are two stateful objects that must advance together.
Persisting them independently would allow a restart in which the confidence
rank queue has advanced past a target while the daily-floor exposure has not
(or the reverse) — a silent double exposure or a silent skipped rank.

So the checkpoint is ONE envelope over BOTH snapshots plus the cursors, with a
pair-level checksum. Restore rejects any envelope whose pair digest, either
member checksum, or cursor set does not agree.

Everything is written through a temp file + fsync + atomic replace, so a crash
mid-write leaves either the previous generation or the new one, never a torn
file.
"""
from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .engine import LiteA, canonical, digest
from .guard import DailyFloor
from .identity import BASE_MODE, EXCEPTION_RANK, MODEL_ID

SCHEMA = 1


@dataclass
class Cursors:
    """Everything needed to resume without recomputing or double-counting."""

    #: last target whose decision is DURABLE in the backend
    last_committed_target: str | None = None
    #: last UTC day a daily fit was attempted, and its result
    last_fit_cutoff: str | None = None
    last_fit_result: str | None = None
    #: settlements already applied to engine+guard, so a replayed settlement
    #: feed cannot credit or debit a day twice
    consumed_settlements: list[str] = field(default_factory=list)
    #: last observed feed receipt watermarks, for honest restart reporting
    source_watermarks: dict[str, Any] = field(default_factory=dict)
    #: identity of the LIVE rolling training frame on disk. This is what a
    #: restart verifies its restored frame against, so it must always describe
    #: the current file — never a copy that a fit happened to consume.
    training_sha256: str | None = None
    training_rows: int = 0
    training_last_target: str | None = None
    #: identity of the frame the last fit actually consumed. Kept separately
    #: from the live cursors above, because a fit runs on an immutable copy and
    #: the live frame legitimately moves on while it runs.
    fit_input_sha256: str | None = None
    fit_input_rows: int = 0
    fit_input_last_target: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "last_committed_target": self.last_committed_target,
            "last_fit_cutoff": self.last_fit_cutoff,
            "last_fit_result": self.last_fit_result,
            "consumed_settlements": sorted(set(self.consumed_settlements)),
            "source_watermarks": self.source_watermarks,
            "training_sha256": self.training_sha256,
            "training_rows": self.training_rows,
            "training_last_target": self.training_last_target,
            "fit_input_sha256": self.fit_input_sha256,
            "fit_input_rows": self.fit_input_rows,
            "fit_input_last_target": self.fit_input_last_target,
        }

    @classmethod
    def restore(cls, payload: dict[str, Any]) -> "Cursors":
        return cls(
            last_committed_target=payload.get("last_committed_target"),
            last_fit_cutoff=payload.get("last_fit_cutoff"),
            last_fit_result=payload.get("last_fit_result"),
            consumed_settlements=list(payload.get("consumed_settlements") or []),
            source_watermarks=dict(payload.get("source_watermarks") or {}),
            training_sha256=payload.get("training_sha256"),
            training_rows=int(payload.get("training_rows") or 0),
            training_last_target=payload.get("training_last_target"),
            fit_input_sha256=payload.get("fit_input_sha256"),
            fit_input_rows=int(payload.get("fit_input_rows") or 0),
            fit_input_last_target=payload.get("fit_input_last_target"),
        )


class LiteAState:
    """The complete Version 1 runtime state."""

    def __init__(
        self,
        engine: LiteA | None = None,
        guard: DailyFloor | None = None,
        cursors: Cursors | None = None,
    ) -> None:
        self.engine = engine or LiteA(mode=BASE_MODE)
        self.guard = guard or DailyFloor(exception_rank=EXCEPTION_RANK)
        self.cursors = cursors or Cursors()
        if self.engine.mode != BASE_MODE:
            raise ValueError("Version 1 composes the baseline engine only")
        if self.guard.exception_rank != EXCEPTION_RANK:
            raise ValueError("Version 1 locks the 0.90 confidence exception")

    # -- snapshot / restore ----------------------------------------------------
    def snapshot(self) -> dict[str, Any]:
        pair = {
            "schema": SCHEMA,
            "model_id": MODEL_ID,
            "engine": self.engine.snapshot(),
            "guard": self.guard.snapshot(),
            "cursors": self.cursors.as_dict(),
        }
        return {"sha256": digest(pair), "state": json.loads(canonical(pair))}

    @classmethod
    def restore(cls, envelope: dict[str, Any]) -> "LiteAState":
        pair = envelope["state"]
        if envelope.get("sha256") != digest(pair):
            raise ValueError("LITEA_CHECKPOINT_PAIR_DIGEST_MISMATCH")
        if pair.get("schema") != SCHEMA or pair.get("model_id") != MODEL_ID:
            raise ValueError("LITEA_CHECKPOINT_IDENTITY_MISMATCH")
        # Each member re-verifies its OWN checksum inside its restore().
        engine = LiteA.restore(pair["engine"])
        guard = DailyFloor.restore(pair["guard"])
        state = cls(engine, guard, Cursors.restore(pair.get("cursors") or {}))
        state._assert_pair_consistent()
        return state

    def _assert_pair_consistent(self) -> None:
        """The two members must describe the same position in the sequence.

        `baseline` never opens engine-side exposure, so the engine's pending map
        is expected empty and the guard alone tracks open calls. Both must agree
        on the last decided target.
        """
        if self.engine.pending:
            raise ValueError(
                "LITEA_PAIR_INCONSISTENT: the baseline engine must hold no pending "
                "exposure; the daily floor is the single risk owner"
            )
        eng_target = self.engine.last_target
        guard_target = self.guard.last_target
        if eng_target != guard_target:
            raise ValueError(
                f"LITEA_PAIR_INCONSISTENT: engine last_target={eng_target!r} but "
                f"guard last_target={guard_target!r}"
            )
        committed = self.cursors.last_committed_target
        if committed is not None and eng_target is None:
            raise ValueError(
                "LITEA_PAIR_INCONSISTENT: a committed decision exists but the engine "
                "has no decided target"
            )

    # -- durability ------------------------------------------------------------
    def save(self, path: str | Path) -> str:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        body = canonical(self.snapshot())
        with tempfile.NamedTemporaryFile(
            dir=path.parent, prefix=path.name + ".", delete=False
        ) as handle:
            temporary = handle.name
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        return digest(json.loads(body)["state"])

    @classmethod
    def load(cls, path: str | Path) -> "LiteAState":
        return cls.restore(json.loads(Path(path).read_bytes()))
