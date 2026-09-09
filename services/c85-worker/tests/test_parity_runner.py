"""Recovery contract of the hardened parity runner.

SYNTHETIC and small: a tiny frame with a scaled-down grid. These tests pin the
identity, coherence and resume rules, and prove that a verified resume produces
bit-identical probabilities to an uninterrupted run. They are not a parity
result against the archived ledger.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

for _var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_var, "1")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import pytest  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT))

import parity_runner as pr  # noqa: E402
from src.experts import long_context as lc  # noqa: E402

ROWS, FEATURES = 96, 4


@pytest.fixture()
def tiny(tmp_path, monkeypatch):
    """A tiny frame plus a scaled grid, written as the runner expects it."""

    monkeypatch.setattr(lc, "WINDOW", 32, raising=False)
    monkeypatch.setattr(lc, "MINIMUM", 16, raising=False)
    monkeypatch.setattr(lc, "REFIT_EVERY", 8, raising=False)
    names = [f"spot_ret_{i}m_bps" for i in range(FEATURES)]
    monkeypatch.setattr(lc, "feature_columns", lambda columns: names)

    rng = np.random.default_rng(4117)
    values = rng.normal(size=(ROWS, FEATURES))
    frame = pd.DataFrame(values, columns=names)
    frame["target_ts"] = pd.date_range("2026-01-01", periods=ROWS, freq="15min", tz="UTC")
    frame["binance_label"] = np.sign(values[:, 0] + 0.2 * rng.normal(size=ROWS))
    path = tmp_path / "frame.pkl"
    frame.to_pickle(path)
    return path, tmp_path / "state"


def test_identity_covers_every_input_the_walk_depends_on(tiny):
    frame_path, _state = tiny
    identity = pr.load_inputs(frame_path)["identity"]
    for key in ("frame_sha256", "input_hash_full", "timestamp_hash",
                "complete_mask_hash", "label_hash", "schema_hash",
                "hgb_params", "grid", "long_context_sha256", "runtime"):
        assert identity[key] is not None
    assert identity["grid"] == {"window": lc.WINDOW, "minimum": lc.MINIMUM,
                                "refit_every": lc.REFIT_EVERY}


def test_the_full_input_hash_sees_bytes_beyond_a_4mib_prefix():
    """The defect being fixed: a prefix hash cannot detect a late change."""

    big = np.zeros(1 << 20)  # 8 MiB
    before = pr.sha_array(big)
    big[-1] = 1.0
    assert pr.sha_array(big) != before
    assert pr.sha_array(big.reshape(2, -1)) != pr.sha_array(big)  # shape is bound in


def test_a_verified_resume_equals_an_uninterrupted_run(tiny):
    frame_path, state = tiny
    pr.run(frame_path, state / "full")
    full, full_meta = pr.read_checkpoint(state / "full")

    pr.run(frame_path, state / "split", max_blocks=3)
    partial, partial_meta = pr.read_checkpoint(state / "split")
    assert partial_meta["next_block_index"] < full_meta["next_block_index"]
    assert not np.array_equal(np.isfinite(partial), np.isfinite(full))

    pr.run(frame_path, state / "split")  # resume from the verified checkpoint
    resumed, resumed_meta = pr.read_checkpoint(state / "split")

    assert resumed_meta["next_block_index"] == full_meta["next_block_index"]
    assert resumed_meta["fit_count"] == full_meta["fit_count"]
    assert pr.sha_array(resumed) == pr.sha_array(full)


def test_validation_accepts_a_coherent_checkpoint(tiny):
    frame_path, state = tiny
    pr.run(frame_path, state, max_blocks=2)
    verdict = pr.validate_checkpoint(state, pr.load_inputs(frame_path))
    assert verdict["resumable"] is True and verdict["problems"] == []
    assert "NOT SERIALISED" in verdict["model_recovery"]


def test_a_mixed_pair_is_detected_by_the_recorded_npz_digest(tiny):
    frame_path, state = tiny
    pr.run(frame_path, state, max_blocks=2)
    probability, _meta = pr.read_checkpoint(state)

    # Simulate the writer replacing the NPZ after the JSON was captured.
    later = probability.copy()
    later[0] = 0.123
    np.savez(state / pr.CKPT_NPZ, probability=later)
    with pytest.raises(pr.ParityResumeError, match="spans different blocks"):
        pr.read_checkpoint(state)


def test_a_tampered_prefix_digest_refuses_resume(tiny):
    frame_path, state = tiny
    pr.run(frame_path, state, max_blocks=2)
    meta = json.loads((state / pr.CKPT_META).read_text())
    meta["probability_prefix_sha256"] = "0" * 64
    (state / pr.CKPT_META).write_text(json.dumps(meta))

    verdict = pr.validate_checkpoint(state, pr.load_inputs(frame_path))
    assert verdict["resumable"] is False
    assert "probability_prefix_sha256" in verdict["problems"]
    with pytest.raises(pr.ParityResumeError):
        pr.run(frame_path, state)


def test_every_identity_field_gates_the_resume(tiny):
    frame_path, state = tiny
    pr.run(frame_path, state, max_blocks=2)
    inputs = pr.load_inputs(frame_path)

    for field in ("frame_sha256", "rows", "schema_hash", "input_hash_full",
                  "timestamp_hash", "complete_mask_hash", "label_hash",
                  "hgb_params", "grid", "long_context_sha256", "runtime"):
        changed = json.loads(json.dumps(inputs["identity"], default=str))
        changed[field] = "changed"
        assert pr.identity_mismatches(
            json.loads(json.dumps(inputs["identity"], default=str)), changed) == [field]


def test_a_changed_input_value_refuses_resume_and_never_restarts_silently(tiny, tmp_path):
    frame_path, state = tiny
    pr.run(frame_path, state, max_blocks=2)

    frame = pd.read_pickle(frame_path)
    frame.iloc[-1, 0] = frame.iloc[-1, 0] + 1.0  # a late value a prefix hash would miss
    frame.to_pickle(frame_path)

    with pytest.raises(pr.ParityResumeError, match="cannot be resumed"):
        pr.run(frame_path, state)

    # An intentional restart is explicit, and it is logged as such.
    result = pr.run(frame_path, state, restart=True, max_blocks=1)
    assert result["blocks_done"] == 1


def test_a_truncated_probability_array_is_refused(tiny):
    frame_path, state = tiny
    pr.run(frame_path, state, max_blocks=2)
    probability, meta = pr.read_checkpoint(state)

    np.savez(state / pr.CKPT_NPZ, probability=probability[:-1])
    meta["npz_sha256"] = pr.sha_file(state / pr.CKPT_NPZ)
    (state / pr.CKPT_META).write_text(json.dumps(meta))

    verdict = pr.validate_checkpoint(state, pr.load_inputs(frame_path))
    assert verdict["resumable"] is False
    assert any(p.startswith("shape:") for p in verdict["problems"])


def test_probabilities_beyond_the_checkpoint_are_refused(tiny):
    """A checkpoint may not carry scores its block index does not cover."""

    frame_path, state = tiny
    pr.run(frame_path, state, max_blocks=2)
    probability, meta = pr.read_checkpoint(state)
    probability[-1] = 0.5
    np.savez(state / pr.CKPT_NPZ, probability=probability)
    meta["npz_sha256"] = pr.sha_file(state / pr.CKPT_NPZ)
    meta["probability_full_sha256"] = pr.sha_array(probability)
    (state / pr.CKPT_META).write_text(json.dumps(meta))

    verdict = pr.validate_checkpoint(state, pr.load_inputs(frame_path))
    assert verdict["resumable"] is False
    assert any(p.startswith("probability_beyond_checkpoint") for p in verdict["problems"])
