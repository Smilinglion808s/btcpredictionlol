"""Measured inventory of the C85 working tree, split by role.

Three disjoint classes:

  SERVING  files and state the Railway worker must load to predict.
  REFIT    datasets and ledgers the scheduled daily/monthly fits consume.
  RESEARCH recovery material, parity fixtures and bulk archives that must never
           enter the serving image.

The classification is by path, so it stays true as the tree grows, and every
number below is measured from disk — nothing is estimated.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SERVING = (
    "artifacts/feature_order.json",
    "artifacts/models/C71_DIRECTION",
    "artifacts/models/C85_META",
    "artifacts/models/auxiliary",
    "src",
    "requirements.lock.txt",
    "Dockerfile",
)

REFIT = (
    "continuation",
    "evaluation-fixtures/cache/continuation",
)

RESEARCH = (
    "artifacts/fixtures",
    "artifacts/c51",
    "evaluation-fixtures/reference",
    "reproduction",
    "tests",
)


@dataclass
class Bucket:
    name: str
    roots: tuple[str, ...]
    files: int = 0
    bytes: int = 0
    entries: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "class": self.name,
            "files": self.files,
            "bytes": self.bytes,
            "megabytes": round(self.bytes / 1e6, 2),
            "roots": self.entries,
        }


def _measure(path: Path) -> tuple[int, int]:
    if not path.exists():
        return 0, 0
    if path.is_file():
        return 1, path.stat().st_size
    files = 0
    total = 0
    for item in path.rglob("*"):
        if item.is_file() and "__pycache__" not in item.parts:
            files += 1
            total += item.stat().st_size
    return files, total


def measure(root: Path = ROOT) -> dict:
    buckets = [
        Bucket("serving", SERVING),
        Bucket("refit", REFIT),
        Bucket("research", RESEARCH),
    ]
    for bucket in buckets:
        for rel in bucket.roots:
            files, size = _measure(root / rel)
            bucket.files += files
            bucket.bytes += size
            bucket.entries.append(
                {"path": rel, "present": (root / rel).exists(), "files": files, "bytes": size}
            )
    known = {r for b in buckets for r in b.roots}
    unclassified = []
    for item in sorted(root.iterdir()):
        rel = item.name
        if rel.startswith(".") or rel == "__pycache__" or rel == "bootstrap":
            continue
        if any(k == rel or k.startswith(rel + "/") for k in known):
            continue
        files, size = _measure(item)
        unclassified.append({"path": rel, "files": files, "bytes": size})
    return {
        "root": str(root),
        "buckets": [b.as_dict() for b in buckets],
        "unclassified": unclassified,
        "rule": "only 'serving' may enter the Railway image or a deployment bundle",
    }


def main() -> None:
    print(json.dumps(measure(), indent=2))


if __name__ == "__main__":
    main()
