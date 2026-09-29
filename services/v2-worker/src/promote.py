"""Offline release preparation for V2 Final R1 model bundles.

    python src/promote.py inspect
    python src/promote.py prepare --candidate <dir> --out <new-release-dir>

This is NOT a live pointer swap and it never touches the running package.
Only replacing model files inside package/models/current would break the frozen
CONTENT_HASHES.json check on the next restart, so the only supported path is:

1. `prepare` verifies the candidate manifest + all three sleeve files
   independently against the currently deployed release;
2. it writes a COMPLETE new package tree to --out (a directory that must not
   exist yet): frozen code/docs copied byte-for-byte, the three candidate
   models staged together in models/current, and a regenerated
   CONTENT_HASHES.json;
3. it re-verifies the staged tree exactly as the worker does at startup;
4. a human reviews the diff and replaces services/v2-worker/package with the
   staged tree via normal review + redeploy.

The old release is left intact. There is no activation, no auto-refit and no
live training here: refitting requires causal index-direction labels (lab only).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE = ROOT / "package"
MODEL_ID = "v2-final-r1"
SLEEVES = ("direction8", "fade8", "direction45")
VALIDITY = timedelta(weeks=4)


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def features_hash(features: list[str]) -> str:
    return hashlib.sha256(json.dumps(list(features), separators=(",", ":")).encode()).hexdigest()


def parse_utc(s: str) -> datetime:
    d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    if d.tzinfo is None or d.utcoffset() != timedelta(0):
        raise ValueError(f"timestamp must be explicit UTC: {s!r}")
    return d.astimezone(timezone.utc)


def verify_bundle(d: Path, reference: dict | None = None, load_models: bool = True) -> dict:
    """Independently verify one bundle; with `reference`, also check it is a valid successor."""
    m = json.loads((d / "manifest.json").read_text())
    if m.get("model_id") != MODEL_ID:
        raise ValueError(f"manifest model_id must be {MODEL_ID}")
    if set(m.get("models", {})) != set(SLEEVES):
        raise ValueError(f"exactly three sleeves required {SLEEVES}, got {sorted(m.get('models', {}))}")
    start, end = parse_utc(m["valid_from"]), parse_utc(m["valid_until"])
    if start.time() != datetime.min.time():
        raise ValueError("valid_from must be a UTC midnight cutoff")
    if end - start != VALIDITY:
        raise ValueError(f"validity must be exactly 4 weeks (got {end - start})")
    for name in SLEEVES:
        rec = m["models"][name]
        f = d / rec["file"]
        if f.name != rec["file"] or not f.is_file():
            raise ValueError(f"{name}: model file missing or not flat: {rec['file']}")
        if sha256(f) != rec["sha256"]:
            raise ValueError(f"{name}: sha256 mismatch")
        if parse_utc(rec["fit_end"]) != start:
            raise ValueError(f"{name}: fit_end must equal valid_from cutoff")
        if not parse_utc(rec["cal_last_settlement"]) < start:
            raise ValueError(f"{name}: calibration labels must settle before the cutoff")
        if load_models:
            import joblib  # offline only
            bundle = joblib.load(f)
            if list(bundle.get("features", [])) != list(rec["features"]):
                raise ValueError(f"{name}: joblib feature order differs from manifest")
    if reference is not None:
        if m.get("feed") != reference.get("feed"):
            raise ValueError(f"feed identity changed: {m.get('feed')!r} != {reference.get('feed')!r}")
        if m.get("policy_sha256") != reference.get("policy_sha256"):
            raise ValueError("policy_sha256 changed; frozen policy must be identical")
        for name in SLEEVES:
            if features_hash(m["models"][name]["features"]) != features_hash(reference["models"][name]["features"]):
                raise ValueError(f"{name}: feature order/hash differs from the deployed release")
        if start <= parse_utc(reference["valid_from"]):
            raise ValueError("candidate validity must be a new window after the deployed one")
    return m


def inspect() -> None:
    m = verify_bundle(PACKAGE / "models" / "current", load_models=False)
    print(json.dumps({"model_id": m["model_id"], "valid_from": m["valid_from"], "valid_until": m["valid_until"],
                      "feed": m.get("feed"), "sleeves": list(SLEEVES),
                      "features_sha256": {n: features_hash(m["models"][n]["features"]) for n in SLEEVES},
                      "auto_refit_available": False,
                      "refit_requires": "causal index-direction labels (lab only)"}, indent=2))


def prepare(candidate: Path, out: Path, load_models: bool = True) -> dict:
    reference = verify_bundle(PACKAGE / "models" / "current", load_models=False)
    manifest = verify_bundle(candidate, reference, load_models)
    if out.exists():
        raise SystemExit(f"{out} already exists; refusing to overwrite")
    if PACKAGE.resolve() in [out.resolve(), *out.resolve().parents]:
        raise SystemExit("--out must be outside the deployed package")
    spec = json.loads((PACKAGE / "CONTENT_HASHES.json").read_text())
    staging = out.with_name(out.name + ".partial")
    if staging.exists():
        shutil.rmtree(staging)
    try:
        for rel in spec["files"]:
            if rel.startswith("models/current/"):
                continue
            (staging / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(PACKAGE / rel, staging / rel)
        models = staging / "models" / "current"
        models.mkdir(parents=True)
        for f in ["manifest.json", *[manifest["models"][n]["file"] for n in SLEEVES]]:
            shutil.copy2(candidate / f, models / f)
        files = {rel: h for rel, h in spec["files"].items() if not rel.startswith("models/current/")}
        for f in sorted(p.name for p in models.iterdir()):
            files[f"models/current/{f}"] = sha256(models / f)
        (staging / "CONTENT_HASHES.json").write_text(json.dumps({**spec, "files": files}, indent=2) + "\n")
        # Re-verify the staged tree exactly as the worker does at startup.
        for rel, want in files.items():
            if sha256(staging / rel) != want:
                raise ValueError(f"staged hash mismatch: {rel}")
        verify_bundle(models, reference, load_models)
        staging.rename(out)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return {"release_dir": str(out), "valid_from": manifest["valid_from"], "valid_until": manifest["valid_until"],
            "content_hashes_sha256": sha256(out / "CONTENT_HASHES.json"),
            "next_step": "review, replace services/v2-worker/package with this tree, redeploy"}


def main() -> None:
    ap = argparse.ArgumentParser(description="Inspect or prepare (offline) a V2 Final R1 release")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("inspect")
    p = sub.add_parser("prepare")
    p.add_argument("--candidate", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    a = ap.parse_args()
    if a.cmd == "inspect":
        inspect()
    else:
        print(json.dumps(prepare(a.candidate, a.out), indent=2))


if __name__ == "__main__":
    sys.exit(main())
