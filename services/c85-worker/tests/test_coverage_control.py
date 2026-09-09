"""Coverage-control precursor: rules, restart identity and registry wiring."""
from __future__ import annotations

import math
from pathlib import Path

import pytest

from src.experts import ExpertRegistry
from src.experts.coverage_control import (
    CoverageControlProducer,
    CoverageInputError,
    DirectionalPastRank,
)
from src.experts.coverage_providers import CoverageControlProvider, install


def row(index: int, **overrides):
    base = {
        "ts": f"2026-02-06T{index // 60:02d}:{index % 60:02d}:00+00:00",
        "candidate_t5_router_prediction": 1 if index % 3 else -1,
        "candidate_base_direction": 1,
        "candidate_prediction": 1,
        "candidate_stage": "T0" if index % 2 else "T5",
        "r2_probability_correct": 0.5 + (index % 7) / 100,
        "r2_base_probability_green": 0.6,
        "r4_probability_correct": 0.5 + (index % 5) / 100,
        "r4_base_direction": 1,
        "base_probability_green": 0.5 + (index % 11) / 200,
        "p_pf_context_logit": 0.5 + (index % 13) / 200,
        "external_direction": 1,
        "external_rank": (index % 100) / 100,
        "opening_direction": -1,
        "t5_input_complete": True,
        "label": 1,
    }
    base.update(overrides)
    return base


def test_rank_is_past_only_and_needs_minimum_history():
    ranker = DirectionalPastRank(lookback=4, minimum=2)
    assert math.isnan(ranker.observe(0.1, 1))
    assert math.isnan(ranker.observe(0.2, 1))
    assert ranker.observe(0.3, 1) == 1.0          # both priors are smaller
    assert ranker.observe(0.05, 1) == 0.0         # none smaller
    assert math.isnan(ranker.observe(0.5, 0))     # direction 0 is never ranked


def test_non_finite_values_are_neither_ranked_nor_remembered():
    ranker = DirectionalPastRank(lookback=4, minimum=1)
    ranker.observe(0.1, 1)
    assert math.isnan(ranker.observe(float("nan"), 1))
    assert len(ranker.history[1]) == 1


def test_missing_field_fails_closed_instead_of_imputing():
    producer = CoverageControlProducer()
    incomplete = row(0)
    del incomplete["external_rank"]
    with pytest.raises(CoverageInputError):
        producer.observe(incomplete)


def test_out_of_order_target_is_refused():
    producer = CoverageControlProducer()
    producer.observe(row(5))
    with pytest.raises(CoverageInputError):
        producer.observe(row(4))


def test_blend_uses_only_available_heads():
    producer = CoverageControlProducer()
    scored = producer.observe(row(1, r4_probability_correct=float("nan")))
    assert scored["reliability_blend_probability_correct"] == pytest.approx(
        scored["r2_adjusted_probability_correct"]
    )


def test_controller_starts_at_one_minus_target_and_only_refreshes_on_schedule():
    producer = CoverageControlProducer(coverages=(0.30,))
    controller = producer.controllers["cov30"]
    assert controller.threshold == pytest.approx(0.70)
    for index in range(200):
        producer.observe(row(index))
    # minimum_history is 384 opportunities: nothing has recalibrated yet.
    assert controller.threshold == pytest.approx(0.70)
    assert controller.seen == 200


def test_non_opportunity_rows_do_not_advance_the_controller():
    producer = CoverageControlProducer(coverages=(0.30,))
    producer.observe(row(0, label=0))
    assert producer.controllers["cov30"].seen == 0
    assert producer.observe(row(1))["opportunity"] is True
    assert producer.controllers["cov30"].seen == 1


def test_save_restore_resumes_with_identical_output(tmp_path: Path):
    rows = [row(index) for index in range(120)]
    straight = CoverageControlProducer()
    expected = [straight.observe(r) for r in rows]

    warm = CoverageControlProducer()
    for r in rows[:60]:
        warm.observe(r)
    state = tmp_path / "state.json"
    warm.save(state)
    resumed = CoverageControlProducer.restore(state)
    actual = [resumed.observe(r) for r in rows[60:]]
    assert actual == expected[60:]


def test_provider_persists_state_and_reports_honest_scope(tmp_path: Path):
    state = tmp_path / "coverage" / "state.json"
    provider = CoverageControlProvider(state)
    for index in range(10):
        provider.observe(row(index))
    assert state.exists()
    call = provider.call("cov30")
    assert call.name == "coverage_control:cov30"
    assert call.detail["stage"] in {"T0", "T5", "ABSTAIN"}

    reopened = CoverageControlProvider(state)
    assert reopened.restored is True
    assert reopened.producer.cursor == provider.producer.cursor
    status = reopened.status()
    assert status["kind"] == "precursor"
    assert status["targets_processed"] == 10
    assert "C37 balanced maturation" in status["not_covered"]


def test_precursor_registration_does_not_make_the_registry_connected(tmp_path: Path):
    registry = ExpertRegistry()
    install(registry, tmp_path / "state.json")
    assert "coverage_control" in registry.precursors
    assert registry.connected is False
    assert "c30" in registry.missing
