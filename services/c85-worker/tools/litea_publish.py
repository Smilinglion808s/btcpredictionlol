"""Publish the Version 1 durable position to the PRIVATE artifact bucket.

Everything the container needs to come back up — the rolling training frame,
every daily head, the paired engine/guard state — is uploaded through the
signed backend (short-lived per-object URLs, no storage credential in the
worker) and then read BACK and hash-compared. Nothing is reported as durable
on the strength of a successful upload alone.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.backend import BackendClient  # noqa: E402
from src.litea.remote import RemoteArtifacts  # noqa: E402


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    root = Path(sys.argv[1])
    from src.litea.identity import MODEL_ID

    backend = BackendClient(
        os.environ["LITEA_OPS_URL"],
        os.environ["C85_GATEWAY_SECRET"],
        os.environ.get("WORKER_ID", "litea-publish"),
        model_version=MODEL_ID,
    )
    remote = RemoteArtifacts(backend, root)
    manifest = remote.publish(
        heads_root=root / "heads",
        training=root / "training.parquet",
        state=root / "state.json",
    )

    # Read back from the bucket, not from memory.
    verified: dict[str, str] = {}
    for relative, expected in sorted(manifest.items()):
        key = f"datasets/lite-a-floor4-top10-r1/{relative}"
        actual = ""
        for attempt in range(6):
            body = remote._get(key, required=True)  # noqa: SLF001 - verification path
            actual = hashlib.sha256(body or b"").hexdigest()
            if actual == expected:
                break
            # A stale CDN copy is retried, never accepted.
            time.sleep(5 * (attempt + 1))
        if actual != expected:
            raise SystemExit(f"READBACK_MISMATCH: {relative} {expected} != {actual}")
        verified[relative] = actual

    local = {
        "training/training.parquet": _sha256(root / "training.parquet"),
        "checkpoints/state.json": _sha256(root / "state.json"),
    }
    for relative, digest in local.items():
        if verified.get(relative) != digest:
            raise SystemExit(f"LOCAL_REMOTE_MISMATCH: {relative}")

    print(json.dumps({"verified_objects": len(verified), "manifest": verified}, indent=2))


if __name__ == "__main__":
    main()
