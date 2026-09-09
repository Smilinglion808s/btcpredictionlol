"""Contract tests for signed artifact restore.

No network: a fake backend hands out `mock://` URLs and an httpx MockTransport
serves the bytes, so the tests exercise the parts that make restore safe -
digest-before-deserialise, member filtering, manifest verification and atomic
install - rather than the transport.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import tarfile
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.release_transfer import (  # noqa: E402
    ArtifactTransfer,
    TransferError,
    verify_manifest,
)


def _release_bytes(*, tamper: bool = False) -> bytes:
    """A minimal release: one artifact plus a manifest that pins its digest."""

    artifact = b"fitted-bytes-not-a-real-pickle"
    manifest = {
        "release_kind": "test",
        "stages": {"T0": {"phases": {"p": {"path": "artifacts/a.joblib",
                                           "sha256": hashlib.sha256(artifact).hexdigest()}}}},
    }
    if tamper:
        artifact = artifact + b"!"
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for name, payload in (
            ("release/manifest.json", json.dumps(manifest).encode()),
            ("release/artifacts/a.joblib", artifact),
        ):
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            archive.addfile(info, io.BytesIO(payload))
    return buffer.getvalue()


def _evil_bytes(name: str, *, symlink: bool = False) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        if symlink:
            info = tarfile.TarInfo(name)
            info.type = tarfile.SYMTYPE
            info.linkname = "/etc/passwd"
            archive.addfile(info)
        else:
            payload = b"x"
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            archive.addfile(info, io.BytesIO(payload))
    return buffer.getvalue()


class FakeBackend:
    def __init__(self, objects: dict[str, bytes]):
        self.objects = objects
        self.calls: list[tuple[str, dict]] = []

    def call(self, op: str, **payload):
        self.calls.append((op, payload))
        key = payload.get("key")
        if op == "artifact.download_url":
            if key not in self.objects:
                return {"ok": False, "error": "artifact_unavailable"}
            return {"ok": True, "url": f"mock://get/{key}", "key": key}
        if op == "artifact.upload_url":
            return {"ok": True, "url": f"mock://put/{key}", "key": key}
        raise AssertionError(op)


def _transfer(objects: dict[str, bytes]) -> ArtifactTransfer:
    backend = FakeBackend(objects)
    transfer = ArtifactTransfer(backend)

    def handler(request: httpx.Request) -> httpx.Response:
        key = str(request.url).split("mock://get/")[-1]
        if request.method == "PUT":
            objects[str(request.url).split("mock://put/")[-1]] = request.read()
            return httpx.Response(200)
        return httpx.Response(200, content=objects[key])

    transfer._client = httpx.Client(transport=httpx.MockTransport(handler))
    transfer.backend = backend
    return transfer


def test_restore_installs_and_verifies_every_manifest_entry(tmp_path):
    blob = _release_bytes()
    key = "releases/r.tar.gz"
    transfer = _transfer({key: blob})
    root = tmp_path / "installed"

    result = transfer.restore_release(
        key, expected_sha256=hashlib.sha256(blob).hexdigest(), install_root=root
    )

    assert result.verified_files == 1
    assert (root / "artifacts" / "a.joblib").exists()
    assert result.object_sha256 == hashlib.sha256(blob).hexdigest()


def test_wrong_digest_refuses_and_leaves_nothing_installed(tmp_path):
    blob = _release_bytes()
    transfer = _transfer({"releases/r.tar.gz": blob})
    root = tmp_path / "installed"

    with pytest.raises(TransferError, match="digest mismatch"):
        transfer.restore_release("releases/r.tar.gz", expected_sha256="0" * 64,
                                 install_root=root)
    assert not root.exists()
    # No stray staging directories are left behind either.
    assert list(tmp_path.iterdir()) == []


def test_manifest_digest_mismatch_blocks_install(tmp_path):
    """The object is intact, but a file inside disagrees with the manifest."""

    blob = _release_bytes(tamper=True)
    transfer = _transfer({"releases/r.tar.gz": blob})
    root = tmp_path / "installed"

    with pytest.raises(TransferError, match="failed its digest"):
        transfer.restore_release("releases/r.tar.gz",
                                 expected_sha256=hashlib.sha256(blob).hexdigest(),
                                 install_root=root)
    assert not root.exists()


def test_unknown_digest_is_refused_outright(tmp_path):
    transfer = _transfer({"releases/r.tar.gz": _release_bytes()})
    with pytest.raises(TransferError, match="expected sha256 is required"):
        transfer.restore_release("releases/r.tar.gz", expected_sha256="",
                                 install_root=tmp_path / "x")


@pytest.mark.parametrize("name,symlink", [
    ("../escape.txt", False),
    ("/absolute.txt", False),
    ("release/link", True),
])
def test_unsafe_members_are_rejected(tmp_path, name, symlink):
    blob = _evil_bytes(name, symlink=symlink)
    transfer = _transfer({"releases/e.tar.gz": blob})
    with pytest.raises(TransferError, match="unsafe|escapes"):
        transfer.restore_release("releases/e.tar.gz",
                                 expected_sha256=hashlib.sha256(blob).hexdigest(),
                                 install_root=tmp_path / "installed")
    assert not (tmp_path / "escape.txt").exists()
    assert not (tmp_path / "installed").exists()


def test_repeat_restore_is_idempotent_and_keeps_no_superseded_copies(tmp_path):
    blob = _release_bytes()
    transfer = _transfer({"releases/r.tar.gz": blob})
    root = tmp_path / "installed"
    digest = hashlib.sha256(blob).hexdigest()

    transfer.restore_release("releases/r.tar.gz", expected_sha256=digest, install_root=root)
    first = (root / "artifacts" / "a.joblib").read_bytes()
    transfer.restore_release("releases/r.tar.gz", expected_sha256=digest, install_root=root)

    assert (root / "artifacts" / "a.joblib").read_bytes() == first
    assert [p.name for p in tmp_path.iterdir()] == ["installed"]


def test_missing_object_reports_a_gateway_refusal(tmp_path):
    transfer = _transfer({})
    with pytest.raises(TransferError, match="refused a download URL"):
        transfer.restore_release("releases/nope.tar.gz", expected_sha256="a" * 64,
                                 install_root=tmp_path / "x")


def test_manifest_paths_may_not_escape_the_release_root(tmp_path):
    (tmp_path / "manifest.json").write_text(json.dumps(
        {"stages": {"path": "../outside.bin", "sha256": "a" * 64}}
    ))
    with pytest.raises(TransferError, match="escapes the release root"):
        verify_manifest(tmp_path)


def test_manifest_with_no_entries_is_a_failure(tmp_path):
    (tmp_path / "manifest.json").write_text(json.dumps({"stages": {}}))
    with pytest.raises(TransferError, match="no artifacts to verify"):
        verify_manifest(tmp_path)


def test_upload_refuses_objects_over_the_bucket_limit(tmp_path, monkeypatch):
    big = tmp_path / "big.bin"
    big.write_bytes(b"0")
    monkeypatch.setattr(os, "stat", lambda p, *a, **k: type(
        "S", (), {"st_size": 201 * 1024 * 1024})())
    transfer = _transfer({})
    with pytest.raises(TransferError, match="200 MB per object"):
        transfer.upload("datasets/big.bin", big)
