"""External-direction head: causal fit selection, preprocessing, and wiring.

Parity scope is stated per test and never overstated:

  * ``DERIVED-MATRIX PARITY`` - archived multivenue observations are pushed
    through this module and compared against the original fitting pipeline's own
    output on the same rows. This proves preprocessing, feature order, class
    orientation and phase selection, and nothing about the raw producers.
  * ``WIRING`` - the Binance/Hyperliquid accumulators are connected to the head
    and shown to produce the same result single-target, chronologically and
    across a restart. The authentic raw samples on hand (January Binance,
    mid-August Hyperliquid) do not both overlap one scheduled fit window, so
    these are contract tests, NOT an end-to-end raw parity claim.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.experts.binance_windows import BinanceWindowAccumulator  # noqa: E402
from src.experts.external_direction import (  # noqa: E402
    DEFAULT_FITS_DIR,
    ExternalDirectionExpert,
    ExternalDirectionModel,
    ExternalDirectionUnavailable,
)
from src.experts.hyperliquid_context import HyperliquidContextAccumulator  # noqa: E402

CACHE = Path("/mnt/documents/.lovable/c85-cache/upx")
MULTI = (CACHE / "upstream/vault_work/legacy_lab2/sources"
         / "T0_T5_MULTIVENUE_LAB_R1_COMPACT.zip__expanded")


@pytest.fixture(scope="module")
def model():
    if not (DEFAULT_FITS_DIR / "refit_report.json").exists():
        pytest.skip("external-direction fits not present; run tools/refit_external_direction.py")
    return ExternalDirectionModel.load()


@pytest.fixture(scope="module")
def observations():
    binance = MULTI / "features/binance_event_features.csv.gz"
    hyper = MULTI / "features/hyperliquid_context_features.csv.gz"
    if not (binance.exists() and hyper.exists()):
        pytest.skip("archived multivenue observation files not present")
    left = pd.read_csv(binance, parse_dates=["target_ts"])
    right = pd.read_csv(hyper, parse_dates=["target_ts"])
    frame = left.merge(right, on="target_ts", how="inner").rename(columns={"target_ts": "ts"})
    frame["ts"] = pd.to_datetime(frame["ts"], utc=True)
    return frame.sort_values("ts").reset_index(drop=True)


# -- causal fit selection ---------------------------------------------------
def test_each_phase_scores_only_its_own_scheduled_window(model):
    for stage in ("T0", "T5"):
        phases = model.fits[stage]
        assert [p.phase for p in phases] == ["feb_apr", "may_jun", "jul_aug"]
        for fit in phases:
            # A fit never sees the outcomes of the targets it scores.
            assert fit.train_end <= fit.scores_from
            inside = fit.scores_from + pd.Timedelta(hours=1)
            assert model.phase_for(stage, inside) is fit


def test_a_target_after_the_last_scheduled_window_has_no_fit_not_the_newest_one(model):
    """September targets are a REPORTED blocker, not a stretched July fit."""
    with pytest.raises(ExternalDirectionUnavailable, match="no T5 fit is scheduled"):
        model.phase_for("T5", pd.Timestamp("2026-09-03T12:00:00Z"))


def test_a_target_before_the_first_window_is_refused_too(model):
    with pytest.raises(ExternalDirectionUnavailable):
        model.phase_for("T0", pd.Timestamp("2026-01-05T00:00:00Z"))


# -- DERIVED-MATRIX PARITY --------------------------------------------------
@pytest.mark.parametrize("stage", ["T0", "T5"])
def test_scores_match_the_fitted_pipeline_applied_to_the_original_matrix(model, stage,
                                                                        observations):
    """Row-by-row equality against the pipeline's own batch output.

    Same artifact, same rows: this isolates THIS module's row assembly, feature
    reindexing and class orientation. It makes no claim about raw producers.
    """
    from src.experts.direction_matrix import SOURCE_SETS, directional_matrix

    fit = model.fits[stage][-1]                       # jul_aug
    window = observations.loc[
        (observations["ts"] >= fit.scores_from) & (observations["ts"] < fit.scores_until)
    ].head(200).reset_index(drop=True)
    if window.empty:
        pytest.skip("no archived observations inside the jul_aug window")

    batch = directional_matrix(window, SOURCE_SETS[fit.source_set], stage)
    expected = fit.pipeline.predict_proba(batch.reindex(columns=list(fit.features)))
    up = list(fit.pipeline.classes_).index(1)

    feature_columns = [c for c in window.columns if c != "ts"]
    for i in range(len(window)):
        row = window.iloc[i]
        observation = {c: (None if pd.isna(row[c]) else float(row[c]))
                       for c in feature_columns}
        result = model.score(stage, row["ts"], observation)
        assert result["p_green"] == pytest.approx(float(expected[i][up]), abs=1e-12)
        assert result["fit_id"] == f"external_direction_{stage}_{fit.phase}"
        assert result["class_index"] == (1 if result["p_green"] >= 0.5 else 0)
        assert result["signed_direction"] == (1 if result["p_green"] >= 0.5 else -1)


def test_the_design_row_keeps_the_artifacts_feature_order_and_its_nans(model, observations):
    fit = model.fits[["T0", "T5"][1]][-1]
    row = observations.loc[observations["ts"] >= fit.scores_from].iloc[0]
    observation = {c: (None if pd.isna(row[c]) else float(row[c]))
                   for c in observations.columns if c != "ts"}
    design = model.design_row("T5", row["ts"], observation)
    assert list(design.columns) == list(fit.features)
    assert len(design) == 1


def test_a_missing_input_stays_nan_for_the_imputer_and_is_still_scored(model, observations):
    """The original pipeline imputes; dropping a column must not veto the target."""
    fit = model.fits["T0"][-1]
    row = observations.loc[observations["ts"] >= fit.scores_from].iloc[0]
    observation = {c: (None if pd.isna(row[c]) else float(row[c]))
                   for c in observations.columns if c != "ts"}
    dropped = dict(observation)
    for key in [k for k in dropped if k.startswith("hyperliquid_")]:
        dropped.pop(key)
    design = model.design_row("T0", row["ts"], dropped)
    hyper_columns = [c for c in fit.features if c.startswith("hyperliquid_")]
    assert hyper_columns, "the selected source set includes hyperliquid columns"
    assert design.iloc[0][hyper_columns].isna().all()
    result = model.score("T0", row["ts"], dropped)
    assert result["scored"] is True if "scored" in result else True
    assert 0.0 < result["p_green"] < 1.0
    assert set(result["features_missing"]) >= set(hyper_columns)


# -- WIRING (not a raw parity claim) ----------------------------------------
def _accumulators():
    return BinanceWindowAccumulator(), HyperliquidContextAccumulator()


def _candle(ms, close):
    return {"t": ms, "T": ms + 15 * 60_000 - 1, "o": 100.0, "h": 110.0,
            "l": 90.0, "c": close, "v": 10.0, "n": 5}


def test_producers_are_wired_through_the_head_and_report_coverage(model):
    binance, hyper = _accumulators()
    target_ms = int(pd.Timestamp("2026-07-10T12:00:00Z").value // 10**6)
    fifteen = 15 * 60_000
    hyper.ingest_candles(
        "15m", [_candle(target_ms - k * fifteen, 100.0 + k) for k in range(1, 120)],
        available_ns=target_ms * 1_000_000, final=True,
    )
    expert = ExternalDirectionExpert(model, binance, hyper)
    result = expert.evaluate(target_ms, "T0", mode="HISTORICAL")
    assert result["scored"] is True
    assert result["phase"] == "jul_aug"
    # Binance supplied nothing, so its columns are missing and REPORTED - the
    # head still scores, because the fitted pipeline imputes.
    assert any(c.startswith("binance_") for c in result["features_missing"])
    coverage = result["input_coverage"]
    assert coverage["binance"]["inputs_complete"] is False
    assert coverage["hyperliquid"]["missing_columns"] is not None


def test_a_september_target_is_blocked_through_the_expert_too(model):
    binance, hyper = _accumulators()
    target_ms = int(pd.Timestamp("2026-09-03T12:00:00Z").value // 10**6)
    result = ExternalDirectionExpert(model, binance, hyper).evaluate(
        target_ms, "T5", mode="HISTORICAL")
    assert result["scored"] is False
    assert "no T5 fit is scheduled" in result["blocker"]


def test_single_target_chronological_and_restarted_state_agree(model):
    """One target scored cold == the same target reached by walking the grid,
    and == the same target after serialising and restoring the producers."""
    fifteen = 15 * 60_000
    target_ms = int(pd.Timestamp("2026-07-10T12:00:00Z").value // 10**6)
    rows = [_candle(target_ms - k * fifteen, 100.0 + k) for k in range(1, 160)]

    cold_b, cold_h = _accumulators()
    cold_h.ingest_candles("15m", rows, available_ns=target_ms * 1_000_000, final=True)
    cold = ExternalDirectionExpert(model, cold_b, cold_h).evaluate(
        target_ms, "T0", mode="HISTORICAL")["p_green"]

    walk_b, walk_h = _accumulators()
    walk_h.ingest_candles("15m", rows, available_ns=target_ms * 1_000_000, final=True)
    expert = ExternalDirectionExpert(model, walk_b, walk_h)
    for k in range(6, 0, -1):
        step = target_ms - k * fifteen
        walk_h.open_target(step)
        expert.evaluate(step, "T0", mode="HISTORICAL")
        walk_h.close_target(step)
        walk_h.prune(step)
    walk_h.open_target(target_ms)
    walked = expert.evaluate(target_ms, "T0", mode="HISTORICAL")["p_green"]

    restored_h = HyperliquidContextAccumulator.loads(walk_h.dumps())
    restarted = ExternalDirectionExpert(model, walk_b, restored_h).evaluate(
        target_ms, "T0", mode="HISTORICAL")["p_green"]

    assert walked == pytest.approx(cold, abs=1e-12)
    assert restarted == pytest.approx(cold, abs=1e-12)
