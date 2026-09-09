"""Serving-side restore of the C85 RECONSTRUCTION long-context bootstrap.

This is the bridge between the completed bootstrap artifact
(`checkpoints/c85-reconstruction-r1/long_context_bootstrap_<generation>.tar.gz`)
and the live leaf path. It restores three things that must stay consistent with
each other:

  * the fitted `LongContextHead` at ABSOLUTE position 23,328 (whatever the
    artifact says — the position is never renumbered to 0 on restore, because
    `external_rank` is a positional window and the C85 grid is absolute);
  * the `LongContextLeafProducer` seeded from the COMPLETE positional score
    ledger, including the slots the head could not score;
  * the settlement watermark, which is NOT the last feature timestamp: the
    bootstrap loop settles the PREVIOUS target, so the final buffered target is
    scored but its own label is still outstanding.

It is deliberately STALE-by-construction. `readiness()` reports the staleness in
targets and never returns ready for a head whose last observed target is not the
one immediately before the boundary being served. Nothing here fabricates a
probability: when the packet does not carry the long-context feature row, the
head callable raises, so the boundary is recorded as a genuine missing
dependency rather than advancing the rank window for a row that never existed.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from . import long_context as lc
from .direction_contract import LongContextLeafProducer

INTERVAL = timedelta(minutes=15)

#: Packet key carrying the 324 prepared long-context feature values for the
#: target. It is produced by the long-context feature builder, not by this
#: module, and its absence is a reported blocker.
FEATURE_KEY = "long_context_features"


class LongContextInputUnavailable(RuntimeError):
    """The packet carries no long-context feature row for this target.

    This is an ACQUISITION failure, not a `MODEL_NO_PROBABILITY` row: the
    target was never processed, so the positional rank window must not advance
    for it.
    """


@dataclass
class LongContextBootstrap:
    """Restored bootstrap head + rank queue, ready to serve one target."""

    head: lc.LongContextHead
    producer: LongContextLeafProducer
    generation: str
    manifest: dict[str, Any] = field(default_factory=dict)
    identity: str = "c85-reconstruction-r1"
    _staged: Any = None

    # -- construction -------------------------------------------------------
    @classmethod
    def restore(cls, state_dir: Path | str, rank_dir: Path | str | None = None
                ) -> "LongContextBootstrap":
        state_dir = Path(state_dir)
        rank_dir = Path(rank_dir) if rank_dir is not None else state_dir
        head = lc.LongContextHead.restore_state(state_dir)
        manifest_path = rank_dir / "rank_manifest.json"
        rank_state_path = rank_dir / "rank_state.json"
        if not rank_state_path.exists():
            raise FileNotFoundError(
                f"rank queue missing at {rank_state_path}: rebuild it with "
                "reproduction/rebuild_rank_ledger.py; a head without its "
                "positional rank history cannot produce external_rank"
            )
        producer = LongContextLeafProducer.from_dict(
            json.loads(rank_state_path.read_text())
        )
        manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
        generation = (state_dir / "CURRENT").read_text().strip()

        # The rank queue and the fitted head must describe the same series.
        last_key = producer.last_key
        if last_key is not None and last_key != head.position - 1:
            raise ValueError(
                f"rank queue ends at target {last_key} but the fitted head is at "
                f"position {head.position}: the queue does not belong to this "
                "generation"
            )
        if manifest and manifest.get("generation") not in (None, generation):
            raise ValueError(
                f"rank manifest was built for generation {manifest['generation']!r}, "
                f"not {generation!r}"
            )
        return cls(head=head, producer=producer, generation=generation,
                   manifest=manifest)

    # -- watermarks ---------------------------------------------------------
    @property
    def last_feature_ts(self) -> pd.Timestamp | None:
        return self.head._last_ts

    @property
    def last_settled_label_ts(self) -> pd.Timestamp | None:
        labels = self.head._labels_by_ts
        return max(labels) if labels else None

    @property
    def unsettled_target_ts(self) -> pd.Timestamp | None:
        """Target that is scored but whose own label has NOT been consumed.

        The bootstrap loop settles target `T-1` when it observes `T`, so the
        final observed target always leaves its label outstanding. That label
        becomes available one candle later and MUST be settled before the next
        refit, or the next fit trains on a silently truncated window.
        """

        last = self.last_feature_ts
        settled = self.last_settled_label_ts
        if last is None:
            return None
        if settled is None or last > settled:
            return last
        return None

    def next_target(self) -> pd.Timestamp | None:
        last = self.last_feature_ts
        return None if last is None else last + INTERVAL

    def staleness_targets(self, now: datetime | None = None) -> int | None:
        last = self.last_feature_ts
        if last is None:
            return None
        now = now or datetime.now(timezone.utc)
        return int((pd.Timestamp(now) - last) // pd.Timedelta(INTERVAL))

    # -- serving ------------------------------------------------------------
    def head_callable(self):
        """Callable for `LeafExperts.long_context_head`.

        Returns the probability for the packet's target, or `None` when the
        feature row exists but is incomplete (a real `MODEL_NO_PROBABILITY`
        row of the series). Raises when the row is absent entirely.
        """

        def score(packet: dict[str, Any]) -> float | None:
            row = packet.get(FEATURE_KEY)
            if row is None:
                raise LongContextInputUnavailable(
                    "C85_LONG_CONTEXT_FEATURES_MISSING: the packet carries no "
                    f"{FEATURE_KEY!r} row; the September long-context feature "
                    "builder is not producing forward rows yet, so this target "
                    "was never processed and must not advance the rank window"
                )
            ts = packet.get("target_open_utc") or packet.get("ts")
            if ts is None:
                raise LongContextInputUnavailable(
                    "C85_LONG_CONTEXT_TARGET_MISSING: packet has no target timestamp"
                )
            update = self.head.prepare(pd.Timestamp(ts), dict(row))
            self._staged = update
            return update.probability

        return score

    def commit(self) -> None:
        """Apply the staged head advance. Called inside the boundary commit."""

        if self._staged is not None:
            self._staged.commit()
            self._staged = None

    def rollback(self) -> None:
        self._staged = None

    def attach(self, leaf: Any) -> None:
        """Wire this bootstrap into a `LeafExperts` instance."""

        leaf.long_context = self.producer
        leaf.long_context_head = self.head_callable()
        # A supplied probability must never substitute for the head.
        leaf.allow_supplied = False

    # -- reporting ----------------------------------------------------------
    def readiness(self, target_open: datetime | None = None) -> dict[str, Any]:
        blocking: list[str] = []
        last = self.last_feature_ts
        expected_previous = (
            None if target_open is None else pd.Timestamp(target_open) - INTERVAL
        )
        if self.head.model is None:
            blocking.append("C85_LONG_CONTEXT_NOT_FITTED: restored head has no model")
        if expected_previous is not None and last is not None and last < expected_previous:
            gap = int((expected_previous - last) // pd.Timedelta(INTERVAL))
            blocking.append(
                f"C85_LONG_CONTEXT_STALE: last observed target {last.isoformat()} is "
                f"{gap} targets behind {expected_previous.isoformat()}; the "
                "September continuation has not been fed"
            )
        if self.unsettled_target_ts is not None:
            # Not fatal for scoring, but it is fatal for the next refit.
            blocking.append(
                "C85_LONG_CONTEXT_LABEL_OUTSTANDING: label of "
                f"{self.unsettled_target_ts.isoformat()} has not been settled"
            )
        window = self.producer.rank_state
        return {
            "identity": self.identity,
            "generation": self.generation,
            "head_id": lc.HEAD_ID,
            "spec": lc.SPEC_NAME,
            "fit_id": self.head.fit_id,
            "fit_count": self.head.fit_count,
            "position": self.head.position,
            "buffered_rows": len(self.head.buffer),
            "last_feature_ts": None if last is None else last.isoformat(),
            "last_settled_label_ts": (
                None if self.last_settled_label_ts is None
                else self.last_settled_label_ts.isoformat()
            ),
            "unsettled_target_ts": (
                None if self.unsettled_target_ts is None
                else self.unsettled_target_ts.isoformat()
            ),
            "next_target_ts": (
                None if self.next_target() is None else self.next_target().isoformat()
            ),
            "staleness_targets": self.staleness_targets(),
            "rank_last_key": self.producer.last_key,
            "rank_window_rows": len(window.window or []),
            "rank_lookback": window.lookback,
            "rank_minimum": window.minimum,
            "stale": True,
            "ready": not blocking,
            "blocking_reasons": blocking,
        }


def restore_from_env() -> LongContextBootstrap | None:
    """Restore the bootstrap when the deployment installed one.

    `C85_LONG_CONTEXT_STATE_DIR` points at the extracted checkpoint (the
    directory holding `CURRENT`); `C85_LONG_CONTEXT_RANK_DIR` defaults to it.
    Absent configuration returns None — the caller then reports the external
    leaf as unavailable, exactly as before.
    """

    import os

    state_dir = os.environ.get("C85_LONG_CONTEXT_STATE_DIR")
    if not state_dir or not (Path(state_dir) / "CURRENT").exists():
        return None
    return LongContextBootstrap.restore(
        state_dir, os.environ.get("C85_LONG_CONTEXT_RANK_DIR") or state_dir
    )


__all__ = [
    "FEATURE_KEY",
    "LongContextBootstrap",
    "LongContextInputUnavailable",
    "restore_from_env",
    "np",
]
