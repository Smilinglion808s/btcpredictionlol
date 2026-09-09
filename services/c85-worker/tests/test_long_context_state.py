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


def _head() -> lc.LongContextHead:
    return lc.LongContextHead(features=list(FEATURES))


def _drive(head, rows):
    out = []
    previous = None
    for ts, row, label in rows:
        if previous is not None:
            head.settle_label(previous[0], previous[2])
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
    head.settle_label(ts, 1.0)
    head.settle_label(ts, 1.0)  # idempotent
    with pytest.raises(lc.LongContextOrderError, match="conflicting label"):
        head.settle_label(ts, -1.0)


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
    path = tmp_path / "state" / "state.json"
    path.write_text(path.read_text().replace(lc.HEAD_ID, "SOME_OTHER_HEAD"))
    with pytest.raises(lc.LongContextSchemaError, match="belongs to"):
        lc.LongContextHead.restore_state(tmp_path / "state")


def test_claimed_fit_without_model_bytes_refuses_to_resume(tmp_path):
    head = _head()
    _drive(head, _rows(3))
    head.export_state(tmp_path / "state")
    path = tmp_path / "state" / "state.json"
    path.write_text(path.read_text().replace('"fitted": false', '"fitted": true'))
    with pytest.raises(lc.LongContextSchemaError, match="model.joblib is absent"):
        lc.LongContextHead.restore_state(tmp_path / "state")


def test_export_is_atomic_over_an_existing_state(tmp_path):
    head = _head()
    _drive(head, _rows(3))
    head.export_state(tmp_path / "state")
    _drive(head, list(_rows(6))[3:])
    head.export_state(tmp_path / "state")
    assert sorted(p.name for p in tmp_path.iterdir()) == ["state"]
    assert lc.LongContextHead.restore_state(tmp_path / "state").position == head.position
