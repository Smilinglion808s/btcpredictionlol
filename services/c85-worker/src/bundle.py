"""Versioned C85 deployment bundle: the only thing the serving worker loads.

The bundle is produced by the offline bootstrap/refit job (see
`bootstrap/`), uploaded to private storage and registered through the signed
backend. The serving worker never reconstructs a historical ledger at startup —
it loads exactly one bundle, verifies every file against the manifest hashes and
resumes from the state the bundle carries.

Bundle layout (inside the tarball / bundle directory):

    manifest.json                      versions, cutoffs, watermarks, hashes
    state/checkpoint.json              policy state, rank + deterioration state,
                                       pending outcomes, expert state
    models/C71_DIRECTION/<date>.json   applicable direction heads only
    models/C85_META/<date>.json        applicable correctness heads only
    models/auxiliary/<YYYYMM>_*.pkl    applicable monthly bundles only
    feature_order.json                 frozen feature order

Bulk research archives and parity fixtures are deliberately NOT part of a
bundle; they stay in the research/refit environment (see
`bootstrap/inventory.py`).
"""
from __future__ import annotations

import hashlib
import json
import os
import tarfile
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

MANIFEST_NAME = "manifest.json"
STATE_PATH = "state/checkpoint.json"
DEFAULT_MAX_AGE_HOURS = int(os.environ.get("C85_BUNDLE_MAX_AGE_HOURS", "36"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


class BundleError(RuntimeError):
    """Any bundle problem fails closed: the worker blocks, it does not guess."""


@dataclass(frozen=True)
class BundleCutoffs:
    checkpoint_utc: datetime | None
    last_processed_target_utc: datetime | None
    direction_fit_cutoff_utc: datetime | None
    meta_fit_cutoff_utc: datetime | None
    aux_fit_month: str | None

    def as_dict(self) -> dict[str, Any]:
        def iso(value: datetime | None) -> str | None:
            return None if value is None else value.isoformat()

        return {
            "checkpoint_utc": iso(self.checkpoint_utc),
            "last_processed_target_utc": iso(self.last_processed_target_utc),
            "direction_fit_cutoff_utc": iso(self.direction_fit_cutoff_utc),
            "meta_fit_cutoff_utc": iso(self.meta_fit_cutoff_utc),
            "aux_fit_month": self.aux_fit_month,
        }


def _parse(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).replace("Z", "+00:00")
    moment = datetime.fromisoformat(text)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


class DeploymentBundle:
    """A verified, on-disk serving bundle."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        manifest_path = self.root / MANIFEST_NAME
        if not manifest_path.exists():
            raise BundleError(
                f"C85_BUNDLE_MISSING: no {MANIFEST_NAME} under {self.root}. "
                "The serving worker requires a bundle from the bootstrap job."
            )
        self.manifest: dict[str, Any] = json.loads(manifest_path.read_text())
        self.version: str = str(self.manifest.get("bundle_version") or "unversioned")
        self.model_version: str = str(self.manifest.get("model_version") or "")

    # -- integrity -------------------------------------------------------------
    def verify(self) -> dict[str, Any]:
        """Hash every declared file. A single mismatch blocks the worker."""
        files = self.manifest.get("files") or []
        if not files:
            raise BundleError("C85_BUNDLE_EMPTY: manifest declares no files")
        mismatches: list[str] = []
        missing: list[str] = []
        total = 0
        for entry in files:
            path = self.root / entry["path"]
            if not path.exists():
                missing.append(entry["path"])
                continue
            total += path.stat().st_size
            if sha256_file(path) != entry["sha256"]:
                mismatches.append(entry["path"])
        if missing or mismatches:
            raise BundleError(
                "C85_BUNDLE_CORRUPT: "
                + (f"missing={missing[:5]} " if missing else "")
                + (f"sha_mismatch={mismatches[:5]}" if mismatches else "")
            )
        return {"files": len(files), "bytes": total, "bundle_version": self.version}

    # -- contents --------------------------------------------------------------
    @property
    def cutoffs(self) -> BundleCutoffs:
        fits = self.manifest.get("fits") or {}
        return BundleCutoffs(
            checkpoint_utc=_parse(self.manifest.get("checkpoint_utc")),
            last_processed_target_utc=_parse(self.manifest.get("last_processed_target_utc")),
            direction_fit_cutoff_utc=_parse((fits.get("direction") or {}).get("cutoff_utc")),
            meta_fit_cutoff_utc=_parse((fits.get("meta") or {}).get("cutoff_utc")),
            aux_fit_month=(fits.get("auxiliary") or {}).get("month"),
        )

    @property
    def source_watermarks(self) -> dict[str, Any]:
        return dict(self.manifest.get("source_watermarks") or {})

    @property
    def artifact_dir(self) -> Path:
        """Directory the ArtifactStore reads (feature_order.json + models/)."""
        return self.root

    def checkpoint(self) -> dict[str, Any]:
        path = self.root / STATE_PATH
        if not path.exists():
            raise BundleError(f"C85_BUNDLE_NO_STATE: {STATE_PATH} absent from bundle")
        return json.loads(path.read_text())

    # -- freshness -------------------------------------------------------------
    def staleness(self, now: datetime | None = None) -> timedelta | None:
        stamp = self.cutoffs.checkpoint_utc
        if stamp is None:
            return None
        return (now or datetime.now(timezone.utc)) - stamp

    def freshness_problem(self, max_age_hours: int = DEFAULT_MAX_AGE_HOURS) -> str | None:
        """Return a blocking reason when the bundle is too old to serve.

        A serving worker must never silently run on frozen weights: if the
        bootstrap/refit job has not published a newer bundle within the window,
        readiness fails closed and the operator sees exactly why.
        """
        age = self.staleness()
        if age is None:
            return "C85_BUNDLE_NO_CHECKPOINT_TIMESTAMP"
        if age > timedelta(hours=max_age_hours):
            hours = age.total_seconds() / 3600
            return (
                f"C85_BUNDLE_STALE: active bundle {self.version} is {hours:.1f}h old "
                f"(limit {max_age_hours}h); run the bootstrap/refit job"
            )
        return None

    def inventory(self) -> dict[str, Any]:
        return {
            "bundle_version": self.version,
            "model_version": self.model_version,
            "built_at_utc": self.manifest.get("built_at_utc"),
            "cutoffs": self.cutoffs.as_dict(),
            "source_watermarks": self.source_watermarks,
            "files": len(self.manifest.get("files") or []),
            "parity": self.manifest.get("parity_report") or {},
        }


# -- acquisition ---------------------------------------------------------------
def extract(archive: Path, destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:gz") as tar:
        for member in tar.getmembers():
            target = (destination / member.name).resolve()
            if not str(target).startswith(str(destination.resolve())):
                raise BundleError(f"C85_BUNDLE_UNSAFE_PATH: {member.name}")
        tar.extractall(destination)  # noqa: S202 — members validated above
    return destination


def load_bundle(
    local_dir: Path,
    *,
    backend: Any | None = None,
    download: bool = True,
) -> DeploymentBundle:
    """Load the serving bundle: local directory first, then the active bundle.

    `backend` is a `BackendClient`. When the local directory has no manifest and
    downloading is allowed, the worker asks the backend for the ACTIVE bundle and
    a short-lived signed URL, verifies the archive hash, then unpacks it.
    """
    local_dir = Path(local_dir)
    if (local_dir / MANIFEST_NAME).exists():
        bundle = DeploymentBundle(local_dir)
        bundle.verify()
        return bundle
    if backend is None or not download:
        raise BundleError(
            f"C85_BUNDLE_MISSING: {local_dir} holds no bundle and no backend was provided"
        )

    import httpx

    response = backend.call("bundle.active", with_download_url=True)
    row = response.get("bundle")
    url = response.get("download_url")
    if not row or not url:
        raise BundleError(
            "C85_NO_ACTIVE_BUNDLE: the bootstrap job has not published and activated a "
            "deployment bundle yet"
        )
    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / "bundle.tar.gz"
        with httpx.stream("GET", url, timeout=120.0, follow_redirects=True) as stream:
            stream.raise_for_status()
            with archive.open("wb") as handle:
                for chunk in stream.iter_bytes(1 << 20):
                    handle.write(chunk)
        digest = sha256_file(archive)
        if digest != row.get("bundle_sha256"):
            raise BundleError(
                f"C85_BUNDLE_SHA_MISMATCH: downloaded {digest[:16]}…, "
                f"registry says {str(row.get('bundle_sha256'))[:16]}…"
            )
        extract(archive, local_dir)
    bundle = DeploymentBundle(local_dir)
    bundle.verify()
    return bundle
