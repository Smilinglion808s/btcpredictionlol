"""Restart, ordering and idempotency contract for the long-context head.

These are *state* tests on synthetic rows. They say nothing about parity with
the original recorded probabilities, which still requires the missing
`long_context_features.pkl` and the missing fitted head.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

for _var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_var, "1")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import pytest  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.experts import long_context as lc  # noqa: E402

FEATURES = [f"f{i}" for i in range(6)]


def _rows(n: int, seed: int = 3):
    rng = np.random.default_rng(seed)
    start = pd.Timestamp("2026-01-01", tz="UTC")
    for i in range(n):
        values = rng.normal(size=len(FEATURES))
        yield (start + pd.Timedelta(minutes=15 * i),
               {f: float(v) for f, v in zip(FEATURES, values)},
               float(np.sign(values[0]) or 1.0))


def _rewrite(path, text):
    """Rewrite a state file *and* its manifest digest, so the test exercises the
    schema check rather than the tamper check."""
    import hashlib
    import json

    path.write_text(text)
    manifest_path = path.parent / "MANIFEST.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["files"][path.name]["sha256"] = hashlib.sha256(text.encode()).hexdigest()
    manifest["files"][path.name]["bytes"] = len(text.encode())
    manifest_path.write_text(json.dumps(manifest, indent=1))


def _head() -> lc.LongContextHead:
    return lc.LongContextHead(features=list(FEATURES))


def _settle(head, previous, as_of):
    head.settle_label(
        previous[0], previous[2],
        available_at=pd.Timestamp(previous[0]) + pd.Timedelta(minutes=15),
        as_of=pd.Timestamp(as_of),
    )


def _drive(head, rows):
    out = []
    previous = None
    for ts, row, label in rows:
        if previous is not None:
            _settle(head, previous, ts)
        out.append(head.observe(ts, row))
        previous = (ts, row, label)
    return out


def test_restart_resumes_the_same_grid_and_outputs(tmp_path):
    rows = list(_rows(40))
    uninterrupted = _drive(_head(), rows)

    head = _head()
    first = _drive(head, rows[:25])
    head.export_state(tmp_path / "state")
    resumed = lc.LongContextHead.restore_state(tmp_path / "state")
    # The restored head must continue the sequence, not restart it.
    assert resumed.position == head.position
    assert resumed.state_summary() == head.state_summary()

    rest = _drive(resumed, rows[25:])
    # `_drive` settles the previous row's label on entry; feed the boundary one.
    assert first + rest == uninterrupted


def test_repeat_observation_is_a_retry_not_a_second_target():
    head = _head()
    rows = list(_rows(5))
    _drive(head, rows)
    position = head.position
    last_ts, last_row, _ = rows[-1]

    assert head.observe(last_ts, last_row) is head._last_probability
    assert head.position == position
    assert len(head.buffer) == len(rows)


def test_out_of_order_target_is_refused():
    head = _head()
    rows = list(_rows(4))
    _drive(head, rows)
    earlier_ts, earlier_row, _ = rows[1]
    with pytest.raises(lc.LongContextOrderError, match="precedes the last observed"):
        head.observe(earlier_ts, earlier_row)


def test_conflicting_label_resettlement_is_refused_but_repeats_are_fine():
    head = _head()
    rows = list(_rows(3))
    _drive(head, rows)
    ts = rows[0][0]
    later = rows[-1][0]
    available = pd.Timestamp(ts) + pd.Timedelta(minutes=15)
    head.settle_label(ts, 1.0, available_at=available, as_of=later)
    head.settle_label(ts, 1.0, available_at=available, as_of=later)  # idempotent
    with pytest.raises(lc.LongContextOrderError, match="conflicting label"):
        head.settle_label(ts, -1.0, available_at=available, as_of=later)


def test_label_that_the_source_has_not_published_is_refused():
    head = _head()
    rows = list(_rows(3))
    _drive(head, rows)
    ts = rows[0][0]
    available = pd.Timestamp(ts) + pd.Timedelta(minutes=15)
    with pytest.raises(lc.LongContextOrderError, match="not available until"):
        head.settle_label(ts, 1.0, available_at=available, as_of=pd.Timestamp(ts))


def test_label_for_an_unobserved_target_is_refused():
    head = _head()
    rows = list(_rows(3))
    _drive(head, rows)
    future = rows[-1][0] + pd.Timedelta(minutes=15)
    available = future + pd.Timedelta(minutes=15)
    with pytest.raises(lc.LongContextOrderError, match="precedes any observed target"):
        head.settle_label(future, 1.0, available_at=available, as_of=available)


def test_same_target_with_a_different_payload_is_a_conflict_not_a_retry():
    head = _head()
    rows = list(_rows(3))
    _drive(head, rows)
    ts, row, _ = rows[-1]
    altered = dict(row)
    altered["f0"] = float(altered["f0"]) + 1.0
    with pytest.raises(lc.LongContextConflict):
        head.prepare(ts, altered)


def test_prepare_does_not_move_the_head_until_commit():
    head = _head()
    rows = list(_rows(4))
    _drive(head, rows[:3])
    before = head.state_summary()
    update = head.prepare(rows[3][0], rows[3][1])
    assert head.state_summary() == before
    update.commit()
    assert head.position == before["position"] + 1
    with pytest.raises(lc.LongContextFenceError):
        update.commit()


def test_rolled_back_update_leaves_the_head_untouched():
    head = _head()
    rows = list(_rows(4))
    _drive(head, rows[:3])
    before = head.state_summary()
    head.prepare(rows[3][0], rows[3][1]).rollback()
    assert head.state_summary() == before


def test_a_stale_update_cannot_commit_after_the_head_advanced():
    head = _head()
    rows = list(_rows(5))
    _drive(head, rows[:3])
    stale = head.prepare(rows[3][0], rows[3][1])
    head.observe(rows[3][0], rows[3][1])
    with pytest.raises(lc.LongContextFenceError):
        stale.commit()


def test_export_activation_survives_an_interrupted_generation(tmp_path):
    head = _head()
    _drive(head, _rows(3))
    head.export_state(tmp_path / "state")
    good = (tmp_path / "state" / "CURRENT").read_text()
    # a crash mid-export leaves an unreferenced staging directory behind
    (tmp_path / "state" / "generations" / ".staging-crashed").mkdir()
    restored = lc.LongContextHead.restore_state(tmp_path / "state")
    assert restored.position == head.position
    assert (tmp_path / "state" / "CURRENT").read_text() == good


def test_tampered_state_bytes_are_refused_before_deserialisation(tmp_path):
    head = _head()
    _drive(head, _rows(3))
    head.export_state(tmp_path / "state")
    generation = (tmp_path / "state" / "generations"
                  / (tmp_path / "state" / "CURRENT").read_text().strip())
    buffer_path = generation / "buffer.npz"
    buffer_path.write_bytes(buffer_path.read_bytes() + b"junk")
    with pytest.raises(lc.LongContextSchemaError, match="digest mismatch"):
        lc.LongContextHead.restore_state(tmp_path / "state")


def test_pending_labels_stay_bounded_by_the_window(monkeypatch):
    monkeypatch.setattr(lc, "WINDOW", 10)
    head = _head()
    _drive(head, _rows(60))
    assert len(head.buffer) == 10
    # The label map must not grow with history.
    assert len(head._labels_by_ts) <= 10


def test_state_from_a_different_head_is_refused(tmp_path):
    head = _head()
    _drive(head, _rows(3))
    head.export_state(tmp_path / "state")
    path = (tmp_path / "state" / "generations"
            / (tmp_path / "state" / "CURRENT").read_text().strip() / "state.json")
    _rewrite(path, path.read_text().replace(lc.HEAD_ID, "SOME_OTHER_HEAD"))
    with pytest.raises(lc.LongContextSchemaError, match="belongs to"):
        lc.LongContextHead.restore_state(tmp_path / "state")


def test_claimed_fit_without_model_bytes_refuses_to_resume(tmp_path):
    head = _head()
    _drive(head, _rows(3))
    head.export_state(tmp_path / "state")
    path = (tmp_path / "state" / "generations"
            / (tmp_path / "state" / "CURRENT").read_text().strip() / "state.json")
    _rewrite(path, path.read_text().replace('"fitted": false', '"fitted": true'))
    with pytest.raises(lc.LongContextSchemaError, match="model.joblib"):
        lc.LongContextHead.restore_state(tmp_path / "state")


def test_export_is_atomic_over_an_existing_state(tmp_path):
    head = _head()
    _drive(head, _rows(3))
    head.export_state(tmp_path / "state")
    _drive(head, list(_rows(6))[3:])
    head.export_state(tmp_path / "state")
    assert sorted(p.name for p in tmp_path.iterdir()) == ["state"]
    assert (tmp_path / "state" / "CURRENT").exists()
    assert lc.LongContextHead.restore_state(tmp_path / "state").position == head.position
