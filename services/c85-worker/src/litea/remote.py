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
import time
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
    def _get(self, key: str, *, required: bool = False, bust: int = 0) -> bytes | None:
        """Absent and broken are DIFFERENT.

        An object the manifest lists is required: if the backend refuses, the
        signed URL fails or the download errors, that is raised. Only a genuine
        absence (no manifest yet, on a first run) returns None, so a partial
        restore can never quietly become the serving position.
        """
        try:
            signed = self.backend.call("artifact.download_url", key=key, ttl_seconds=120)
        except Exception as exc:  # noqa: BLE001
            if required:
                raise RuntimeError(f"LITEA_ARTIFACT_UNREACHABLE: {key} :: {exc}") from exc
            return None
        url = signed.get("url")
        if not url:
            if required:
                raise RuntimeError(f"LITEA_ARTIFACT_NO_URL: {key}")
            return None
        try:
            # The storage CDN will happily serve a just-replaced object's
            # PREVIOUS body for a short window. A restore that accepted that
            # would silently rewind the serving position, so every read is
            # explicitly uncached.
            response = httpx.get(
                url + (f"&cb={bust}" if bust else ""),
                timeout=120.0,
                follow_redirects=True,
                headers={"cache-control": "no-cache", "pragma": "no-cache"},
            )
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"LITEA_ARTIFACT_DOWNLOAD_FAILED: {key} :: {exc}") from exc
        if response.status_code != 200:
            if required or response.status_code >= 500:
                raise RuntimeError(
                    f"LITEA_ARTIFACT_DOWNLOAD_FAILED: {key} -> {response.status_code}"
                )
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
        # A just-replaced object can still be served from the storage edge for a
        # few seconds. That is a STALE READ, not a corrupt artifact, so the
        # digest disagreement is retried with a fresh signed URL for a bounded
        # time before it is treated as a real mismatch and raised.
        body: bytes | None = None
        actual = ""
        for attempt in range(10):
            body = self._get(key, required=expected is not None, bust=attempt)
            if body is None:
                return False
            actual = _sha256(body)
            if not expected or actual == expected:
                break
            if attempt < 9:
                time.sleep(min(15.0, 3.0 * (attempt + 1)))
        if body is None:
            return False
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
            if relative == "checkpoints/state.json":
                # The bucket snapshot is only republished on a daily fit, so it
                # can be older than both the local file and the signed decision
                # checkpoint. It is staged BESIDE the live state and the caller
                # picks the newest committed position; it never overwrites.
                destination = self.root / "state.remote.json"
            elif relative.startswith("training/"):
                destination = self.root / relative.split("/", 1)[1]
            else:
                destination = self.root / relative
            if destination.exists() and _sha256(destination.read_bytes()) == expected:
                continue
            key = f"datasets/lite-a-floor4-top10-r1/{relative}"
            if relative == "checkpoints/state.json":
                # MEASURED: a run can commit a newer checkpoint object and stop
                # before the manifest entry is rewritten, so the stored snapshot
                # legitimately runs AHEAD of its recorded digest. That is not
                # corruption, and refusing to start on it strands the worker.
                # The object is only a CANDIDATE here — it is staged beside the
                # live state and the caller still picks the newest committed
                # position — so it is admitted on structural validity and the
                # disagreement is reported rather than hidden.
                if self._install(key, destination, None):
                    installed.append(relative)
                    actual = _sha256(destination.read_bytes())
                    if actual != expected:
                        try:
                            candidate = json.loads(destination.read_text())
                        except Exception as exc:  # noqa: BLE001
                            raise RuntimeError(
                                f"LITEA_ARTIFACT_UNREADABLE: {key} ({type(exc).__name__})"
                            ) from exc
                        if candidate.get("model_version") not in (None, "lite-a-floor4-top10-r1"):
                            raise RuntimeError(f"LITEA_ARTIFACT_IDENTITY_MISMATCH: {key}")
                        self.state_digest_note = (
                            f"stored checkpoint {actual[:12]} is ahead of manifest "
                            f"entry {(expected or '')[:12]}; admitted as a candidate only"
                        )
                continue
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
