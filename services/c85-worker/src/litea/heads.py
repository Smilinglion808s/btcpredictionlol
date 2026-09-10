"""Daily head storage for Version 1.

A head is the exact `fit.fit_daily` output, wrapped by the supplied
`wrap_historical_head` so it expires at the next UTC midnight. Heads are stored
one JSON file per fit cutoff, both locally under the artifact directory and
durably under the version-scoped private key.

Expiry is not advisory. `Head.predict` raises `FIT_NOT_APPLICABLE` outside
`[fit_cutoff, valid_until_exclusive)`, so an August head can never score a
September target and a stale head can never be silently reused.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .engine import Head, canonical, digest, instant


class HeadUnavailable(RuntimeError):
    """No head covers this target. Version 1 abstains as FIT_UNAVAILABLE."""


class DailyHeadStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    # -- writing ---------------------------------------------------------------
    def save(self, payload: dict[str, Any]) -> tuple[Path, str]:
        """Persist a freshly fitted head. Never overwrites a different head."""
        head = Head(payload)  # validates the whole contract before anything lands
        cutoff = instant(payload["fit_cutoff"]).date().isoformat()
        path = self.root / f"{cutoff}.json"
        body = canonical(payload)
        if path.exists() and path.read_bytes() != body:
            existing = json.loads(path.read_bytes())
            raise RuntimeError(
                f"LITEA_HEAD_CONFLICT: a different head already exists for {cutoff} "
                f"(stored id {digest(existing)}, new id {head.id})"
            )
        temporary = path.with_suffix(".json.tmp")
        temporary.write_bytes(body)
        temporary.replace(path)
        return path, head.id

    # -- reading ---------------------------------------------------------------
    def _candidates(self) -> list[Path]:
        return sorted(p for p in self.root.glob("*.json") if not p.name.endswith(".tmp"))

    def head_for(self, target: datetime) -> Head:
        """The head whose validity window contains `target`, or nothing.

        Selection is by the head's OWN declared window, never by "newest
        available". A gap in daily fitting therefore surfaces as an abstention,
        not as a stale score.
        """
        moment = target.astimezone(timezone.utc)
        for path in reversed(self._candidates()):
            payload = json.loads(path.read_bytes())
            head = Head(payload)
            if head.start <= moment < head.end:
                return head
        raise HeadUnavailable(
            f"LITEA_NO_APPLICABLE_HEAD: no daily head covers {moment.isoformat()}; "
            "a head expires at its next UTC daily fit and is never extended"
        )

    def latest_cutoff(self) -> str | None:
        paths = self._candidates()
        return paths[-1].stem if paths else None

    def inventory(self) -> dict[str, Any]:
        paths = self._candidates()
        return {
            "count": len(paths),
            "first_fit_cutoff": paths[0].stem if paths else None,
            "latest_fit_cutoff": paths[-1].stem if paths else None,
        }
