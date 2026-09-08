"""Upload and register a built C85 deployment bundle.

The bootstrap job holds no database credentials either: it uses the same signed
backend endpoint as the serving worker, asks for a short-lived signed upload
URL, PUTs the archive to private storage, registers the manifest and — only
after an explicit verification step — activates it.

Activation is deliberately a separate command: a freshly built bundle is
VERIFIED, and becomes ACTIVE only when an operator (or the acceptance script)
confirms it. The serving worker only ever loads the ACTIVE bundle.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.backend import BackendClient  # noqa: E402


def client() -> BackendClient:
    ops_url = os.environ.get("C85_OPS_URL", "").strip()
    secret = os.environ.get("C85_GATEWAY_SECRET", "").strip()
    if not ops_url or not secret:
        raise RuntimeError("C85_OPS_URL and C85_GATEWAY_SECRET are required to publish")
    return BackendClient(ops_url, secret, os.environ.get("C85_BUILDER_ID", "c85-bootstrap"),
                         timeout_s=30.0)


def publish(summary_path: Path, *, activate: bool = False) -> dict:
    summary = json.loads(Path(summary_path).read_text())
    archive = Path(summary["archive"])
    if not archive.exists():
        raise RuntimeError(f"archive missing: {archive}")

    backend = client()
    version = summary["bundle_version"]
    slot = backend.call("bundle.upload_url", bundle_version=version, filename=archive.name)
    upload = slot["upload"]

    with archive.open("rb") as handle:
        response = httpx.put(
            upload["signedUrl"] if "signedUrl" in upload else upload["signed_url"],
            content=handle.read(),
            headers={"content-type": "application/gzip"},
            timeout=600.0,
        )
    response.raise_for_status()

    manifest = summary["manifest"]
    fits = manifest.get("fits", {})
    registered = backend.call(
        "bundle.register",
        bundle_version=version,
        storage_path=slot["storage_path"],
        bundle_sha256=summary["bundle_sha256"],
        manifest=manifest,
        file_count=summary.get("file_count"),
        byte_size=summary.get("byte_size"),
        checkpoint_utc=manifest.get("checkpoint_utc"),
        last_processed_target_utc=manifest.get("last_processed_target_utc"),
        direction_fit_cutoff_utc=(fits.get("direction") or {}).get("cutoff_utc"),
        meta_fit_cutoff_utc=(fits.get("meta") or {}).get("cutoff_utc"),
        aux_fit_month=(fits.get("auxiliary") or {}).get("month"),
        source_watermarks=manifest.get("source_watermarks", {}),
        parity_report=manifest.get("parity_report", {}),
        build_sha=os.environ.get("C85_BUILD_SHA", ""),
        status="VERIFIED",
    )
    result = {"uploaded": slot["storage_path"], "registered": registered.get("bundle")}
    if activate:
        result["activated"] = backend.call("bundle.activate", bundle_version=version).get("bundle")
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("summary", type=Path, help="dist/c85-<version>.manifest.json")
    parser.add_argument("--activate", action="store_true")
    args = parser.parse_args()
    print(json.dumps(publish(args.summary, activate=args.activate), indent=2, default=str))


if __name__ == "__main__":
    main()
