"""Private artifact transfer for the worker.

The worker holds no storage credentials and no service-role key. It asks the
signed C85 ops gateway (`artifact.download_url` / `artifact.upload_url`) for a
short-lived signed URL for one validated key inside one bucket, and uses it
immediately. The URL is a bearer credential: it is never logged, never written
to a manifest and never returned to a caller that only needs the bytes.

Restore rules, in order, because order is the safety property:

  1. stream the object to a private temporary file;
  2. hash the bytes and compare with the caller's expected digest - a download
     whose digest is unknown is rejected, not "verified later";
  3. extract with an explicit member filter (no absolute paths, no ``..``, no
     symlinks/hardlinks/devices, size ceiling) into a staging directory;
  4. verify **every** file listed in the release ``manifest.json`` against its
     recorded SHA-256 while it is still inert data;
  5. only then install atomically, by renaming staging into place and moving
     any previous copy aside rather than overwriting it in situ.

`joblib.load` never runs before step 4 - that is the whole point of doing the
manifest check here rather than inside the model loader.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import tarfile
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import httpx

MAX_MEMBER_BYTES = 512 * 1024 * 1024
MAX_TOTAL_BYTES = 1024 * 1024 * 1024


class TransferError(RuntimeError):
    """Raised for any failure that must not produce an installed artifact."""


class _Backend(Protocol):
    def call(self, op: str, **payload: Any) -> dict[str, Any]: ...


def sha256_path(path: Path, chunk: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(chunk):
            digest.update(block)
    return digest.hexdigest()


def _safe_members(archive: tarfile.TarFile, root: Path):
    total = 0
    for member in archive.getmembers():
        name = member.name
        if name.startswith("/") or ".." in Path(name).parts or ":" in name:
            raise TransferError(f"unsafe archive member path: {name!r}")
        if member.issym() or member.islnk() or member.isdev() or member.isfifo():
            raise TransferError(f"unsafe archive member type: {name!r}")
        if not (member.isfile() or member.isdir()):
            raise TransferError(f"unsupported archive member type: {name!r}")
        destination = (root / name).resolve()
        if not str(destination).startswith(str(root.resolve()) + os.sep):
            raise TransferError(f"archive member escapes the staging root: {name!r}")
        if member.size > MAX_MEMBER_BYTES:
            raise TransferError(f"archive member too large: {name!r}")
        total += member.size
        if total > MAX_TOTAL_BYTES:
            raise TransferError("archive exceeds the total size ceiling")
        yield member


@dataclass
class RestoreResult:
    key: str
    root: Path
    object_sha256: str
    bytes: int
    verified_files: int
    elapsed_s: float


class ArtifactTransfer:
    """Signed download/upload of `c85-artifacts` objects, restore-verified."""

    def __init__(self, backend: _Backend, *, timeout_s: float = 60.0) -> None:
        self.backend = backend
        self._client = httpx.Client(timeout=timeout_s, follow_redirects=True)

    def close(self) -> None:
        self._client.close()

    # -- transfer ---------------------------------------------------------
    def download(self, key: str, destination: Path, *, expected_sha256: str,
                 ttl_seconds: int = 120) -> str:
        """Download one object and verify its digest. Returns the digest."""

        if not expected_sha256 or len(expected_sha256) != 64:
            raise TransferError("a 64-character expected sha256 is required to restore")
        response = self.backend.call("artifact.download_url", key=key, ttl_seconds=ttl_seconds)
        url = response.get("url")
        if not response.get("ok") or not url:
            raise TransferError(f"gateway refused a download URL for {key!r}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".part")
        try:
            with self._client.stream("GET", url) as stream:
                if stream.status_code != 200:
                    # Deliberately does not include the URL.
                    raise TransferError(f"artifact fetch failed with status {stream.status_code}")
                with temporary.open("wb") as handle:
                    for chunk in stream.iter_bytes():
                        handle.write(chunk)
            digest = sha256_path(temporary)
            if digest != expected_sha256:
                raise TransferError(
                    f"artifact digest mismatch for {key!r}: got {digest}, expected {expected_sha256}"
                )
            os.replace(temporary, destination)
            return digest
        finally:
            temporary.unlink(missing_ok=True)

    def upload(self, key: str, path: Path) -> dict[str, Any]:
        """Upload one object through a signed upload URL. Returns its digest."""

        path = Path(path)
        size = path.stat().st_size
        if size > 200 * 1024 * 1024:
            raise TransferError(
                f"{path.name} is {size} bytes; the bucket accepts 200 MB per object - "
                "shard the dataset instead of raising the limit"
            )
        response = self.backend.call("artifact.upload_url", key=key)
        url = response.get("url")
        if not response.get("ok") or not url:
            raise TransferError(f"gateway refused an upload URL for {key!r}")
        with path.open("rb") as handle:
            put = self._client.put(
                url, content=handle, headers={"content-type": "application/octet-stream"}
            )
        if put.status_code not in (200, 201):
            raise TransferError(f"artifact upload failed with status {put.status_code}")
        return {"key": key, "bytes": size, "sha256": sha256_path(path)}

    # -- restore ----------------------------------------------------------
    def restore_release(self, key: str, *, expected_sha256: str, install_root: Path,
                        manifest_name: str = "manifest.json") -> RestoreResult:
        """Download, verify, extract safely, verify the manifest, install atomically."""

        started = time.monotonic()
        install_root = Path(install_root)
        install_root.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=install_root.parent, prefix=".c85-restore-") as tmp:
            tmp_path = Path(tmp)
            tarball = tmp_path / "object.tar.gz"
            digest = self.download(key, tarball, expected_sha256=expected_sha256)
            size = tarball.stat().st_size

            staging = tmp_path / "staging"
            staging.mkdir()
            with tarfile.open(tarball, "r:gz") as archive:
                # Our own member filter runs first; `filter="data"` is the
                # stdlib's belt-and-braces pass over metadata.
                archive.extractall(staging, members=_safe_members(archive, staging),
                                   filter="data")


            entries = [p for p in staging.iterdir()]
            payload = entries[0] if len(entries) == 1 and entries[0].is_dir() else staging
            verified = verify_manifest(payload, manifest_name=manifest_name)

            # Atomic install: stage aside, rename in, drop the old copy.
            previous = install_root.with_name(install_root.name + f".superseded-{int(time.time())}")
            if install_root.exists():
                os.replace(install_root, previous)
            try:
                os.replace(payload, install_root)
            except OSError:
                shutil.copytree(payload, install_root)
            if previous.exists():
                shutil.rmtree(previous, ignore_errors=True)

        return RestoreResult(
            key=key,
            root=install_root,
            object_sha256=digest,
            bytes=size,
            verified_files=verified,
            elapsed_s=time.monotonic() - started,
        )


def verify_manifest(root: Path, *, manifest_name: str = "manifest.json") -> int:
    """Verify every manifest-listed file under ``root``. Returns the count.

    Runs on inert bytes, before anything is deserialised. Paths must be
    relative and must stay inside the release root.
    """

    root = Path(root)
    manifest_path = root / manifest_name
    if not manifest_path.exists():
        raise TransferError(f"release manifest missing: {manifest_name}")
    manifest = json.loads(manifest_path.read_text())

    checked = 0
    for relative, expected in _manifest_entries(manifest):
        if os.path.isabs(relative) or ".." in Path(relative).parts:
            raise TransferError(f"manifest path escapes the release root: {relative!r}")
        candidate = (root / relative).resolve()
        if not str(candidate).startswith(str(root.resolve()) + os.sep):
            raise TransferError(f"manifest path escapes the release root: {relative!r}")
        if not candidate.exists():
            raise TransferError(f"manifest lists a missing artifact: {relative!r}")
        digest = sha256_path(candidate)
        if digest != expected:
            raise TransferError(
                f"restored artifact {relative!r} failed its digest: got {digest}, "
                f"manifest says {expected}"
            )
        checked += 1
    if checked == 0:
        raise TransferError("manifest lists no artifacts to verify")
    return checked


def _manifest_entries(node: Any):
    """Yield ``(path, sha256)`` from any manifest shape that pairs the two."""

    if isinstance(node, dict):
        path, digest = node.get("path"), node.get("sha256")
        if isinstance(path, str) and isinstance(digest, str):
            yield path, digest
        for value in node.values():
            yield from _manifest_entries(value)
    elif isinstance(node, list):
        for value in node:
            yield from _manifest_entries(value)
