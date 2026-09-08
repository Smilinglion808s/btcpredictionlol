"""Build a versioned C85 deployment bundle from verified bootstrap output.

Inputs (all produced by the original, unchanged producers):

  * `artifacts/feature_order.json` and the fitted heads / auxiliary bundles,
  * the continuation checkpoints under
    `evaluation-fixtures/cache/continuation/checkpoints/`,
  * a serving state document (policy state, rank state, deterioration state,
    pending outcomes, expert state, source watermarks).

Output: `dist/c85-<version>.tar.gz` plus its manifest. Only files serving needs
are included; research archives and parity fixtures are excluded by
construction, not by filtering after the fact.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
CHECKPOINTS = ROOT / "evaluation-fixtures" / "cache" / "continuation" / "checkpoints"
DIST = ROOT / "dist"

# Serving needs the applicable heads, not 198 historical ones. Keep a short tail
# so a boundary that lands just after a UTC day roll still resolves a head.
HEAD_TAIL = 8
AUX_TAIL = 2


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _latest(folder: Path, pattern: str, tail: int) -> list[Path]:
    if not folder.exists():
        return []
    return sorted(folder.glob(pattern))[-tail:]


def collect_serving_files() -> list[Path]:
    files: list[Path] = []
    order = ARTIFACTS / "feature_order.json"
    if not order.exists():
        raise RuntimeError(f"missing {order}: the bundle cannot be built without it")
    files.append(order)
    files += _latest(ARTIFACTS / "models" / "C71_DIRECTION", "*.json", HEAD_TAIL)
    files += _latest(ARTIFACTS / "models" / "C85_META", "*.json", HEAD_TAIL)
    files += _latest(ARTIFACTS / "models" / "auxiliary", "*.pkl", AUX_TAIL * 2)
    return files


def continuation_state() -> dict[str, Any]:
    """Stage cursors from the resumable rebuild, as source watermarks."""
    watermarks: dict[str, Any] = {}
    if CHECKPOINTS.exists():
        for path in sorted(CHECKPOINTS.glob("*.json")):
            data = json.loads(path.read_text())
            watermarks[path.stem] = {
                "cursor": data.get("cursor"),
                "rows": data.get("rows"),
                "mode": data.get("mode"),
                "updated_at": data.get("updated_at"),
                "error": data.get("error"),
            }
    return watermarks


def build(
    version: str | None = None,
    *,
    state_file: Path | None = None,
    parity_report: Path | None = None,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    version = version or now.strftime("%Y%m%dT%H%M%SZ")
    DIST.mkdir(parents=True, exist_ok=True)

    serving = collect_serving_files()
    watermarks = continuation_state()

    state: dict[str, Any] = {}
    if state_file and Path(state_file).exists():
        state = json.loads(Path(state_file).read_text())

    with tempfile.TemporaryDirectory() as tmp:
        stage = Path(tmp) / "bundle"
        stage.mkdir()
        entries: list[dict[str, Any]] = []

        for path in serving:
            rel = path.relative_to(ARTIFACTS)
            dest = stage / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dest)
            entries.append(
                {"path": str(rel), "sha256": sha256_file(dest), "bytes": dest.stat().st_size,
                 "role": "serving"}
            )

        state_dest = stage / "state" / "checkpoint.json"
        state_dest.parent.mkdir(parents=True, exist_ok=True)
        state_dest.write_text(json.dumps(state, indent=2, sort_keys=True, default=str))
        entries.append(
            {"path": "state/checkpoint.json", "sha256": sha256_file(state_dest),
             "bytes": state_dest.stat().st_size, "role": "state"}
        )

        direction = sorted((ARTIFACTS / "models" / "C71_DIRECTION").glob("*.json"))
        meta = sorted((ARTIFACTS / "models" / "C85_META").glob("*.json"))
        aux = sorted({p.stem.split("_")[0] for p in (ARTIFACTS / "models" / "auxiliary").glob("*.pkl")})

        manifest = {
            "bundle_version": version,
            "model_version": "c85-multi-meta-r1",
            "built_at_utc": now.isoformat(),
            # No fallback to build time: a bundle without real state must read as having
            # no checkpoint so the serving worker blocks instead of serving blind.
            "checkpoint_utc": state.get("as_of_utc"),
            "last_processed_target_utc": state.get("last_processed_target_utc"),
            "fits": {
                "direction": {"cutoff_utc": f"{direction[-1].stem}T00:00:00+00:00" if direction else None,
                              "heads_included": min(len(direction), HEAD_TAIL)},
                "meta": {"cutoff_utc": f"{meta[-1].stem}T00:00:00+00:00" if meta else None,
                         "heads_included": min(len(meta), HEAD_TAIL)},
                "auxiliary": {"month": aux[-1] if aux else None, "months_included": min(len(aux), AUX_TAIL)},
            },
            "source_watermarks": watermarks,
            "parity_report": json.loads(Path(parity_report).read_text())
            if parity_report and Path(parity_report).exists()
            else {},
            "files": entries,
            "excluded": ["evaluation-fixtures/*", "artifacts/fixtures/*", "reproduction/*"],
        }
        (stage / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True))

        archive = DIST / f"c85-{version}.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            for item in sorted(stage.rglob("*")):
                if item.is_file():
                    tar.add(item, arcname=str(item.relative_to(stage)))

    summary = {
        "bundle_version": version,
        "archive": str(archive),
        "bundle_sha256": sha256_file(archive),
        "byte_size": archive.stat().st_size,
        "file_count": len(entries) + 1,
        "manifest": manifest,
    }
    (DIST / f"c85-{version}.manifest.json").write_text(json.dumps(summary, indent=2, default=str))
    return summary


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version")
    parser.add_argument("--state", type=Path)
    parser.add_argument("--parity", type=Path)
    args = parser.parse_args()
    print(json.dumps(build(args.version, state_file=args.state, parity_report=args.parity),
                     indent=2, default=str))


if __name__ == "__main__":
    main()
