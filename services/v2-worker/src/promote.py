"""Refit / promote command for the V2 Final R1 bundles.

    python src/promote.py inspect
    python src/promote.py promote --candidate <dir> [--activate]

`promote` verifies that the candidate directory contains a manifest whose
model_id is v2-final-r1, that every joblib matches its recorded sha256, and
that the validity window is coherent. It then copies the candidate into
models/<version>/ and, with --activate, atomically repoints models/current
(write to a temp dir, os.replace the symlink/dir) so a partially written
bundle can never be loaded.

AUTO-REFIT IS NOT AVAILABLE. Refitting requires causal index-direction labels
settled at least one minute before the fit cutoff. This repository contains no
label pipeline, so the worker cannot retrain itself. After 2026-10-12T00:00:00Z
the current bundles expire and the worker fails closed and reports
refit_required=true; a human must run package/refit.py in the lab, then
promote the resulting bundle here. The first release truthfully reports
"refit required" rather than pretending a label feed exists.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "package" / "models"
MODEL_ID = "v2-final-r1"


def verify_bundle(d: Path) -> dict:
    manifest = json.loads((d / "manifest.json").read_text())
    if manifest.get("model_id") != MODEL_ID:
        raise ValueError(f"manifest model_id must be {MODEL_ID}")
    for name, rec in manifest["models"].items():
        f = d / rec["file"]
        got = hashlib.sha256(f.read_bytes()).hexdigest()
        if got != rec["sha256"]:
            raise ValueError(f"{name}: sha256 mismatch ({got})")
    if not manifest["valid_from"] < manifest["valid_until"]:
        raise ValueError("invalid validity window")
    return manifest


def inspect() -> None:
    m = verify_bundle(MODELS / "current")
    print(json.dumps({"model_id": m["model_id"], "valid_from": m["valid_from"], "valid_until": m["valid_until"],
                      "sleeves": sorted(m["models"]), "auto_refit_available": False,
                      "refit_requires": "causal index-direction labels (lab only)"}, indent=2))


def promote(candidate: Path, activate: bool) -> None:
    manifest = verify_bundle(candidate)
    version = manifest["valid_from"][:10].replace("-", "")
    dest = MODELS / version
    if dest.exists():
        raise SystemExit(f"{dest} already exists; refusing to overwrite a promoted bundle")
    staging = Path(tempfile.mkdtemp(dir=str(MODELS)))
    for f in ["manifest.json", *[r["file"] for r in manifest["models"].values()]]:
        shutil.copy2(candidate / f, staging / f)
    verify_bundle(staging)
    os.replace(staging, dest)
    print(f"promoted -> {dest}")
    if activate:
        tmp = MODELS / f".current.{version}"
        if tmp.exists():
            shutil.rmtree(tmp)
        shutil.copytree(dest, tmp)
        verify_bundle(tmp)
        backup = MODELS / f"previous-{version}"
        if (MODELS / "current").exists():
            if backup.exists():
                shutil.rmtree(backup)
            os.replace(MODELS / "current", backup)
        os.replace(tmp, MODELS / "current")
        print("activated models/current (atomic swap; previous bundle kept)")
        print("NOTE: update package/CONTENT_HASHES.json and redeploy; the worker "
              "refuses to start scoring on an unverified package.")


def main() -> None:
    ap = argparse.ArgumentParser(description="Inspect or promote V2 Final R1 model bundles")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("inspect")
    p = sub.add_parser("promote")
    p.add_argument("--candidate", required=True, type=Path)
    p.add_argument("--activate", action="store_true")
    a = ap.parse_args()
    if a.cmd == "inspect":
        inspect()
    else:
        promote(a.candidate, a.activate)


if __name__ == "__main__":
    main()
