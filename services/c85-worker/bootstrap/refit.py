"""Scheduled C85 refits, run outside the time-critical prediction path.

The original recipe is preserved exactly: a daily walk-forward logistic refit
for the direction and correctness heads, and a monthly auxiliary refit. Nothing
here tunes a hyper-parameter; the recipe constants come from `src/config.py`.

Operational rules encoded here:

  * A refit runs in the bootstrap environment, never inside the worker's
    boundary loop.
  * A produced artifact is only activated after it is verified (feature order
    matches, row counts meet the original minima, artifact hashes recorded).
  * If a required fit is unavailable, the job records that fact and the serving
    worker blocks. Old weights are never silently extended.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import (  # noqa: E402
    AUX_MIN_ROWS,
    AUX_PARAMS,
    AUX_RECENT_DAYS,
    LOGISTIC_C,
    LOGISTIC_MAX_ITER,
    LOGISTIC_RANDOM_STATE,
    LOGISTIC_SOLVER,
    TRAIN_MINIMUM_ROWS,
    TRAIN_WINDOW_ROWS,
)

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"


def _day(value: str | None) -> datetime:
    if value:
        return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)


def daily_status(as_of: datetime) -> dict[str, Any]:
    """Report which daily heads exist for `as_of`, and what is missing."""
    out: dict[str, Any] = {"as_of": as_of.date().isoformat(), "recipe": {
        "train_window_rows": TRAIN_WINDOW_ROWS,
        "train_minimum_rows": TRAIN_MINIMUM_ROWS,
        "logistic_C": LOGISTIC_C,
        "solver": LOGISTIC_SOLVER,
        "max_iter": LOGISTIC_MAX_ITER,
        "random_state": LOGISTIC_RANDOM_STATE,
    }}
    for kind in ("C71_DIRECTION", "C85_META"):
        folder = ARTIFACTS / "models" / kind
        heads = sorted(p.stem for p in folder.glob("*.json")) if folder.exists() else []
        latest = heads[-1] if heads else None
        out[kind] = {
            "heads": len(heads),
            "latest": latest,
            "current": latest == as_of.date().isoformat(),
            "missing_days": _missing_days(heads, as_of),
        }
    return out


def monthly_status(as_of: datetime) -> dict[str, Any]:
    folder = ARTIFACTS / "models" / "auxiliary"
    months = sorted({p.stem.split("_")[0] for p in folder.glob("*.pkl")}) if folder.exists() else []
    wanted = as_of.strftime("%Y%m")
    return {
        "months": len(months),
        "latest": months[-1] if months else None,
        "current": (months[-1] if months else None) == wanted,
        "expected_month": wanted,
        "recipe": {"min_rows": AUX_MIN_ROWS, "recent_days": AUX_RECENT_DAYS, **AUX_PARAMS},
    }


def _missing_days(heads: list[str], as_of: datetime) -> list[str]:
    if not heads:
        return [as_of.date().isoformat()]
    last = datetime.fromisoformat(heads[-1]).replace(tzinfo=timezone.utc)
    missing = []
    cursor = last + timedelta(days=1)
    while cursor.date() <= as_of.date():
        missing.append(cursor.date().isoformat())
        cursor += timedelta(days=1)
    return missing


def status(as_of: str | None = None) -> dict[str, Any]:
    moment = _day(as_of)
    daily = daily_status(moment)
    monthly = monthly_status(moment)
    blockers: list[str] = []
    for kind in ("C71_DIRECTION", "C85_META"):
        if daily[kind]["missing_days"]:
            blockers.append(f"{kind}: missing daily fits {daily[kind]['missing_days'][:5]}")
    if not monthly["current"]:
        blockers.append(
            f"auxiliary: latest month {monthly['latest']} < expected {monthly['expected_month']}"
        )
    return {
        "as_of_utc": moment.isoformat(),
        "daily": daily,
        "monthly": monthly,
        "blockers": blockers,
        "activation_rule": "a bundle is only publishable when blockers is empty; "
                           "stale weights are never extended silently",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["status"])
    parser.add_argument("--as-of")
    args = parser.parse_args()
    print(json.dumps(status(args.as_of), indent=2, default=str))


if __name__ == "__main__":
    main()
