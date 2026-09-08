"""Durable, repository-tracked record of continuation stage progress.

The stage cache lives under ``evaluation-fixtures/cache`` which is gitignored
and hosted on ephemeral sandbox storage: a wipe destroys every checkpoint and
the rebuild has no idea how far it had got. The manifests written here are tiny
JSON summaries (cursor, row counts, outputs, parity notes) committed with the
repository, so progress survives any cache loss even though the data itself has
to be re-derived.

Manifests are a record, never an input: nothing in the rebuild reads them back
to skip work.
"""
from __future__ import annotations

import json
from pathlib import Path

MANIFEST_DIR = Path(__file__).resolve().parent / "manifests"


def write(stage: str, checkpoint: dict) -> Path:
    """Persist the small, durable fields of a stage checkpoint."""
    MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "stage": stage,
        "cursor": checkpoint.get("cursor"),
        "rows": checkpoint.get("rows"),
        "mode": checkpoint.get("mode"),
        "outputs": checkpoint.get("outputs"),
        "notes": checkpoint.get("notes"),
        "patches": checkpoint.get("patches"),
        "seconds": checkpoint.get("seconds"),
        "updated_at": checkpoint.get("updated_at"),
        "error": checkpoint.get("error"),
    }
    path = MANIFEST_DIR / f"{stage}.json"
    path.write_text(json.dumps(payload, indent=2, sort_keys=True, default=str) + "\n")
    return path


def snapshot(status_rows: list[dict]) -> Path:
    """Write a single roll-up of every stage's cursor for quick inspection."""
    MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    path = MANIFEST_DIR / "_status.json"
    path.write_text(json.dumps(status_rows, indent=2, sort_keys=True, default=str) + "\n")
    return path
