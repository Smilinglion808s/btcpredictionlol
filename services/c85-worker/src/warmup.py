"""Automatic warmup and safe resume.

Contract:

* First install: verify artifacts, load the historical policy-state seed, then
  bridge every intervening opportunity in chronological order.
* Restart: restore the newest durable checkpoint and process only the gap.
* Never require a manual click, and never replay the whole history every 15
  minutes.

`fixtures/historical_seed_2026-09-01.json` is a C85 policy-state seed as of
2026-09-01T00:00Z whose last processed target is 2026-08-31T23:45Z. It is not a
September fit, not the inherited-expert state and not evidence of readiness.
Everything it does not carry is rebuilt here, and bridged rows are labelled
RESEARCH_BACKFILL, never presented as on-time live predictions.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable

from .artifacts import ArtifactStore
from .state import C85State
from .store import C85Store

INTERVAL = timedelta(minutes=15)


class Stage(str, Enum):
    INIT = "INIT"
    VERIFY = "VERIFY"
    SEED = "SEED"
    BRIDGE = "BRIDGE"
    FITTING = "FITTING"
    READY = "READY"
    BLOCKED = "BLOCKED"


@dataclass
class Progress:
    stage: Stage = Stage.INIT
    detail: str = ""
    targets_total: int = 0
    targets_done: int = 0
    last_completed_target: str | None = None
    next_target: str | None = None
    blocking_reason: str | None = None
    checkpoint_seq: int = 0
    resumed: bool = False
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "stage": self.stage.value,
            "detail": self.detail,
            "targets_total": self.targets_total,
            "targets_done": self.targets_done,
            "last_completed_target": self.last_completed_target,
            "next_target": self.next_target,
            "blocking_reason": self.blocking_reason,
            "checkpoint_seq": self.checkpoint_seq,
            "resumed": self.resumed,
            "notes": self.notes[-20:],
        }


def floor_target(moment: datetime) -> datetime:
    moment = moment.astimezone(timezone.utc)
    return moment.replace(
        minute=(moment.minute // 15) * 15, second=0, microsecond=0
    )


def next_target(moment: datetime) -> datetime:
    return floor_target(moment) + INTERVAL


def targets_between(start: datetime, end: datetime) -> list[datetime]:
    """Quarter-hour targets in (start, end], chronological."""
    out: list[datetime] = []
    cursor = floor_target(start) + INTERVAL
    while cursor <= floor_target(end):
        out.append(cursor)
        cursor += INTERVAL
    return out


class WarmupCoordinator:
    def __init__(self, artifacts: ArtifactStore, store: C85Store) -> None:
        self.artifacts = artifacts
        self.store = store
        self.progress = Progress()

    def _note(self, message: str) -> None:
        self.progress.notes.append(message)

    def load_seed(self, seed_path: Path) -> tuple[C85State, dict[str, Any]]:
        raw = json.loads(Path(seed_path).read_text())
        state = C85State.from_dict(raw.get("state", raw))
        meta = {
            "as_of_utc": raw.get("as_of_utc", "2026-09-01T00:00:00+00:00"),
            "last_processed_target_utc": raw.get(
                "last_processed_target_utc", state.last_processed_target_utc
            ),
            "scope": "C85 policy state only; experts and fits rebuilt separately",
        }
        state.last_processed_target_utc = meta["last_processed_target_utc"]
        return state, meta

    def restore_or_seed(self, seed_path: Path) -> tuple[C85State, bool]:
        """Prefer the durable checkpoint; fall back to the historical seed."""
        state, row = self.store.restore_state()
        if row is not None:
            self.progress.resumed = True
            self.progress.checkpoint_seq = int(row.get("checkpoint_seq") or 0)
            self._note(f"resumed checkpoint #{self.progress.checkpoint_seq}")
            return state, True
        self.progress.stage = Stage.SEED
        state, meta = self.load_seed(seed_path)
        self._note(f"seeded historical policy state as of {meta['as_of_utc']}")
        return state, False

    def plan_bridge(self, state: C85State, now: datetime) -> list[datetime]:
        if not state.last_processed_target_utc:
            return []
        last = datetime.fromisoformat(state.last_processed_target_utc)
        pending = targets_between(last, now)
        self.progress.targets_total = len(pending)
        self.progress.targets_done = 0
        return pending

    def bridge(
        self,
        state: C85State,
        pending: list[datetime],
        process: Callable[[C85State, datetime], None],
        checkpoint_every: int = 96,
    ) -> None:
        """Replay the gap chronologically, checkpointing as it goes.

        `process` must be idempotent per target: re-running the same bridge over
        a restored checkpoint has to produce the same state without duplicate
        predictions, duplicate settlement learning or any webhook emission.
        """
        self.progress.stage = Stage.BRIDGE
        for index, target in enumerate(pending, start=1):
            process(state, target)
            state.last_processed_target_utc = target.isoformat()
            self.progress.targets_done = index
            self.progress.last_completed_target = target.isoformat()
            if index % checkpoint_every == 0:
                self.progress.checkpoint_seq = self.store.save_checkpoint(
                    state, Stage.BRIDGE.value
                )
        self.progress.checkpoint_seq = self.store.save_checkpoint(state, Stage.BRIDGE.value)

    def block(self, reason: str) -> Progress:
        self.progress.stage = Stage.BLOCKED
        self.progress.blocking_reason = reason
        self._note(f"blocked: {reason}")
        return self.progress

    def ready(self, next_target_utc: datetime) -> Progress:
        self.progress.stage = Stage.READY
        self.progress.blocking_reason = None
        self.progress.next_target = next_target_utc.isoformat()
        return self.progress
