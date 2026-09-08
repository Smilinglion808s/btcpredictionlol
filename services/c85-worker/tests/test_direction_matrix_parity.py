"""Raw-overlap parity for the first live producer.

This is NOT a supplied-feature harness: the worker's transcription is compared
against the ORIGINAL recovered module's own `directional_matrix`, executed from
its source text, over archived raw multivenue observations. Only the design
matrix is proven here — the upstream raw-tape producer
(`build_multivenue_features_r1.py`) is still missing, so this does not make the
whole direction leaf live.
"""
from __future__ import annotations

import ast
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.experts.direction_matrix import SOURCE_SETS, directional_matrix, row_features  # noqa: E402

CACHE = Path("/mnt/documents/.lovable/c85-cache/upx/ancestor")
ORIGINAL = CACHE / "source/eb8e707686c9/evaluate_external_direction_r1.py"
OBSERVATIONS = CACHE / "data/binance_event_features.csv.gz"

pytestmark = pytest.mark.skipif(
    not (ORIGINAL.exists() and OBSERVATIONS.exists()),
    reason="durable recovery cache not mounted in this environment",
)


def original_function():
    """Execute the original module's own function, from its own source text.

    The module imports a heavy sibling at import time; only the function's AST
    node is compiled here, so the comparison runs the ORIGINAL code, unedited.
    """
    tree = ast.parse(ORIGINAL.read_text())
    node = next(
        n for n in tree.body
        if isinstance(n, ast.FunctionDef) and n.name == "directional_matrix"
    )
    namespace: dict = {"pd": pd, "np": np, "Callable": __import__("typing").Callable}
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(ORIGINAL), "exec"), namespace)
    return namespace["directional_matrix"]


@pytest.fixture(scope="module")
def observations() -> pd.DataFrame:
    frame = pd.read_csv(OBSERVATIONS, compression="gzip", parse_dates=["target_ts"], low_memory=False)
    frame = frame.rename(columns={"target_ts": "ts"}).sort_values("ts").reset_index(drop=True)
    return frame.iloc[:1500].copy()


@pytest.mark.parametrize("stage", ["T0", "T5"])
def test_transcription_matches_the_original_cell_for_cell(observations, stage):
    reference = original_function()(observations, SOURCE_SETS["ALL3"], stage)
    produced = directional_matrix(observations, SOURCE_SETS["ALL3"], stage)

    assert list(produced.columns) == list(reference.columns)
    assert len(produced) == len(reference) == len(observations)
    for column in reference.columns:
        a = reference[column].to_numpy(dtype=float)
        b = produced[column].to_numpy(dtype=float)
        mismatch = ~(np.isclose(a, b, rtol=0, atol=0, equal_nan=True))
        assert not mismatch.any(), f"{stage} {column}: {int(mismatch.sum())} cells differ"


def test_one_target_at_a_time_equals_the_batch_pass(observations):
    """Live inference scores one target per boundary; the row-wise path must be
    identical to the batch pass, and stateless across restarts."""
    batch = directional_matrix(observations.iloc[:60], SOURCE_SETS["ALL3"], "T5")
    for index in range(60):
        record = observations.iloc[index].to_dict()
        ts = record.pop("ts")
        produced = row_features(record, ts, sources=SOURCE_SETS["ALL3"], stage="T5")
        assert list(produced) == list(batch.columns)
        for name in batch.columns:
            expected = batch.iloc[index][name]
            actual = produced[name]
            if pd.isna(expected):
                assert actual is None, f"{name}: expected NaN, got {actual}"
            else:
                assert actual == pytest.approx(float(expected), rel=0, abs=0)
