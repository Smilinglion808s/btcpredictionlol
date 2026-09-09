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


def _drive(head, rows, *, settle=True, settle_last=True):
    """Advance the head causally: settle the previous target, then observe.

    ``settle_last`` also settles the final observed row, whose candle closes at
    the boundary timestamp. Without it the boundary's entitled window is not
    resolved and training must fail closed - that is a separate test.
    """
    for index, (ts, row, _label) in enumerate(rows):
        if settle and index:
            _settle(head, rows[index - 1], ts)
        head.observe(ts, row)
    if settle and settle_last and rows:
        _settle(head, rows[-1], rows[-1][0] + pd.Timedelta(minutes=15))


def test_training_a_future_boundary_early_is_refused():
    head = _head()
    rows = list(_rows(SMALL_MINIMUM - 2))
    _drive(head, rows)
    assert head.position < SMALL_MINIMUM
    with pytest.raises(lc.LongContextTrainingRequired, match="not yet eligible"):
        head.train_ahead()


def test_a_fit_certified_after_more_rows_arrive_is_stale_and_rebuilt():
    head = _head()
    rows = list(_rows(3 * SMALL_REFIT))
    _drive(head, rows)
    staged = head.train_ahead()
    assert staged is not None and staged.position == head.position
    snapshot = staged.snapshot
    assert snapshot is not None
    assert snapshot.last_position == head.position - 1  # the full window is resolved
    assert snapshot.complete is True
    assert snapshot.unresolved_positions == ()

    # A newly evidenced source gap changes the entitled training inputs.
    gap_ts = rows[-2][0]
    head._labels_by_ts.pop(gap_ts, None)
    head._label_available_at.pop(gap_ts, None)
    next(r for r in head.buffer if r.ts == gap_ts).label = float("nan")
    head.settle_missing_label(gap_ts, available_at=gap_ts + pd.Timedelta(minutes=15),
                              as_of=gap_ts + pd.Timedelta(minutes=15),
                              reason="spot_1m coverage gap over the settling candle")
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

    # A second class appears: the verdict must not persist.
    corrected = rows[-1][0]
    head._labels_by_ts.pop(corrected, None)
    head._label_available_at.pop(corrected, None)
    next(r for r in head.buffer if r.ts == corrected).label = float("nan")
    head.settle_label(corrected, -1.0,
                      available_at=corrected + pd.Timedelta(minutes=15),
                      as_of=corrected + pd.Timedelta(minutes=15))
    reopened = head.training_snapshot(position)
    assert reopened.digest != first.digest
    assert head._no_fit_positions.get(position) != reopened.digest


def test_restart_immediately_before_activation_keeps_the_staged_fit(tmp_path):
    head = _head()
    rows = list(_rows(3 * SMALL_REFIT))
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


def _boundary_rows():
    """Rows up to a refit boundary, with the boundary's final label pending."""
    head = _head()
    rows = list(_rows(3 * SMALL_REFIT, seed=7))
    _drive(head, rows, settle_last=False)
    return head, rows


def test_a_pending_final_label_blocks_the_fit_instead_of_shortening_it():
    head, rows = _boundary_rows()
    with pytest.raises(lc.LongContextTrainingRequired, match="not resolved"):
        head.train_ahead()
    snapshot = head.training_snapshot(head.position)
    assert snapshot.complete is False
    assert snapshot.unresolved_positions == (head.position - 1,)
    assert head._no_fit_positions == {}  # no verdict was recorded on partial inputs

    conflict = head.scheduling_conflict()
    assert conflict["complete"] is False
    assert conflict["earliest_complete_fit_start"] == (
        rows[-1][0] + pd.Timedelta(minutes=15)).isoformat()


def test_the_final_label_still_absent_at_activation_refuses_to_serve():
    head, rows = _boundary_rows()
    with pytest.raises(lc.LongContextTrainingRequired):
        head.train_ahead()
    nxt = rows[-1][0] + pd.Timedelta(minutes=15)
    with pytest.raises(lc.LongContextTrainingRequired, match="no fit was staged"):
        head.prepare(nxt, dict(rows[-1][1]))


def test_the_final_label_arriving_before_activation_makes_the_fit_eligible():
    head, rows = _boundary_rows()
    with pytest.raises(lc.LongContextTrainingRequired):
        head.train_ahead()
    _settle(head, rows[-1], rows[-1][0] + pd.Timedelta(minutes=15))
    staged = head.train_ahead()
    assert staged is not None and staged.snapshot.complete is True
    nxt = rows[-1][0] + pd.Timedelta(minutes=15)
    update = head.prepare(nxt, dict(rows[-1][1]))
    assert update.activate is staged
    assert update.commit() is not None


def test_an_evidenced_source_gap_resolves_the_window_a_pending_label_does_not():
    head, rows = _boundary_rows()
    ts = rows[-1][0]
    head.settle_missing_label(ts, available_at=ts + pd.Timedelta(minutes=15),
                              as_of=ts + pd.Timedelta(minutes=15),
                              reason="spot_1m not contiguous over the settling candle")
    snapshot = head.training_snapshot(head.position)
    assert snapshot.complete is True
    assert snapshot.missing_source_positions == 1
    assert head.train_ahead() is not None


def test_the_staged_fit_equals_a_batch_fit_over_the_same_eligible_window():
    """SYNTHETIC reference check: the certified window is the batch window."""
    head = _head()
    rows = list(_rows(3 * SMALL_REFIT, seed=13))
    _drive(head, rows)
    staged = head.train_ahead()
    assert staged is not None

    eligible = [r for r in head.buffer
                if r.complete and np.isfinite(r.label) and r.label != 0]
    assert len(eligible) == staged.snapshot.training_rows
    x = np.vstack([r.values for r in eligible])
    y = np.asarray([1 if r.label > 0 else 0 for r in eligible], dtype=np.int8)
    reference = lc._new_model()
    reference.fit(x, y, sample_weight=lc.day_balanced_weights(
        pd.Series([r.ts for r in eligible])))
    probe = x[:5]
    assert np.array_equal(reference.predict_proba(probe), staged.model.predict_proba(probe))


def test_the_fit_uses_the_captured_rows_its_digest_certifies():
    """A label settling during the fit cannot change what the model saw."""
    head = _head()
    rows = list(_rows(3 * SMALL_REFIT, seed=17))
    _drive(head, rows)
    victim = rows[-1][0]

    from sklearn.ensemble import HistGradientBoostingClassifier
    original_fit = HistGradientBoostingClassifier.fit

    def racing_fit(self, X, y, sample_weight=None):
        # A concurrent correction arrives mid-fit.
        head._labels_by_ts.pop(victim, None)
        head._label_available_at.pop(victim, None)
        for r in head.buffer:
            if r.ts == victim:
                r.label = float("nan")
        return original_fit(self, X, y, sample_weight=sample_weight)

    HistGradientBoostingClassifier.fit = racing_fit
    try:
        staged = head.train_ahead()
    finally:
        HistGradientBoostingClassifier.fit = original_fit

    assert staged is not None
    assert staged.training_rows == staged.snapshot.training_rows
    # The head has moved on, so the certified fit is now correctly stale.
    assert head.training_snapshot(head.position).digest != staged.snapshot.digest


def test_label_values_outside_the_recovered_domain_are_refused():
    head = _head()
    rows = list(_rows(4))
    _drive(head, rows, settle=False)
    ts = rows[0][0]
    available = ts + pd.Timedelta(minutes=15)
    for bad in (0.5, 2.0, -3.0, float("nan")):
        with pytest.raises(lc.LongContextOrderError, match="outside the recovered"):
            head.settle_label(ts, bad, available_at=available, as_of=available)
    head.settle_label(ts, 0.0, available_at=available, as_of=available)  # PUSH is in-domain
    assert head._labels_by_ts[ts] == 0.0


def test_a_push_row_is_resolved_but_never_trained_on():
    head = _head()
    rows = list(_rows(3 * SMALL_REFIT, seed=23))
    _drive(head, rows, settle_last=False)
    ts = rows[-1][0]
    head.settle_label(ts, 0.0, available_at=ts + pd.Timedelta(minutes=15),
                      as_of=ts + pd.Timedelta(minutes=15))
    snapshot = head.training_snapshot(head.position)
    assert snapshot.complete is True and snapshot.push_positions == 1
    assert all(r.pos != head.position - 1
               for r in head._capture(head.position)[0])


def test_nat_timestamps_are_refused():
    head = _head()
    rows = list(_rows(4))
    _drive(head, rows, settle=False)
    ts = rows[0][0]
    available = ts + pd.Timedelta(minutes=15)
    with pytest.raises(lc.LongContextOrderError, match="NaT"):
        head.settle_label(pd.NaT, 1.0, available_at=available, as_of=available)
    with pytest.raises(lc.LongContextOrderError, match="NaT"):
        head.settle_label(ts, 1.0, available_at=pd.NaT, as_of=available)
    with pytest.raises(lc.LongContextOrderError, match="NaT"):
        head.settle_label(ts, 1.0, available_at=available, as_of=pd.NaT)


def test_the_snapshot_digest_binds_label_provenance():
    """Same label values, different receipt evidence -> different certification."""
    head = _head()
    rows = list(_rows(3 * SMALL_REFIT, seed=29))
    _drive(head, rows)
    first = head.training_snapshot(head.position)

    retained = head.buffer[-1].ts
    head._label_available_at[retained] = (
        head._label_available_at[retained] + "|late_replay")
    second = head.training_snapshot(head.position)

    assert second.training_rows == first.training_rows
    assert second.provenance_digest != first.provenance_digest
    assert second.digest != first.digest
