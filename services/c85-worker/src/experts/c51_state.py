"""Restore the recovered historical C51 fitted states and advance them.

Source of the installed artifacts (all supplied, none fabricated):

  C85_Ancestor_Recovery.zip
    models/DIRECTION_WITH_POLY_BOOK/<YYYY-MM-DD>.json  -> artifacts/c51/direction
    models/META_PRIMARY_C42_OR_DIRECT/<YYYY-MM-DD>.json -> artifacts/c51/meta
    data/C51_TARGET_NATIVE_REBASE_R1_LEDGER.csv.gz      -> rank-history seed in
                                                           artifacts/c51/restore_manifest.json

Each state JSON carries the ordered features, imputation vector, RobustScaler
center/scale, logistic coefficients, intercept and the fit period, exactly as
the source's daily walk-forward refit produced them.

The installed states stop at 2026-08-31T23:45Z. They are historical restoration
artifacts, not current weights: `StateStore.readiness()` reports how far behind
"now" the newest state is and how many 96-row daily refits must be replayed
before C51 may be scored live. Nothing here invents parameters for the gap.
"""
from __future__ import annotations

import json
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np

from .c51 import (
    RANK_HISTORY,
    C51FittedState,
    C51InputError,
    FittedLinearHead,
)

ARTIFACT_ROOT = Path(__file__).resolve().parents[2] / "artifacts" / "c51"
DIRECTION_DIR = ARTIFACT_ROOT / "direction"
META_DIR = ARTIFACT_ROOT / "meta"
MANIFEST = ARTIFACT_ROOT / "restore_manifest.json"

# The source refits once per UTC day (96 rows of the 15-minute grid).
REFIT_PERIOD = timedelta(days=1)


def _head_from_json(payload: dict[str, Any]) -> FittedLinearHead:
    return FittedLinearHead(
        feature_order=list(payload["feature_order"]),
        imputation=np.asarray(payload["imputation"], dtype=float),
        center=np.asarray(payload["center"], dtype=float),
        scale=np.asarray(payload["scale"], dtype=float),
        coef=np.asarray(payload["coefficient"], dtype=float),
        intercept=float(payload["intercept"]),
    )


def load_head(directory: Path, day: str) -> FittedLinearHead:
    path = directory / f"{day}.json"
    if not path.exists():
        raise C51InputError(f"C85_C51_STATE_NOT_INSTALLED:{path}")
    return _head_from_json(json.loads(path.read_text()))


def available_days(directory: Path) -> list[str]:
    return sorted(p.stem for p in directory.glob("*.json"))


class C51StateStore:
    """Loads the installed daily states and reports live readiness honestly."""

    def __init__(self, root: Path = ARTIFACT_ROOT) -> None:
        self.root = root
        self.direction_dir = root / "direction"
        self.meta_dir = root / "meta"
        self.manifest = json.loads((root / "restore_manifest.json").read_text())
        self.direction_days = available_days(self.direction_dir)
        self.meta_days = available_days(self.meta_dir)
        if not self.direction_days or not self.meta_days:
            raise C51InputError("C85_C51_STATES_NOT_INSTALLED")

    @property
    def as_of(self) -> datetime:
        return datetime.fromisoformat(self.manifest["as_of"])

    def _state_day(self, days: list[str], target: datetime) -> str:
        """Newest installed state whose prediction day is <= the target day."""
        wanted = target.astimezone(timezone.utc).date().isoformat()
        eligible = [d for d in days if d <= wanted]
        if not eligible:
            raise C51InputError(f"C85_C51_NO_STATE_BEFORE:{wanted}")
        return eligible[-1]

    def restore(self, target: datetime) -> C51FittedState:
        """Restore direction + meta heads and the trailing rank history."""
        direction = load_head(self.direction_dir, self._state_day(self.direction_days, target))
        meta = load_head(self.meta_dir, self._state_day(self.meta_days, target))
        history: dict[int, deque] = {
            1: deque(maxlen=RANK_HISTORY),
            -1: deque(maxlen=RANK_HISTORY),
        }
        for side_key, values in self.manifest.get("rank_history", {}).items():
            history[int(side_key)].extend(float(v) for v in values)
        return C51FittedState(direction_head=direction, meta_head=meta, rank_history=history)

    def pending_refits(self, now: datetime | None = None) -> int:
        """Daily refits between the newest installed state and `now`."""
        now = now or datetime.now(timezone.utc)
        gap = now.astimezone(timezone.utc) - self.as_of
        return max(0, int(gap / REFIT_PERIOD))

    def readiness(self, now: datetime | None = None) -> dict[str, Any]:
        now = now or datetime.now(timezone.utc)
        pending = self.pending_refits(now)
        ready = pending == 0
        reasons: list[str] = []
        if not ready:
            reasons.append(
                "C85_C51_STATE_STALE: installed walk-forward states end "
                f"{self.as_of.isoformat()}; {pending} daily 96-row refit(s) must be "
                "replayed chronologically from continuation inputs (Binance event "
                "features, Polymarket pre-open book, settled labels and the C42 "
                "ledger for 2026-09-01 onward) before C51 may be scored live. "
                "Those continuation inputs are not in the supplement and are not "
                "fabricated here."
            )
        return {
            "as_of": self.as_of.isoformat(),
            "direction_states": len(self.direction_days),
            "meta_states": len(self.meta_days),
            "rank_history_counts": self.manifest.get("rank_history_counts", {}),
            "pending_refits": pending,
            "ready": ready,
            "blocking_reasons": reasons,
        }
