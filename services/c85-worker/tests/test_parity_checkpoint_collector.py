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

REFIT = 8


def _identity(**over):
    identity = {
        "rows": 64,
        "features": 3,
        "schema_hash": "a" * 64,
        "input_hash_full": "b" * 64,
        "timestamp_hash": "c" * 64,
        "complete_mask_hash": "d" * 64,
        "label_hash": "e" * 64,
        "frame_sha256": "f" * 64,
        "config": {"refit_every": REFIT},
        "runtime": cc.runtime_identity(),
        "refit_every": REFIT,
    }
    identity.update(over)
    return identity


def _write_pair(tmp: Path, *, block_start: int = 16, scored: int = 24,
                prefix_sha: str | None = None) -> tuple[Path, Path, np.ndarray]:
    probability = np.full(64, np.nan)
    probability[:scored] = np.linspace(0.2, 0.8, scored)
    npz = tmp / "parity_ckpt.npz"
    meta = tmp / "parity_ckpt.json"
    np.savez(npz, probability=probability)
    end = min(block_start + REFIT, probability.size)
    payload = {
        "next_block_index": block_start // REFIT,
        "block_start": block_start,
        "block_ts": "2026-03-18T00:15:00+00:00",
        "fit_count": 2,
        "first_fit": 0,
        "last_fit_block": block_start,
        "identity": {"refit_every": REFIT},
        "probability_prefix_sha256": prefix_sha or cc.sha256_array(probability[:end]),
    }
    meta.write_text(json.dumps(payload))
    return npz, meta, probability


def test_a_consistent_pair_is_captured(tmp_path):
    npz, meta, probability = _write_pair(tmp_path)
    capture = cc.capture_consistent(npz, meta, attempts=2, pause=0)
    assert capture["meta"]["block_start"] == 16
    assert capture["probability_full_sha256"] == cc.sha256_array(probability)
    assert capture["scored_rows"] == 24


def test_a_probability_prefix_that_disagrees_with_metadata_is_refused(tmp_path):
    npz, meta, _ = _write_pair(tmp_path, prefix_sha="0" * 64)
    with pytest.raises(RuntimeError, match="probability prefix"):
        cc.capture_consistent(npz, meta, attempts=2, pause=0)


def test_a_mixed_generation_pair_is_refused(tmp_path):
    """Metadata replaced while the NPZ is being read must never be accepted."""

    npz, meta, _ = _write_pair(tmp_path)
    real_read = Path.read_bytes
    state = {"n": 0}

    def racing_read(self, *args, **kwargs):
        data = real_read(self, *args, **kwargs)
        if self.name.endswith(".json"):
            state["n"] += 1
            payload = json.loads(data)
            payload["fit_count"] = state["n"]  # a new writer generation each read
            return json.dumps(payload).encode()
        return data

    Path.read_bytes = racing_read
    try:
        with pytest.raises(RuntimeError, match="metadata changed"):
            cc.capture_consistent(npz, meta, attempts=3, pause=0)
    finally:
        Path.read_bytes = real_read


def test_a_generation_is_immutable_and_manifest_verified(tmp_path):
    npz, meta, _ = _write_pair(tmp_path)
    capture = cc.capture_consistent(npz, meta, attempts=2, pause=0)
    generation = cc.write_generation(tmp_path / "gens", capture, _identity())

    manifest = cc.verify_generation(generation)
    assert set(manifest["files"]) == {"parity_ckpt.npz", "parity_ckpt.json", "checkpoint.json"}
    assert (generation / cc.MANIFEST).exists()

    record = json.loads((generation / "checkpoint.json").read_text())
    assert "NOT SERIALISED" in record["model_recovery"]  # refit-reconstructed, labelled

    with pytest.raises(FileExistsError):
        cc.write_generation(generation.parent, capture, _identity())


def test_a_corrupted_payload_fails_verification(tmp_path):
    npz, meta, _ = _write_pair(tmp_path)
    capture = cc.capture_consistent(npz, meta, attempts=2, pause=0)
    generation = cc.write_generation(tmp_path / "gens", capture, _identity())

    target = generation / "parity_ckpt.npz"
    target.write_bytes(target.read_bytes() + b"corruption")
    with pytest.raises(RuntimeError, match="manifest digest"):
        cc.verify_generation(generation)


def test_a_missing_manifest_is_an_incomplete_generation(tmp_path):
    npz, meta, _ = _write_pair(tmp_path)
    capture = cc.capture_consistent(npz, meta, attempts=2, pause=0)
    generation = cc.write_generation(tmp_path / "gens", capture, _identity())
    (generation / cc.MANIFEST).unlink()
    with pytest.raises(RuntimeError, match="incomplete or mixed"):
        cc.verify_generation(generation)


def test_resume_is_refused_on_any_identity_mismatch(tmp_path):
    npz, meta, _ = _write_pair(tmp_path)
    capture = cc.capture_consistent(npz, meta, attempts=2, pause=0)
    generation = cc.write_generation(tmp_path / "gens", capture, _identity())

    assert cc.resume_contract(generation, _identity())["resumable"] is True

    for field in ("rows", "schema_hash", "input_hash_full", "timestamp_hash",
                  "complete_mask_hash", "label_hash", "frame_sha256"):
        verdict = cc.resume_contract(generation, _identity(**{field: "9" * 64}))
        assert verdict["resumable"] is False and verdict["mismatches"] == [field]

    runtime = dict(cc.runtime_identity())
    runtime["numpy"] = "0.0.0"
    verdict = cc.resume_contract(generation, _identity(runtime=runtime))
    assert verdict["resumable"] is False and "runtime" in verdict["mismatches"]


def test_resume_is_refused_when_the_probabilities_were_swapped(tmp_path):
    npz, meta, _ = _write_pair(tmp_path)
    capture = cc.capture_consistent(npz, meta, attempts=2, pause=0)
    generation = cc.write_generation(tmp_path / "gens", capture, _identity())

    swapped = np.full(64, 0.5)
    np.savez(generation / "parity_ckpt.npz", probability=swapped)
    # Re-stamp the manifest so only the probability identity is wrong.
    manifest = json.loads((generation / cc.MANIFEST).read_text())
    path = generation / "parity_ckpt.npz"
    manifest["files"]["parity_ckpt.npz"] = {
        "bytes": path.stat().st_size, "sha256": cc.sha256_file(path)}
    (generation / cc.MANIFEST).write_text(json.dumps(manifest))

    verdict = cc.resume_contract(generation, _identity())
    assert verdict["resumable"] is False
    assert "probability_full_sha256" in verdict["mismatches"]
