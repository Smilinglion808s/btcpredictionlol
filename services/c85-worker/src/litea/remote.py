"""Durable Version 1 artifacts over the signed backend.

The worker holds no storage credentials. It asks the backend for a short-lived
signed URL per object, and every download is hash-checked against the manifest
before it is installed, so a truncated or substituted object can never become
the training frame or a scoring head.

Nothing here is optional convenience: the container has no persistent volume,
so the private bucket IS the durability for the rolling training frame, the
daily heads and the paired state.
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any

import httpx

from .identity import HEAD_PREFIX, STATE_PREFIX, TRAINING_PREFIX

MANIFEST_KEY = "datasets/lite-a-floor4-top10-r1/manifest.json"
TRAINING_KEY = TRAINING_PREFIX + "training.parquet"
STATE_KEY = STATE_PREFIX + "state.json"


def _sha256(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


class RemoteArtifacts:
    def __init__(self, backend: Any, root: Path) -> None:
        self.backend = backend
        self.root = Path(root)

    # -- transfer --------------------------------------------------------------
    def _get(self, key: str) -> bytes | None:
        try:
            signed = self.backend.call("artifact.download_url", key=key, ttl_seconds=120)
        except Exception:  # noqa: BLE001 - a missing object is not a crash
            return None
        url = signed.get("url")
        if not url:
            return None
        response = httpx.get(url, timeout=120.0, follow_redirects=True)
        if response.status_code != 200:
            return None
        return response.content

    def _put(self, key: str, body: bytes) -> str:
        signed = self.backend.call("artifact.upload_url", key=key)
        url = signed.get("url")
        if not url:
            raise RuntimeError(f"LITEA_ARTIFACT_UPLOAD_UNAVAILABLE: {key}")
        # The signed upload URL already carries its own one-shot token; the
        # worker never sees a storage credential.
        headers = {"content-type": "application/octet-stream", "x-upsert": "true"}
        response = httpx.put(url, content=body, headers=headers, timeout=300.0)
        if response.status_code >= 300:
            raise RuntimeError(
                f"LITEA_ARTIFACT_UPLOAD_FAILED: {key} -> {response.status_code}"
            )
        return _sha256(body)

    def _install(self, key: str, destination: Path, expected: str | None) -> bool:
        body = self._get(key)
        if body is None:
            return False
        actual = _sha256(body)
        if expected and actual != expected:
            raise RuntimeError(
                f"LITEA_ARTIFACT_DIGEST_MISMATCH: {key} expected {expected} got {actual}"
            )
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            dir=destination.parent, prefix=destination.name + ".", delete=False
        ) as handle:
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
            temporary = handle.name
        os.replace(temporary, destination)
        return True

    # -- lifecycle -------------------------------------------------------------
    def manifest(self) -> dict[str, str]:
        body = self._get(MANIFEST_KEY)
        return json.loads(body) if body else {}

    def restore(self) -> dict[str, Any]:
        """Bring a blank container up to the durable position.

        Local files win only when they already match the manifest digest; any
        disagreement is resolved by re-downloading, never by trusting the local
        copy.
        """
        manifest = self.manifest()
        installed: list[str] = []
        for relative, expected in manifest.items():
            if not (
                relative.startswith("heads/")
                or relative in ("training/training.parquet", "checkpoints/state.json")
            ):
                continue
            destination = self.root / relative.split("/", 1)[1] if relative.startswith(
                ("training/", "checkpoints/")
            ) else self.root / relative
            if destination.exists() and _sha256(destination.read_bytes()) == expected:
                continue
            key = f"datasets/lite-a-floor4-top10-r1/{relative}"
            if self._install(key, destination, expected):
                installed.append(relative)
        return {"manifest_entries": len(manifest), "installed": installed}

    def publish(self, *, heads_root: Path, training: Path | None, state: Path | None) -> dict[str, str]:
        """Push the local position back, then record it in the manifest."""
        manifest = self.manifest()
        if training and training.exists():
            manifest["training/training.parquet"] = self._put(
                TRAINING_KEY, training.read_bytes()
            )
        if state and state.exists():
            manifest["checkpoints/state.json"] = self._put(STATE_KEY, state.read_bytes())
        for path in sorted(Path(heads_root).glob("*.json")):
            relative = f"heads/{path.name}"
            body = path.read_bytes()
            if manifest.get(relative) == _sha256(body):
                continue
            manifest[relative] = self._put(HEAD_PREFIX + path.name, body)
        self._put(MANIFEST_KEY, json.dumps(manifest, indent=2, sort_keys=True).encode())
        return manifest
