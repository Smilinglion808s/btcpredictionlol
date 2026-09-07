"""Validate the worker's freshly constructed C51 inputs against the reference.

Fixture: `evaluation-fixtures/c51_reference_tail.parquet` — the last 900 rows of
the recovered C51 training grid (from C85_Ancestor_Recovery.zip
data/c51_training_frame.parquet) joined to the archived ledger's
direct_probability_green / primary_proposal / primary_probability_correct /
primary_directional_rank / primary_prediction.

The worker rebuilds the direction feature row and the meta feature row from raw
inputs, scores them with the INSTALLED historical states, and must reproduce the
reference probabilities to 1e-12 and the primary decisions exactly.
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from experts.c51 import (  # noqa: E402
    DIRECTION_FEATURES,
    PRIMARY_THRESHOLD,
    _apply_fitted_linear,
    build_meta_feature_row,
    direction_from_probability,
)
from experts.c51_state import C51StateStore  # noqa: E402

FIXTURE = Path(__file__).resolve().parents[1] / "evaluation-fixtures" / "c51_reference_tail.parquet"

pytestmark = pytest.mark.skipif(not FIXTURE.exists(), reason="C51 reference tail fixture missing")


@pytest.fixture(scope="module")
def frame() -> pd.DataFrame:
    return pd.read_parquet(FIXTURE)


@pytest.fixture(scope="module")
def store() -> C51StateStore:
    return C51StateStore()


def test_states_installed(store: C51StateStore) -> None:
    assert store.manifest["direction_states"] == 245
    assert store.manifest["meta_states"] == 216
    assert store.as_of == datetime(2026, 8, 31, 23, 45, tzinfo=timezone.utc)


def test_direction_probability_matches_reference(frame: pd.DataFrame, store: C51StateStore) -> None:
    worst = 0.0
    for _, row in frame.iterrows():
        if not bool(row["binance_complete"]):
            continue
        head = store.restore(row["ts"]).direction_head
        x = np.array([float(row.get(name, np.nan)) for name in head.feature_order], dtype=float)
        probability = _apply_fitted_linear(x, head.imputation, head.center, head.scale, head.coef, head.intercept)
        reference = float(row["ref_direct_probability_green"])
        if not np.isfinite(reference):
            continue
        worst = max(worst, abs(probability - reference))
    assert worst < 1e-12, worst


def test_meta_probability_and_primary_decision_match_reference(
    frame: pd.DataFrame, store: C51StateStore
) -> None:
    worst = 0.0
    decisions = 0
    for _, row in frame.iterrows():
        reference_direct = float(row["ref_direct_probability_green"])
        reference_meta = float(row["ref_primary_probability_correct"])
        if not (np.isfinite(reference_direct) and np.isfinite(reference_meta)):
            continue
        proposal = int(row["ref_primary_proposal"])
        if proposal == 0:
            continue
        state = store.restore(row["ts"])
        raw = row.to_dict()
        meta_row = build_meta_feature_row(raw, reference_direct, proposal)
        probability = state.meta_head.predict_proba(meta_row)
        worst = max(worst, abs(probability - reference_meta))

        rank = float(row["ref_primary_directional_rank"])
        if np.isfinite(rank):
            expected = int(row["ref_primary_prediction"])
            assert (proposal if rank >= PRIMARY_THRESHOLD else 0) == expected
            decisions += 1
    assert decisions > 100, decisions
    assert worst < 1e-12, worst


def test_proposal_construction_matches_reference(frame: pd.DataFrame) -> None:
    for _, row in frame.iterrows():
        direct = float(row["ref_direct_probability_green"])
        if not np.isfinite(direct):
            continue
        c42 = int(row["c42_prediction"] or 0)
        expected = c42 if c42 != 0 else direction_from_probability(direct)
        assert expected == int(row["ref_primary_proposal"])


def test_direction_feature_order_is_the_recovered_45(store: C51StateStore) -> None:
    head = store.restore(store.as_of).direction_head
    assert head.feature_order == list(DIRECTION_FEATURES)


def test_readiness_reports_pending_refits_not_a_missing_state(store: C51StateStore) -> None:
    readiness = store.readiness(datetime(2026, 9, 7, tzinfo=timezone.utc))
    assert readiness["pending_refits"] == 6
    assert readiness["ready"] is False
    assert any("C85_C51_STATE_STALE" in r for r in readiness["blocking_reasons"])
    # The old "no fitted state exists" claim must not reappear.
    assert not any("STATE_MISSING" in r for r in readiness["blocking_reasons"])
