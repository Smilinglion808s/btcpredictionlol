"""Comparison contract: what compare() must refuse, and what counts as a pass.

Small and synthetic. No fitting: the checkpoint is built directly.
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

ROWS, FEATURES = 96, 3


@pytest.fixture()
def world(tmp_path, monkeypatch):
    monkeypatch.setattr(lc, "WINDOW", 32, raising=False)
    monkeypatch.setattr(lc, "MINIMUM", 16, raising=False)
    monkeypatch.setattr(lc, "REFIT_EVERY", 8, raising=False)
    names = [f"spot_ret_{i}m_bps" for i in range(FEATURES)]
    monkeypatch.setattr(lc, "feature_columns", lambda columns: names)

    rng = np.random.default_rng(85)
    values = rng.normal(size=(ROWS, FEATURES))
    frame = pd.DataFrame(values, columns=names)
    frame["target_ts"] = pd.date_range("2026-01-01", periods=ROWS, freq="15min", tz="UTC")
    frame["binance_label"] = np.sign(values[:, 0])
    frame_path = tmp_path / "frame.pkl"
    frame.to_pickle(frame_path)

    # A checkpoint covering positions [0, 24): the rest is unprocessed.
    probability = np.full(ROWS, np.nan)
    probability[16:24] = rng.uniform(0.2, 0.8, 8)
    probability[18] = np.nan  # a legitimate model-NaN inside the processed prefix
    state = tmp_path / "state"
    inputs = pr.load_inputs(frame_path)
    pr.write_checkpoint(state, probability, {
        "identity": json.loads(json.dumps(inputs["identity"], default=str)),
        "next_block_index": 1, "block_start": 16,
        "block_ts": str(frame.target_ts.iloc[16]), "fit_count": 1,
        "first_fit": str(frame.target_ts.iloc[16]), "last_fit_block": 16,
        "probability_prefix_sha256": pr.sha_array(probability[:24]),
    })

    ledger = pd.DataFrame({
        "ts": frame.target_ts,
        "external_probability_green": probability,   # identical by construction
        "external_direction": np.where(np.isfinite(probability),
                                       np.where(probability >= 0.5, 1, -1), np.nan),
        "external_rank": np.full(ROWS, np.nan),
    })
    ledger_path = tmp_path / "ledger.csv"
    ledger.to_csv(ledger_path, index=False)
    return frame_path, state, ledger_path, probability


def test_matching_prefix_is_partial_agreement_never_full_parity(world):
    frame_path, state, ledger_path, _p = world
    result = pr.compare(frame_path, state, ledger_path)
    assert result["status"] == "PARTIAL AGREEMENT"
    assert result["partial"] is True and result["walk_complete"] is False
    assert result["processed_prefix_rows_end_exclusive"] == 24
    assert result["finite_mask_mismatches"] == 0
    assert result["max_abs_diff"] <= pr.TOLERANCE  # CSV round-trip only


def test_the_unprocessed_suffix_is_never_counted_as_a_mask_mismatch(world):
    frame_path, state, ledger_path, _p = world
    ledger = pd.read_csv(ledger_path)
    ledger.loc[24:, "external_probability_green"] = 0.7  # archive scores we haven't reached
    ledger.to_csv(ledger_path, index=False)
    result = pr.compare(frame_path, state, ledger_path)
    assert result["finite_mask_mismatches"] == 0
    assert result["overlap_rows"] == 24
    assert result["archived_rows_outside_processed_prefix"] == ROWS - 24


def test_a_processed_model_nan_row_is_included_as_a_mask_mismatch(world):
    frame_path, state, ledger_path, _p = world
    ledger = pd.read_csv(ledger_path)
    ledger.loc[18, "external_probability_green"] = 0.55  # archive scored what we left NaN
    ledger.to_csv(ledger_path, index=False)
    result = pr.compare(frame_path, state, ledger_path)
    assert result["finite_mask_mismatches"] == 1
    assert result["status"] == "PARTIAL MISMATCH"


def test_an_above_tolerance_difference_is_never_a_pass(world):
    frame_path, state, ledger_path, _p = world
    ledger = pd.read_csv(ledger_path)
    ledger.loc[17, "external_probability_green"] += 1e-6
    ledger.to_csv(ledger_path, index=False)
    result = pr.compare(frame_path, state, ledger_path)
    assert result["status"] == "PARTIAL MISMATCH"
    assert result["exceed_tolerance"] == 1
    assert result["first_divergence"]["position"] == 17
    assert result["first_divergence"]["fit_block_start"] == 16


def test_an_invalid_checkpoint_refuses_to_produce_numbers(world):
    frame_path, state, ledger_path, _p = world
    meta = json.loads((state / pr.CKPT_META).read_text())
    meta["probability_prefix_sha256"] = "0" * 64
    (state / pr.CKPT_META).write_text(json.dumps(meta))
    with pytest.raises(pr.ParityComparisonRefused, match="invalid"):
        pr.compare(frame_path, state, ledger_path)


def test_duplicate_join_keys_refuse_comparison(world):
    frame_path, state, ledger_path, _p = world
    ledger = pd.read_csv(ledger_path)
    pd.concat([ledger, ledger.iloc[[17]]]).to_csv(ledger_path, index=False)
    with pytest.raises(pr.ParityComparisonRefused, match="duplicate join keys"):
        pr.compare(frame_path, state, ledger_path)


def test_the_cli_does_not_exit_zero_on_a_partial_or_mismatched_comparison(world, capsys):
    frame_path, state, ledger_path, _p = world
    code = pr.main(["compare", "--frame", str(frame_path), "--state", str(state),
                    "--ledger", str(ledger_path)])
    capsys.readouterr()
    assert code == 1  # partial agreement is a diagnostic, not a pass

    meta = json.loads((state / pr.CKPT_META).read_text())
    meta["probability_full_sha256"] = "0" * 64
    (state / pr.CKPT_META).write_text(json.dumps(meta))
    code = pr.main(["compare", "--frame", str(frame_path), "--state", str(state),
                    "--ledger", str(ledger_path)])
    assert code == 2  # refused
    assert json.loads(capsys.readouterr().out)["status"] == "REFUSED"


def test_direction_and_rank_use_the_recovered_producers(world):
    frame_path, state, ledger_path, probability = world
    result = pr.compare(frame_path, state, ledger_path)
    assert "signed_direction" in result["direction"]["policy"]
    assert result["direction"]["mismatches"] == 0
    assert "2880" in result["rank"]["policy"] and "960" in result["rank"]["policy"]
    # Rank warm-up: 2,880-row lookback cannot be satisfied by a 24-row prefix.
    assert result["rank"]["rebuilt_finite"] == 0


# --- The rank transform: rank(|p - 0.5|), never rank(p) -----------------------
# The short fixture above never leaves rank warm-up, so it cannot catch the
# wrong transform. This one produces finite ranks with no fitting at all.

BIG_ROWS = 4000


@pytest.fixture()
def ranked_world(tmp_path, monkeypatch):
    monkeypatch.setattr(lc, "WINDOW", 512, raising=False)
    monkeypatch.setattr(lc, "MINIMUM", 128, raising=False)
    monkeypatch.setattr(lc, "REFIT_EVERY", 500, raising=False)
    names = ["spot_ret_1m_bps"]
    monkeypatch.setattr(lc, "feature_columns", lambda columns: names)

    rng = np.random.default_rng(2026)
    frame = pd.DataFrame({names[0]: rng.normal(size=BIG_ROWS)})
    frame["target_ts"] = pd.date_range("2026-01-01", periods=BIG_ROWS,
                                       freq="15min", tz="UTC")
    frame["binance_label"] = np.sign(frame[names[0]].to_numpy())
    frame_path = tmp_path / "frame.pkl"
    frame.to_pickle(frame_path)

    # Values on both sides of 0.5, exact ties, and genuine NaN slots.
    probability = rng.uniform(0.2, 0.8, BIG_ROWS)
    probability[::37] = 0.5            # ties at zero confidence
    probability[::53] = 0.75           # ties at equal non-zero confidence
    probability[::101] = np.nan        # model-NaN rows keep their positional slot
    end = BIG_ROWS  # whole frame processed; the walk is still marked incomplete
    state = tmp_path / "state"
    inputs = pr.load_inputs(frame_path)
    blocks = pr.block_starts(BIG_ROWS)
    pr.write_checkpoint(state, probability, {
        "identity": json.loads(json.dumps(inputs["identity"], default=str)),
        "next_block_index": len(blocks), "block_start": blocks[-1],
        "block_ts": str(frame.target_ts.iloc[blocks[-1]]), "fit_count": len(blocks),
        "first_fit": str(frame.target_ts.iloc[blocks[0]]),
        "last_fit_block": blocks[-1],
        "probability_prefix_sha256": pr.sha_array(probability[:end]),
    })

    from src.experts import direction_contract as dc
    reference_rank = dc.rolling_rank(np.abs(probability - 0.5))
    ledger = pd.DataFrame({
        "ts": frame.target_ts,
        "external_probability_green": probability,
        "external_direction": dc.signed_direction(probability).astype(float),
        "external_rank": reference_rank,
    })
    ledger_path = tmp_path / "ledger.csv"
    ledger.to_csv(ledger_path, index=False)
    return frame_path, state, ledger_path, probability, reference_rank


def test_rank_is_the_confidence_rank_of_abs_p_minus_half(ranked_world):
    frame_path, state, ledger_path, probability, reference = ranked_world
    from src.experts import direction_contract as dc

    result = pr.compare(frame_path, state, ledger_path)

    # The reference really does exit warm-up, so the test can fail.
    finite = int(np.isfinite(reference).sum())
    assert finite > 0
    assert result["rank"]["rebuilt_finite"] == finite
    assert result["rank"]["finite_mask_mismatches"] == 0
    assert result["rank"]["max_abs_diff"] is not None
    assert result["rank"]["max_abs_diff"] <= pr.TOLERANCE
    assert "|p - 0.5|" in result["rank"]["policy"]

    # And the wrong transform - rank of the probability itself - would not agree.
    wrong = dc.rolling_rank(probability)
    both = np.isfinite(wrong) & np.isfinite(reference)
    assert np.abs(wrong[both] - reference[both]).max() > pr.TOLERANCE


def test_probability_and_contract_statuses_are_reported_separately(ranked_world):
    frame_path, state, ledger_path, _p, _r = ranked_world
    result = pr.compare(frame_path, state, ledger_path)
    assert result["probability_status"] == result["status"]
    assert result["contract_components"]["probability_ok"] is True
    assert result["contract_components"]["rank_ok"] is True
    assert result["contract_components"]["direction_ok"] is True
    assert result["contract_components"]["expected_key_coverage_ok"] is True
    assert result["missing_expected_keys_in_processed_bounds"] == 0


def test_a_missing_internal_row_is_not_excused_as_outside_the_prefix(ranked_world):
    frame_path, state, ledger_path, _p, _r = ranked_world
    frame = pd.read_pickle(frame_path)
    dropped = frame.target_ts.iloc[1000]
    ledger = pd.read_csv(ledger_path)
    # The rebuilt side keeps every row; drop an archived row well inside bounds
    # and instead check the reverse direction: an archived key absent from the
    # rebuilt frame must be counted as missing coverage.
    rebuilt_missing = pd.concat([ledger, pd.DataFrame([{
        "ts": str(dropped + pd.Timedelta(minutes=5)),
        "external_probability_green": 0.6,
        "external_direction": 1.0, "external_rank": np.nan}])])
    rebuilt_missing.to_csv(ledger_path, index=False)
    result = pr.compare(frame_path, state, ledger_path)
    assert result["missing_expected_keys_in_processed_bounds"] == 1
    assert result["contract_components"]["expected_key_coverage_ok"] is False
    assert result["contract_status"].endswith("MISMATCH")


def test_earliest_mask_divergence_is_reported_before_the_value_divergence(ranked_world):
    frame_path, state, ledger_path, probability, _r = ranked_world
    ledger = pd.read_csv(ledger_path)
    ledger.loc[101, "external_probability_green"] = 0.55   # archive scored our NaN
    ledger.loc[3000, "external_probability_green"] += 1e-6  # later value divergence
    ledger.to_csv(ledger_path, index=False)
    result = pr.compare(frame_path, state, ledger_path)
    assert result["first_finite_mask_divergence"]["position"] == 101
    assert result["first_probability_divergence"]["position"] == 3000
