"""Consistent-generation collector for the long-context parity walk.

The running reproduction (`parity_run.py`) replaces its NPZ and its JSON
separately, so reading them naively can capture a *mixed* pair: probabilities
from block N with metadata from block N+1. It also records only a truncated
input hash and, on resume, checks only row/feature counts and two digests.

This collector never touches the running process. It:

1. reads metadata, then the NPZ, then metadata again, and recomputes the
   probability-prefix digest from the NPZ itself. A generation is accepted only
   when both metadata reads are byte-identical *and* the recomputed prefix
   matches the digest the runner recorded. Otherwise it waits and retries;
2. records the FULL identity of the reproduction - complete feature-matrix
   hash (not a 4 MiB head), timestamp hash, finite-mask hash, label hash,
   ordered-schema hash, frozen constants and runtime versions;
3. writes an immutable generation directory whose MANIFEST.json is written
   LAST, so a manifest's presence means every payload beside it is complete;
4. uploads the whole generation to private storage and downloads it back,
   verifying every object byte length and SHA-256, manifest included.

`verify_generation` / `resume_contract` are the recovery side: a resume is
permitted only when every recorded identity matches the current inputs. Row
counts alone are never sufficient.
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

BUCKET = "c85-artifacts"
PREFIX = "checkpoints/long_context_parity"
MANIFEST = "MANIFEST.json"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            block = handle.read(chunk)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def sha256_array(array) -> str:
    import numpy as np

    return sha256_bytes(np.ascontiguousarray(array).tobytes())


# -- input identity ---------------------------------------------------------
def frame_identity(frame_path: Path) -> dict[str, Any]:
    """The FULL identity of the reproduction inputs, not a truncated prefix."""

    import numpy as np
    import pandas as pd

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from src.experts import long_context as lc

    frame = pd.read_pickle(frame_path)
    frame = frame.rename(columns={"binance_label": "label", "target_ts": "ts"})
    features = lc.feature_columns(list(frame.columns))
    x = frame[features].to_numpy(float)
    label = frame.label.to_numpy(float)
    complete = np.isfinite(x).all(axis=1)
    stamps = pd.to_datetime(frame.ts, utc=True).astype("int64").to_numpy()
    return {
        "frame_path": str(frame_path),
        "frame_sha256": sha256_file(frame_path),
        "rows": int(len(frame)),
        "features": len(features),
        "schema_hash": sha256_bytes("\n".join(features).encode()),
        "input_hash_full": sha256_array(x),
        "input_shape": list(x.shape),
        "timestamp_hash": sha256_array(stamps),
        "complete_mask_hash": sha256_array(complete),
        "complete_rows": int(complete.sum()),
        "label_hash": sha256_array(label),
        "first_ts": str(pd.Timestamp(frame.ts.iloc[0])),
        "last_ts": str(pd.Timestamp(frame.ts.iloc[-1])),
        "config": {
            "window": lc.WINDOW,
            "minimum": lc.MINIMUM,
            "refit_every": lc.REFIT_EVERY,
            "hgb_params": dict(lc.HGB_PARAMS),
            "head_id": lc.HEAD_ID,
        },
        "runtime": runtime_identity(),
    }


def runtime_identity() -> dict[str, Any]:
    import numpy
    import pandas
    import sklearn

    return {
        "python": platform.python_version(),
        "numpy": numpy.__version__,
        "pandas": pandas.__version__,
        "scikit_learn": sklearn.__version__,
        "threads": {v: os.environ.get(v) for v in (
            "OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS",
            "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS")},
    }


# -- consistent capture -----------------------------------------------------
def capture_consistent(npz_path: Path, meta_path: Path, *,
                       attempts: int = 12, pause: float = 5.0) -> dict[str, Any]:
    """Read a metadata/NPZ pair that provably belongs to one generation."""

    import numpy as np

    last_reason = "no attempt made"
    for attempt in range(attempts):
        before = meta_path.read_bytes()
        payload = npz_path.read_bytes()
        after = meta_path.read_bytes()
        if before != after:
            last_reason = "metadata changed while the NPZ was being read"
            time.sleep(pause)
            continue
        meta = json.loads(before)
        import io

        probability = np.load(io.BytesIO(payload))["probability"]
        block_start = int(meta["block_start"])
        end = min(block_start + meta["identity"]["refit_every"], len(probability))
        recomputed = sha256_array(probability[:end])
        if recomputed != meta["probability_prefix_sha256"]:
            last_reason = ("recorded probability prefix does not match the NPZ "
                           f"(recorded {meta['probability_prefix_sha256'][:12]}, "
                           f"recomputed {recomputed[:12]})")
            time.sleep(pause)
            continue
        return {
            "attempt": attempt,
            "meta": meta,
            "meta_bytes": before,
            "npz_bytes": payload,
            "probability": probability,
            "probability_prefix_sha256": recomputed,
            "probability_full_sha256": sha256_array(probability),
            "scored_rows": int(np.isfinite(probability).sum()),
        }
    raise RuntimeError(f"could not capture a consistent generation: {last_reason}")


# -- immutable generation ---------------------------------------------------
def write_generation(root: Path, capture: dict[str, Any], identity: dict[str, Any],
                     extra: dict[Path, str] | None = None) -> Path:
    """Write an immutable generation directory; the manifest is written last."""

    generation = root / f"gen-{capture['meta']['next_block_index']:04d}-{int(time.time())}"
    if generation.exists():
        raise FileExistsError(f"generation {generation} already exists; generations are immutable")
    staging = root / f".staging-{os.getpid()}-{int(time.time() * 1000)}"
    staging.mkdir(parents=True)
    try:
        (staging / "parity_ckpt.npz").write_bytes(capture["npz_bytes"])
        (staging / "parity_ckpt.json").write_bytes(capture["meta_bytes"])
        record = {
            "kind": "long_context_parity_checkpoint",
            "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "capture_attempt": capture["attempt"],
            "next_block_index": capture["meta"]["next_block_index"],
            "block_start": capture["meta"]["block_start"],
            "block_ts": capture["meta"]["block_ts"],
            "fit_count": capture["meta"]["fit_count"],
            "first_fit": capture["meta"]["first_fit"],
            "last_fit_block": capture["meta"]["last_fit_block"],
            "probability_prefix_sha256": capture["probability_prefix_sha256"],
            "probability_full_sha256": capture["probability_full_sha256"],
            "scored_rows": capture["scored_rows"],
            "identity": identity,
            "model_recovery": (
                "NOT SERIALISED. The running reproduction keeps no fitted model on "
                "disk; a resume RECONSTRUCTS the active model by refitting at "
                "last_fit_block from the same immutable inputs. Deterministic only "
                "while identity (inputs, schema, constants, runtime) matches exactly."
            ),
        }
        (staging / "checkpoint.json").write_text(json.dumps(record, indent=1))
        for source, name in (extra or {}).items():
            shutil.copyfile(source, staging / name)
        files = {}
        for path in sorted(staging.iterdir()):
            files[path.name] = {"bytes": path.stat().st_size, "sha256": sha256_file(path)}
        manifest = {"generation": generation.name, "files": files,
                    "written_at": record["captured_at"]}
        (staging / MANIFEST).write_text(json.dumps(manifest, indent=1))
        os.replace(staging, generation)
        return generation
    finally:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)


def verify_generation(generation: Path) -> dict[str, Any]:
    """A generation is valid only with a complete manifest covering every file."""

    manifest_path = generation / MANIFEST
    if not manifest_path.exists():
        raise RuntimeError(f"{generation} has no {MANIFEST}: incomplete or mixed generation")
    manifest = json.loads(manifest_path.read_text())
    present = {p.name for p in generation.iterdir() if p.name != MANIFEST}
    declared = set(manifest["files"])
    if present != declared:
        raise RuntimeError(f"{generation} file set disagrees with its manifest: "
                           f"extra {sorted(present - declared)}, missing {sorted(declared - present)}")
    for name, meta in manifest["files"].items():
        path = generation / name
        if path.stat().st_size != meta["bytes"] or sha256_file(path) != meta["sha256"]:
            raise RuntimeError(f"{generation}/{name} does not match its manifest digest")
    return manifest


def resume_contract(generation: Path, identity: dict[str, Any]) -> dict[str, Any]:
    """Decide whether a checkpoint may be resumed against current inputs.

    Every recorded identity field must match. Row counts alone never suffice,
    and a generation without a verified manifest is refused outright.
    """

    verify_generation(generation)
    record = json.loads((generation / "checkpoint.json").read_text())
    recorded = record["identity"]
    mismatches = []
    for key in ("rows", "features", "schema_hash", "input_hash_full", "timestamp_hash",
                "complete_mask_hash", "label_hash", "frame_sha256", "config", "runtime"):
        if recorded.get(key) != identity.get(key):
            mismatches.append(key)
    import io

    import numpy as np

    probability = np.load(io.BytesIO((generation / "parity_ckpt.npz").read_bytes()))["probability"]
    if sha256_array(probability) != record["probability_full_sha256"]:
        mismatches.append("probability_full_sha256")
    meta = json.loads((generation / "parity_ckpt.json").read_text())
    if int(meta["next_block_index"]) != int(record["next_block_index"]):
        mismatches.append("next_block_index")
    return {"resumable": not mismatches, "mismatches": mismatches,
            "next_block_index": record["next_block_index"],
            "last_fit_block": record["last_fit_block"]}


# -- durable storage --------------------------------------------------------
def _request(method: str, url: str, key: str, data: bytes | None = None):
    headers = {"Authorization": f"Bearer {key}", "apikey": key}
    if data is not None:
        headers["Content-Type"] = "application/octet-stream"
        headers["x-upsert"] = "true"
    return urllib.request.Request(url, data=data, method=method, headers=headers)


def upload_generation(generation: Path, *, prefix: str = PREFIX) -> list[dict[str, Any]]:
    """Upload every file, MANIFEST last, then download each back and verify."""

    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    manifest = verify_generation(generation)
    order = [n for n in sorted(manifest["files"])] + [MANIFEST]
    results = []
    for name in order:
        path = generation / name
        payload = path.read_bytes()
        dest = f"{prefix}/{generation.name}/{name}"
        url = f"{base}/storage/v1/object/{BUCKET}/{dest}"
        try:
            with urllib.request.urlopen(_request("POST", url, key, payload), timeout=600) as r:
                status = r.status
        except urllib.error.HTTPError as exc:
            status = f"{exc.code}:{exc.read()[:200]!r}"
        digest = hashlib.sha256()
        length = 0
        with urllib.request.urlopen(_request("GET", url, key), timeout=600) as r:
            while True:
                block = r.read(1 << 20)
                if not block:
                    break
                digest.update(block)
                length += len(block)
        results.append({
            "object": dest,
            "bytes": len(payload),
            "sha256": sha256_bytes(payload),
            "upload_status": str(status),
            "downloaded_bytes": length,
            "downloaded_sha256": digest.hexdigest(),
            "verified": length == len(payload) and digest.hexdigest() == sha256_bytes(payload),
        })
    return results


def main() -> int:
    root = Path(os.environ.get("C85_PARITY_ROOT", "/tmp/c85"))
    generations = Path(os.environ.get("C85_GENERATION_ROOT", "/tmp/c85/generations"))
    generations.mkdir(parents=True, exist_ok=True)
    identity = frame_identity(Path(os.environ.get(
        "C85_FRAME", "/tmp/c85/long_context_features.pkl")))
    capture = capture_consistent(root / "parity_ckpt.npz", root / "parity_ckpt.json")
    runner = root / "parity_run.py"
    generation = write_generation(
        generations, capture, identity,
        extra={runner: "parity_run.py"} if runner.exists() else None)
    manifest = verify_generation(generation)
    uploads = upload_generation(generation)
    check = resume_contract(generation, identity)
    print(json.dumps({
        "generation": generation.name,
        "manifest_files": {k: v["sha256"] for k, v in manifest["files"].items()},
        "uploads": uploads,
        "all_verified": all(u["verified"] for u in uploads),
        "resume_contract": check,
        "block_ts": capture["meta"]["block_ts"],
        "fit_count": capture["meta"]["fit_count"],
        "scored_rows": capture["scored_rows"],
    }, indent=1))
    return 0 if all(u["verified"] for u in uploads) and check["resumable"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
