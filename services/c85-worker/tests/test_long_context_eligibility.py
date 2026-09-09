"""Trainer-eligibility contract for the long-context head.

SYNTHETIC state tests. They pin *when* a fit may be certified and how staged
eligibility survives a restart. They say nothing about parity with the original
recorded probabilities, which is a separate reconstruction result.

The original grid constants are scaled down here (monkeypatched) purely so a
refit boundary is reachable in a unit test; the rules under test are the ones
the production constants drive.
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

FEATURES = [f"f{i}" for i in range(4)]
SMALL_MINIMUM = 8
SMALL_REFIT = 4
SMALL_WINDOW = 32


@pytest.fixture(autouse=True)
def small_grid(monkeypatch):
    monkeypatch.setattr(lc, "MINIMUM", SMALL_MINIMUM)
    monkeypatch.setattr(lc, "REFIT_EVERY", SMALL_REFIT)
    monkeypatch.setattr(lc, "WINDOW", SMALL_WINDOW)
    yield


def _rows(n: int, seed: int = 11):
    rng = np.random.default_rng(seed)
    start = pd.Timestamp("2026-01-01", tz="UTC")
    for i in range(n):
        values = rng.normal(size=len(FEATURES))
        yield (start + pd.Timedelta(minutes=15 * i),
               {f: float(v) for f, v in zip(FEATURES, values)},
               1.0 if i % 2 == 0 else -1.0)


def _head() -> lc.LongContextHead:
    return lc.LongContextHead(features=list(FEATURES))


def _settle(head, previous, as_of):
    head.settle_label(
        previous[0], previous[2],
        available_at=pd.Timestamp(previous[0]) + pd.Timedelta(minutes=15),
        as_of=pd.Timestamp(as_of),
    )


def _drive(head, rows, *, settle=True):
    """Advance the head causally: settle the previous target, then observe."""
    for index, (ts, row, _label) in enumerate(rows):
        if settle and index:
            _settle(head, rows[index - 1], ts)
        head.observe(ts, row)


def test_training_a_future_boundary_early_is_refused():
    head = _head()
    rows = list(_rows(SMALL_MINIMUM - 2))
    _drive(head, rows)
    assert head.position < SMALL_MINIMUM
    with pytest.raises(lc.LongContextTrainingRequired, match="not yet eligible"):
        head.train_ahead()


def test_a_fit_certified_after_more_rows_arrive_is_stale_and_rebuilt():
    head = _head()
    rows = list(_rows(SMALL_MINIMUM))
    _drive(head, rows)
    staged = head.train_ahead()
    assert staged is not None and staged.position == head.position
    snapshot = staged.snapshot
    assert snapshot is not None
    assert snapshot.last_position == head.position - 2  # last row has no label yet

    # A label that settles afterwards changes the entitled training inputs.
    _settle(head, rows[-1], rows[-1][0] + pd.Timedelta(minutes=15))
    rebuilt = head.training_snapshot(head.position)
    assert rebuilt.digest != snapshot.digest

    nxt = rows[-1][0] + pd.Timedelta(minutes=15)
    payload = dict(rows[-1][1])
    with pytest.raises(lc.LongContextTrainingRequired, match="stale"):
        head.prepare(nxt, payload)

    refreshed = head.train_ahead()
    assert refreshed is not None
    assert refreshed.snapshot is not None
    assert refreshed.snapshot.digest == rebuilt.digest
    update = head.prepare(nxt, payload)
    assert update.activate is refreshed
    assert update.commit() is not None


def test_a_no_fit_verdict_reopens_when_the_inputs_change():
    head = _head()
    rows = [(ts, row, 1.0) for ts, row, _ in _rows(SMALL_MINIMUM)]  # one class only
    _drive(head, rows)
    position = head.position
    assert head.train_ahead() is None
    first = head.training_snapshot(position)
    assert head._no_fit_positions[position] == first.digest

    # The same inputs stay ineligible - serving proceeds without a new fit.
    nxt = rows[-1][0] + pd.Timedelta(minutes=15)
    update = head.prepare(nxt, dict(rows[-1][1]))
    assert update.activate is None
    assert update.probability is None

    # A second class settles: the verdict must not persist.
    head.settle_label(rows[-1][0], -1.0,
                      available_at=rows[-1][0] + pd.Timedelta(minutes=15),
                      as_of=rows[-1][0] + pd.Timedelta(minutes=15))
    reopened = head.training_snapshot(position)
    assert reopened.digest != first.digest
    assert head._no_fit_positions.get(position) != reopened.digest


def test_restart_immediately_before_activation_keeps_the_staged_fit(tmp_path):
    head = _head()
    rows = list(_rows(SMALL_MINIMUM))
    _drive(head, rows)
    staged = head.train_ahead()
    assert staged is not None
    head.export_state(tmp_path / "state")

    restored = lc.LongContextHead.restore_state(tmp_path / "state")
    assert restored._staged_fit is not None
    assert restored._staged_fit.position == staged.position
    assert restored._staged_fit.fit_id == staged.fit_id
    assert restored._staged_fit.snapshot is not None
    assert restored._staged_fit.snapshot.digest == staged.snapshot.digest
    assert restored.training_snapshot(restored.position).digest == staged.snapshot.digest

    nxt = rows[-1][0] + pd.Timedelta(minutes=15)
    payload = dict(rows[-1][1])
    before = head.prepare(nxt, payload)
    after = restored.prepare(nxt, payload)
    assert after.probability == before.probability  # same decision after restart


def test_delayed_settlement_is_reflected_in_the_next_snapshot():
    head = _head()
    rows = list(_rows(SMALL_MINIMUM, seed=5))
    _drive(head, rows, settle=False)
    bare = head.training_snapshot(head.position)
    assert bare.training_rows == 0
    assert bare.unsettled_positions == len(rows)
    assert bare.label_watermark is None

    for index in range(len(rows) - 1):
        _settle(head, rows[index], rows[index + 1][0])
    settled = head.training_snapshot(head.position)
    assert settled.training_rows == len(rows) - 1
    assert settled.label_watermark == rows[-2][0].isoformat()
    assert settled.digest != bare.digest


def test_identical_duplicate_settlement_does_not_bump_the_version():
    head = _head()
    rows = list(_rows(4))
    _drive(head, rows, settle=False)
    ts, _row, label = rows[0]
    available = ts + pd.Timedelta(minutes=15)
    head.settle_label(ts, label, available_at=available, as_of=available)
    version = head.version
    head.settle_label(ts, label, available_at=available, as_of=available)
    assert head.version == version  # an in-flight prepared update stays valid


def test_a_label_before_its_candle_closes_is_refused():
    head = _head()
    rows = list(_rows(4))
    _drive(head, rows, settle=False)
    ts, _row, label = rows[0]
    early = ts + pd.Timedelta(minutes=14)
    with pytest.raises(lc.LongContextOrderError, match="candle closes"):
        head.settle_label(ts, label, available_at=early, as_of=early)


def test_a_foreign_label_source_is_refused():
    head = _head()
    rows = list(_rows(4))
    _drive(head, rows, settle=False)
    ts, _row, label = rows[0]
    available = ts + pd.Timedelta(minutes=15)
    with pytest.raises(lc.LongContextOrderError, match="not an original source"):
        head.settle_label(ts, label, available_at=available, as_of=available,
                          source="some_other_exchange")
