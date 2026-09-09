"""The incremental long-context head equals the original batch loop.

`long_context_model.walk_forward_hgb` scores the whole archive in one pass; the
worker must produce the identical number one target at a time, with labels
arriving a target late (the label of T is the candle that begins at T). These
tests pin that equivalence, the frozen settings, and the fail-closed behaviour
while no fit exists.

The schedule constants are scaled down through the module globals so the test
is fast; the *values* shipped in the module are asserted separately against the
recovered source.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# This sandbox massively oversubscribes OpenMP threads: one HGB fit takes 13 s
# with the default thread pool and 0.12 s pinned to one thread. Pin before any
# sklearn import. The worker does the same in `src/runtime_env.py`.
for _var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_var, "1")


import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.experts import long_context as lc  # noqa: E402


def test_frozen_settings_match_the_recovered_source():
    assert (lc.WINDOW, lc.MINIMUM, lc.REFIT_EVERY) == (17_280, 5_760, 96)
    assert lc.HGB_PARAMS == {
        "learning_rate": 0.025,
        "max_iter": 70,
        "max_leaf_nodes": 7,
        "min_samples_leaf": 256,
        "l2_regularization": 50.0,
        "random_state": 0,
    }
    assert lc.HEAD_ID == "T0_LONG_CONTEXT_R1" and lc.SPEC_NAME == "ALL_HGB"


ORIGINAL_MODEL = Path(
    "/mnt/documents/.lovable/c85-cache/c85root/external_research/long_context_model.py"
)


def _schema(extra: list[str]) -> list[str]:
    """A column universe: every PRICE name the selector asks for, plus decoys."""

    try:
        lc.feature_sets(extra)
    except lc.LongContextSchemaError as error:
        required = str(error).split("Missing PRICE features: ")[1]
        names = [n.strip(" '\"[]") for n in required.split(",")]
    return [*names, *extra]


def test_depth_metric_and_qlib_filters():
    extra = [
        "target_ts", "binance_label",
        "session_sin_external", "session_cos_external",
        "dow_sin_external", "dow_cos_external",
        "qlib_klen_5", "qlib_beta_20", "qlib_beta_30", "qlib_corr_5",
        "book_imb_100", "book_imb_20", "book_snapshot_count", "book_log_total_500",
        "metric_log_oi", "metric_ts", "metric_age_at_target_seconds",
    ]
    columns = _schema(extra)
    sets = lc.feature_sets(columns)
    # compact qlib prefixes only, and only the 5/20/60 suffixes
    assert sets["PRICE"][-2:] == ["qlib_klen_5", "qlib_beta_20"]
    assert "qlib_corr_5" not in sets["PRICE"], "corr_ is outside the compact prefixes"
    assert "qlib_beta_30" not in sets["PRICE"], "only the 5/20/60 suffixes are kept"
    # 20-bps band and the descriptive book columns are excluded
    assert sets["DEPTH"] == ["book_imb_100", "book_log_total_500"]
    assert sets["METRICS"] == ["metric_log_oi"]
    assert lc.feature_columns(columns) == [*sets["PRICE"], *sets["DEPTH"], *sets["METRICS"]]


@pytest.mark.skipif(not ORIGINAL_MODEL.exists(), reason="recovered source not mounted")
def test_selection_matches_the_recovered_original_function():
    """Run the *original* `feature_sets` from the recovered source and require
    an identical selection, so this is a transcription check rather than a
    restatement of our own code."""

    import importlib.util

    columns = _schema([
        "target_ts", "binance_label", "ts", "label", "boise_date",
        "qlib_klen_5", "qlib_beta_20", "qlib_beta_30", "qlib_corr_5",
        "book_imb_100", "book_imb_20", "book_snapshot_count", "book_log_total_500",
        "book_final_age_seconds", "book_fresh_within_60s",
        "metric_log_oi", "metric_ts", "metric_age_at_target_seconds",
    ])
    source = ORIGINAL_MODEL.read_text()
    namespace: dict[str, object] = {"np": np, "pd": pd, "re": __import__("re")}
    start = source.index("def feature_sets(")
    end = source.index("def day_weights(")
    exec(compile(source[start:end], "original_feature_sets", "exec"), namespace)
    frame = pd.DataFrame({c: [0.0] for c in columns})
    original = namespace["feature_sets"](frame)
    ours = lc.feature_sets(columns)
    assert ours == original



def test_missing_feature_column_fails_closed():
    with pytest.raises(lc.LongContextSchemaError):
        lc.feature_columns(["target_ts", "book_imb_100"])  # no session_* etc.


# -- equivalence --------------------------------------------------------------

FEATURES = ["f0", "f1", "f2", "f3"]


def _fixture_frame(rows: int = 320, seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    ts = pd.date_range("2026-01-01T00:15:00Z", periods=rows, freq="15min")
    data = {f: rng.normal(size=rows) for f in FEATURES}
    frame = pd.DataFrame({"ts": ts, **data})
    signal = frame.f0 * 0.8 + frame.f1 * 0.4 + rng.normal(scale=0.5, size=rows)
    frame["label"] = np.sign(signal)
    # A handful of rows the original would leave NaN: incomplete features and
    # flat labels.
    frame.loc[[13, 77, 201], "f2"] = np.nan
    frame.loc[[40, 41], "label"] = 0.0
    return frame


@pytest.fixture
def small_schedule(monkeypatch):
    monkeypatch.setattr(lc, "WINDOW", 200)
    monkeypatch.setattr(lc, "MINIMUM", 60)
    monkeypatch.setattr(lc, "REFIT_EVERY", 12)


def test_incremental_head_reproduces_the_batch_loop(small_schedule):
    frame = _fixture_frame()
    batch, fit_count, first_fit = lc.walk_forward_probability(frame, FEATURES)

    head = lc.LongContextHead(features=FEATURES)
    incremental = lc.replay(head, frame)

    assert head.fit_count == fit_count
    assert head.first_fit_ts == first_fit
    np.testing.assert_array_equal(np.isnan(batch), np.isnan(incremental))
    finite = ~np.isnan(batch)
    np.testing.assert_allclose(batch[finite], incremental[finite], rtol=0, atol=0)
    assert finite.sum() > 0


def test_rows_the_original_leaves_nan_are_returned_as_none(small_schedule):
    frame = _fixture_frame()
    head = lc.LongContextHead(features=FEATURES)
    values = lc.replay(head, frame)
    # incomplete feature rows never get a probability
    assert np.isnan(values[201])
    # nothing before the first scheduled fit does either
    assert np.all(np.isnan(values[: lc.MINIMUM]))


def test_head_fails_closed_before_any_fit():
    head = lc.LongContextHead(features=FEATURES)
    row = {f: 0.1 for f in FEATURES}
    assert head.observe(pd.Timestamp("2026-01-01T00:15:00Z"), row) is None
    assert head.state_summary()["fitted"] is False
    assert head.state_summary()["fit_count"] == 0


def test_packet_missing_features_is_rejected_not_imputed():
    head = lc.LongContextHead(features=FEATURES)
    with pytest.raises(lc.LongContextSchemaError):
        head.observe(pd.Timestamp("2026-01-01T00:15:00Z"), {"f0": 1.0})
