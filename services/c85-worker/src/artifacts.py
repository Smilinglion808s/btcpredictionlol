"""Loading and hash-verification of the recovered C85 artifacts.

Artifacts live in a private directory (Docker build context or mounted volume),
never in the frontend bundle:

    <artifact_dir>/feature_order.json
    <artifact_dir>/models/C71_DIRECTION/YYYY-MM-DD.json   (198 daily direction heads)
    <artifact_dir>/models/C85_META/YYYY-MM-DD.json        (190 daily correctness heads)
    <artifact_dir>/models/auxiliary/YYYYMM_LONG.pkl       (36 monthly bundles,
    <artifact_dir>/models/auxiliary/YYYYMM_RECENT.pkl      72 estimators)
    <artifact_dir>/fixtures/…                              (parity fixtures)
"""
from __future__ import annotations

import functools
import hashlib
import json
import pickle
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@dataclass(frozen=True)
class Head:
    """A portable daily logistic state (direction or correctness)."""

    kind: str
    as_of: date
    bundle: dict[str, Any]
    sha256: str

    @property
    def feature_order(self) -> list[str]:
        return list(self.bundle["feature_order"])


class ArtifactStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self.models = self.root / "models"
        if not (self.root / "feature_order.json").exists():
            raise RuntimeError(
                f"C85 artifacts missing at {self.root}: feature_order.json not found. "
                "Unpack C85_Lovable_Kit.zip into the artifact directory."
            )
        self.feature_order: dict[str, list[str]] = json.loads(
            (self.root / "feature_order.json").read_text()
        )
        expected = {"direction": 60, "meta": 55, "auxiliary": 23}
        for key, width in expected.items():
            got = len(self.feature_order.get(key, []))
            if got != width:
                raise RuntimeError(f"feature_order.{key} has {got} entries, expected {width}")

    @functools.cached_property
    def feature_order_sha256(self) -> str:
        return sha256_file(self.root / "feature_order.json")

    # -- daily heads -----------------------------------------------------------
    @functools.lru_cache(maxsize=8)
    def _head_index(self, kind: str) -> tuple[tuple[date, Path], ...]:
        folder = self.models / kind
        if not folder.exists():
            raise RuntimeError(f"missing head directory {folder}")
        rows = []
        for path in sorted(folder.glob("*.json")):
            rows.append((date.fromisoformat(path.stem), path))
        if not rows:
            raise RuntimeError(f"no daily heads found in {folder}")
        return tuple(rows)

    def head_for(self, kind: str, target_open: datetime) -> Head | None:
        """Newest head whose UTC block start is on or before the target's day.

        Heads are refit on UTC daily block boundaries, so the head that applies
        to a boundary is the one stamped with that boundary's UTC date, or the
        most recent earlier one. Returns None when no head applies yet — the
        caller must abstain rather than reach for stale weights.
        """
        day = target_open.astimezone(timezone.utc).date()
        chosen: tuple[date, Path] | None = None
        for as_of, path in self._head_index(kind):
            if as_of <= day:
                chosen = (as_of, path)
            else:
                break
        if chosen is None:
            return None
        as_of, path = chosen
        return Head(kind=kind, as_of=as_of, bundle=json.loads(path.read_text()),
                    sha256=sha256_file(path))

    def head_coverage(self, kind: str) -> tuple[date, date, int]:
        index = self._head_index(kind)
        return index[0][0], index[-1][0], len(index)

    # -- monthly auxiliary bundles ---------------------------------------------
    @functools.lru_cache(maxsize=64)
    def auxiliary_bundle(self, month: str, window: str) -> tuple[list[str], Any, Any, str]:
        """Return (feature_order, classifier, regressor, sha256) for e.g. ('202608','LONG')."""
        path = self.models / "auxiliary" / f"{month}_{window}.pkl"
        if not path.exists():
            raise FileNotFoundError(f"auxiliary bundle not found: {path}")
        order, clf, reg = pickle.loads(path.read_bytes())
        if list(order) != self.feature_order["auxiliary"]:
            raise RuntimeError(f"auxiliary bundle {path.name} feature order does not match")
        return list(order), clf, reg, sha256_file(path)

    def auxiliary_months(self) -> list[str]:
        folder = self.models / "auxiliary"
        return sorted({p.stem.split("_")[0] for p in folder.glob("*.pkl")})

    def inventory(self) -> dict[str, Any]:
        direction = self.head_coverage("C71_DIRECTION")
        meta = self.head_coverage("C85_META")
        months = self.auxiliary_months()
        return {
            "feature_order_sha256": self.feature_order_sha256,
            "direction_heads": {"count": direction[2], "first": str(direction[0]),
                                "last": str(direction[1])},
            "correctness_heads": {"count": meta[2], "first": str(meta[0]),
                                  "last": str(meta[1])},
            "auxiliary_months": {"count": len(months), "first": months[0] if months else None,
                                 "last": months[-1] if months else None,
                                 "estimators": 2 * len(list((self.models / "auxiliary").glob("*.pkl")))
                                 // 2 * 2},
        }
