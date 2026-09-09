#!/usr/bin/env python3
"""Build a relocatable, hash-verified release of the c30/c70 direction fits.

The refit tool writes artifacts next to a report that records *absolute* paths
on whatever machine ran it, and it recorded its numeric metrics without gating
on them. This tool is the publication step those artifacts never had:

1. it re-checks every recorded metric against explicit tolerances and
   **refuses to publish** if any one of them fails - artifacts are only copied
   into the release root after the whole set passes;
2. it copies the artifacts under the release root with *relative* paths, so
   the release can be restored on Railway (or any clean path) with the
   original mount absent;
3. it records SHA-256 for every artifact plus the library versions and the
   input report hash, so the loader can hash bytes before unpickling.

Usage::

    python tools/build_external_direction_release.py \
        --fits /path/to/external_direction_fits \
        --out  /path/to/releases/external_direction_r1
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

STAGES = ("T0", "T5")

# Gates. These are the *recorded original* values from the reproduction, with a
# tolerance for library-level float drift only. They are not a search space:
# publication fails rather than accepting a fit that no longer reproduces.
EXPECTED_SOURCE_SET = "BINANCE_HYPERLIQUID"
EXPECTED_C = 0.03
METRIC_TOLERANCE = 5e-3
MIN_VALIDATION_ACCURACY = 0.5


class ReleaseRejected(RuntimeError):
    """Raised instead of publishing when any gate fails."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def library_versions() -> dict[str, str]:
    import joblib
    import numpy
    import pandas
    import sklearn

    return {
        "python": sys.version.split()[0],
        "numpy": numpy.__version__,
        "pandas": pandas.__version__,
        "scikit-learn": sklearn.__version__,
        "joblib": joblib.__version__,
    }


def check_gates(report: dict) -> list[str]:
    """Return the list of gate failures; empty means publishable."""

    failures: list[str] = []
    for stage in STAGES:
        stage_report = report["stages"].get(stage)
        if stage_report is None:
            failures.append(f"{stage}: absent from the report")
            continue
        if not stage_report.get("selection_reproduced"):
            failures.append(f"{stage}: recorded source/C selection not reproduced")
        if stage_report.get("source_set") not in (None, EXPECTED_SOURCE_SET):
            failures.append(
                f"{stage}: source set {stage_report['source_set']} != {EXPECTED_SOURCE_SET}"
            )
        for phase, entry in stage_report.get("phases", {}).items():
            label = f"{stage}/{phase}"
            if not entry.get("features_match_recorded"):
                failures.append(f"{label}: retained feature list differs from the recorded one")
            if entry.get("c_value") is not None and abs(
                float(entry["c_value"]) - EXPECTED_C
            ) > 1e-12:
                failures.append(f"{label}: C={entry['c_value']} != {EXPECTED_C}")
            recorded = entry.get("recorded_metrics") or {}
            achieved = entry.get("metrics") or {}
            for name, want in recorded.items():
                if name not in achieved:
                    failures.append(f"{label}: metric {name} not reproduced")
                    continue
                if abs(float(achieved[name]) - float(want)) > METRIC_TOLERANCE:
                    failures.append(
                        f"{label}: metric {name} {achieved[name]} differs from recorded "
                        f"{want} by more than {METRIC_TOLERANCE}"
                    )
            accuracy = achieved.get("validation_accuracy")
            if accuracy is not None and float(accuracy) < MIN_VALIDATION_ACCURACY:
                failures.append(
                    f"{label}: validation accuracy {accuracy} below {MIN_VALIDATION_ACCURACY}"
                )
    return failures


def build(fits_dir: Path, out_dir: Path, *, force: bool = False) -> dict:
    import joblib

    report_path = fits_dir / "refit_report.json"
    if not report_path.exists():
        raise ReleaseRejected(f"no refit report at {report_path}")
    report = json.loads(report_path.read_text())

    failures = check_gates(report)
    if failures and not force:
        raise ReleaseRejected(
            "refusing to publish; gate failures:\n  - " + "\n  - ".join(failures)
        )

    if out_dir.exists() and any(out_dir.iterdir()):
        raise ReleaseRejected(f"release root {out_dir} already exists and is not empty")
    artifacts_dir = out_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    manifest: dict = {
        "release_kind": "c30_c70_external_direction",
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "library_versions": library_versions(),
        "source_report_sha256": sha256_file(report_path),
        "gate_failures": failures,
        "gates": {
            "expected_source_set": EXPECTED_SOURCE_SET,
            "expected_c": EXPECTED_C,
            "metric_tolerance": METRIC_TOLERANCE,
        },
        "stages": {},
    }

    for stage in STAGES:
        stage_report = report["stages"][stage]
        phases: dict[str, dict] = {}
        for phase, entry in stage_report["phases"].items():
            source = Path(entry["artifact"])
            if not source.exists():
                source = fits_dir / source.name
            if not source.exists():
                raise ReleaseRejected(f"artifact for {stage}/{phase} not found: {entry['artifact']}")
            relative = Path("artifacts") / source.name
            shutil.copy2(source, out_dir / relative)
            copied = out_dir / relative
            digest = sha256_file(copied)
            if digest != sha256_file(source):
                raise ReleaseRejected(f"copy of {source.name} does not match the source bytes")
            blob = joblib.load(copied)
            phases[phase] = {
                "path": str(relative),
                "sha256": digest,
                "stage": stage,
                "phase": phase,
                "source_set": blob["source_set"],
                "c_value": float(blob["c_value"]),
                "feature_count": len(blob["features"]),
                "classes": [int(c) for c in blob["pipeline"].classes_],
                "train_end": str(blob["train_end"]),
                "scores_from": str(blob["scores_from"]),
                "scores_until": str(blob["scores_until"]),
                "input_hashes": entry.get("input_hashes"),
            }
        manifest["stages"][stage] = {"phases": phases}

    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fits", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument(
        "--force",
        action="store_true",
        help="publish despite gate failures (records them in the manifest)",
    )
    args = parser.parse_args()
    try:
        manifest = build(args.fits, args.out, force=args.force)
    except ReleaseRejected as exc:
        print(f"REJECTED: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({k: v for k, v in manifest.items() if k != "stages"}, indent=2))
    print(f"release written to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
