"""Focused tests for the parity checkpoint collector's recovery contract.

SYNTHETIC. These pin the *safety* rules - consistent capture, immutable
generations, manifest-last verification and strict resume identity - without
touching the running comparison or its numerical inputs. They are not a parity
result.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

for _var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_var, "1")

import numpy as np  # noqa: E402
import pytest  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import parity_checkpoint_collector as cc  # noqa: E402


def _write_pair(tmp: Path, probs: np.ndarray, *, block: int = 3,
                extra: dict | None = None) -> tuple[Path, Path]:
    npz = tmp / "parity_ckpt.npz"
    meta = tmp / "parity_ckpt.json"
    np.savez(npz, prob=probs)
    payload = {
        "block_index": block,
        "rows": int(probs.size),
        "prob_sha256": cc.sha256_array(probs),
        "fit_count": 2,
        "block_ts": "2026-03-18T00:15:00+00:00",
    }
    payload.update(extra or {})
    meta.write_text(json.dumps(payload))
    return npz, meta


def test_a_consistent_pair_is_captured(tmp_path):
    probs = np.linspace(0.1, 0.9, 32)
    npz, meta = _write_pair(tmp_path, probs)
    capture = cc.capture_consistent(npz, meta, attempts=2)
    assert capture["metadata"]["block_index"] == 3
    assert capture["prob_sha256"] == cc.sha256_array(probs)


def test_a_probability_prefix_that_disagrees_with_metadata_is_refused(tmp_path):
    probs = np.linspace(0.1, 0.9, 32)
    npz, meta = _write_pair(tmp_path, probs,
                            extra={"prob_sha256": "0" * 64})
    with pytest.raises(RuntimeError):
        cc.capture_consistent(npz, meta, attempts=2)


def test_a_mixed_generation_pair_is_refused(tmp_path):
    probs = np.linspace(0.1, 0.9, 32)
    npz, meta = _write_pair(tmp_path, probs)

    original = cc.read_metadata if hasattr(cc, "read_metadata") else None
    calls = {"n": 0}
    real_load = json.loads

    def shifting_loads(text, *args, **kwargs):
        payload = real_load(text, *args, **kwargs)
        if isinstance(payload, dict) and "block_index" in payload:
            calls["n"] += 1
            payload["block_index"] = 3 + calls["n"]  # every read differs
        return payload

    json.loads = shifting_loads
    try:
        with pytest.raises(RuntimeError):
            cc.capture_consistent(npz, meta, attempts=3)
    finally:
        json.loads = real_load
        assert original is original  # no state left behind


def test_a_generation_is_immutable_and_manifest_verified(tmp_path):
    probs = np.linspace(0.1, 0.9, 32)
    npz, meta = _write_pair(tmp_path, probs)
    capture = cc.capture_consistent(npz, meta, attempts=2)
    identity = {"frame": {"rows": 10}, "runtime": cc.runtime_identity()}

    root = tmp_path / "generations"
    generation = cc.write_generation(root, capture, identity, runner=None)
    manifest = cc.verify_generation(generation)
    assert manifest["files"]
    assert (generation / cc.MANIFEST).exists()

    with pytest.raises(FileExistsError):
        cc.write_generation(root, capture, identity, runner=None,
                            generation=generation.name)


def test_a_corrupted_payload_fails_verification(tmp_path):
    probs = np.linspace(0.1, 0.9, 32)
    npz, meta = _write_pair(tmp_path, probs)
    capture = cc.capture_consistent(npz, meta, attempts=2)
    identity = {"frame": {"rows": 10}, "runtime": cc.runtime_identity()}
    generation = cc.write_generation(tmp_path / "gens", capture, identity, runner=None)

    target = generation / "parity_ckpt.npz"
    target.write_bytes(target.read_bytes() + b"corruption")
    with pytest.raises(RuntimeError):
        cc.verify_generation(generation)


def test_a_missing_manifest_is_an_incomplete_generation(tmp_path):
    probs = np.linspace(0.1, 0.9, 32)
    npz, meta = _write_pair(tmp_path, probs)
    capture = cc.capture_consistent(npz, meta, attempts=2)
    identity = {"frame": {"rows": 10}, "runtime": cc.runtime_identity()}
    generation = cc.write_generation(tmp_path / "gens", capture, identity, runner=None)
    (generation / cc.MANIFEST).unlink()
    with pytest.raises(RuntimeError):
        cc.verify_generation(generation)


def test_resume_is_refused_on_any_identity_mismatch(tmp_path):
    probs = np.linspace(0.1, 0.9, 32)
    npz, meta = _write_pair(tmp_path, probs)
    capture = cc.capture_consistent(npz, meta, attempts=2)
    identity = {"frame": {"rows": 10, "schema_sha256": "a" * 64},
                "runtime": cc.runtime_identity()}
    generation = cc.write_generation(tmp_path / "gens", capture, identity, runner=None)

    assert cc.resume_contract(generation, identity)["resumable"] is True

    changed = json.loads(json.dumps(identity))
    changed["frame"]["schema_sha256"] = "b" * 64
    verdict = cc.resume_contract(generation, changed)
    assert verdict["resumable"] is False and verdict["mismatches"]
