"""Hyperliquid context producer: source parity plus live-path contract.

The parity test is REAL, not synthetic: it feeds authentic Hyperliquid API
responses (saved under the durable recovery store) through the transcribed
producer and compares every column against the archived reference feature file
built by the original producer. Contract tests are labelled separately and make
no parity claim.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.experts.hyperliquid_context import (  # noqa: E402
    CANDLE_FIELDS,
    FEATURE_COLUMNS,
    HISTORICAL,
    LIVE,
    HyperliquidContextAccumulator,
    HyperliquidSchemaError,
    build_grid,
    build_hyperliquid_features,
    normalize_candles,
    normalize_funding,
)

CACHE = Path("/mnt/documents/.lovable/c85-cache")
SAMPLE = CACHE / "hyperliquid_samples/hyperliquid_btc_2026-08-17_2026-09-01_api.json"
REFERENCE = (
    CACHE / "upx/upstream/vault_work/legacy_lab2/sources"
    / "T0_T5_MULTIVENUE_LAB_R1_COMPACT.zip__expanded/features"
    / "hyperliquid_context_features.csv.gz"
)


@pytest.fixture(scope="module")
def sample():
    if not SAMPLE.exists():
        pytest.skip(f"authentic API sample not present at {SAMPLE}")
    return json.loads(SAMPLE.read_text())


# --------------------------------------------------------------------------
# parity against the original producer's own output
# --------------------------------------------------------------------------
def test_authentic_api_inputs_reproduce_the_archived_feature_file(sample):
    if not REFERENCE.exists():
        pytest.skip("reference feature file not present")
    grid = build_grid(pd.Timestamp("2026-08-20", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC"))
    built = build_hyperliquid_features(
        grid,
        normalize_candles(sample["c15"]),
        normalize_candles(sample["c1h"]),
        normalize_funding(sample["funding"]),
    )
    reference = pd.read_csv(REFERENCE, compression="gzip")
    reference["target_ts"] = pd.to_datetime(reference["target_ts"], utc=True)
    merged = built.merge(reference, on="target_ts", suffixes=("_new", "_ref"))
    assert len(merged) == 1152, "overlap window changed; parity claim must be re-established"

    for column in FEATURE_COLUMNS:
        new = merged[f"{column}_new"].to_numpy(float)
        ref = merged[f"{column}_ref"].to_numpy(float)
        assert (np.isnan(new) == np.isnan(ref)).all(), f"{column}: missing-data pattern differs"
        both = ~np.isnan(new)
        # 1e-9 absolute: the reference is a CSV, so only float round-trip differs.
        assert np.abs(new[both] - ref[both]).max() < 1e-9, f"{column}: values differ"


def test_the_producer_emits_exactly_the_reference_columns():
    if not REFERENCE.exists():
        pytest.skip("reference feature file not present")
    reference = pd.read_csv(REFERENCE, compression="gzip", nrows=1)
    assert list(reference.columns) == ["target_ts", *FEATURE_COLUMNS]


# --------------------------------------------------------------------------
# causal contract (contract tests, not parity)
# --------------------------------------------------------------------------
def candle(ms: int, o=100.0, h=110.0, low=90.0, c=105.0, v=10.0, n=5):
    return {"t": ms, "o": o, "h": h, "l": low, "c": c, "v": v, "n": n}


def funding_row(ms: int, rate=0.0001, premium=0.0002):
    return {"time": ms, "fundingRate": rate, "premium": premium}


T = int(pd.Timestamp("2026-09-01 12:00", tz="UTC").value // 10**6)
FIFTEEN = 15 * 60_000
HOUR = 60 * 60_000


def test_a_15m_bar_is_only_read_after_it_has_closed():
    """The bar opening at T is attributed to T+15m, never to T itself."""
    grid = pd.DataFrame({"target_ts": [pd.Timestamp(T, unit="ms", tz="UTC")]})
    built = build_hyperliquid_features(
        grid, normalize_candles([candle(T)]),
        pd.DataFrame(columns=list(CANDLE_FIELDS)), pd.DataFrame(columns=["time", "fundingRate", "premium"]),
    )
    assert pd.isna(built["hyperliquid_t0_return_bps_15m"].iloc[0])

    grid_next = pd.DataFrame({"target_ts": [pd.Timestamp(T + FIFTEEN, unit="ms", tz="UTC")]})
    built_next = build_hyperliquid_features(
        grid_next, normalize_candles([candle(T)]),
        pd.DataFrame(columns=list(CANDLE_FIELDS)), pd.DataFrame(columns=["time", "fundingRate", "premium"]),
    )
    assert built_next["hyperliquid_t0_return_bps_15m"].iloc[0] == pytest.approx(500.0)


def test_funding_exactly_at_T_is_excluded_strictly_before_only():
    """allow_exact_matches=False on the funding join; True here would leak."""
    grid = pd.DataFrame({"target_ts": [pd.Timestamp(T, unit="ms", tz="UTC")]})
    empty = pd.DataFrame(columns=list(CANDLE_FIELDS))
    at_T = build_hyperliquid_features(grid, empty, empty, normalize_funding([funding_row(T)]))
    assert pd.isna(at_T["hyperliquid_funding_rate"].iloc[0])
    before = build_hyperliquid_features(grid, empty, empty, normalize_funding([funding_row(T - 1)]))
    assert before["hyperliquid_funding_rate"].iloc[0] == pytest.approx(0.0001)


def test_hourly_bar_landing_exactly_on_T_is_included():
    """allow_exact_matches=True on the hourly join - the opposite flag."""
    grid = pd.DataFrame({"target_ts": [pd.Timestamp(T, unit="ms", tz="UTC")]})
    empty = pd.DataFrame(columns=list(CANDLE_FIELDS))
    built = build_hyperliquid_features(
        grid, empty, normalize_candles([candle(T - HOUR)]),
        pd.DataFrame(columns=["time", "fundingRate", "premium"]),
    )
    assert built["hyperliquid_t0_hourly_return_bps_1h"].iloc[0] == pytest.approx(500.0)


def test_missing_bars_stay_missing_and_are_never_imputed():
    grid = build_grid(pd.Timestamp(T, unit="ms", tz="UTC"), pd.Timestamp(T + 3 * FIFTEEN, unit="ms", tz="UTC"))
    empty = pd.DataFrame(columns=list(CANDLE_FIELDS))
    built = build_hyperliquid_features(
        grid, empty, empty, pd.DataFrame(columns=["time", "fundingRate", "premium"])
    )
    assert len(built) == 3
    assert built[list(FEATURE_COLUMNS)].isna().all().all()


def test_flat_bar_zero_range_becomes_nan_not_a_division_blowup():
    grid = pd.DataFrame({"target_ts": [pd.Timestamp(T + FIFTEEN, unit="ms", tz="UTC")]})
    empty = pd.DataFrame(columns=list(CANDLE_FIELDS))
    built = build_hyperliquid_features(
        grid, normalize_candles([candle(T, o=100.0, h=100.0, low=100.0, c=100.0)]),
        empty, pd.DataFrame(columns=["time", "fundingRate", "premium"]),
    )
    assert pd.isna(built["hyperliquid_t0_close_location_15m"].iloc[0])


def test_duplicate_bar_timestamps_keep_the_last_observation():
    grid = pd.DataFrame({"target_ts": [pd.Timestamp(T + FIFTEEN, unit="ms", tz="UTC")]})
    empty = pd.DataFrame(columns=list(CANDLE_FIELDS))
    built = build_hyperliquid_features(
        grid, normalize_candles([candle(T, c=105.0), candle(T, c=120.0)]),
        empty, pd.DataFrame(columns=["time", "fundingRate", "premium"]),
    )
    assert built["hyperliquid_t0_return_bps_15m"].iloc[0] == pytest.approx(2000.0)


# --------------------------------------------------------------------------
# schema and live-path contract
# --------------------------------------------------------------------------
def test_a_candle_missing_a_field_is_rejected():
    with pytest.raises(HyperliquidSchemaError, match="missing field"):
        normalize_candles([{"t": T, "o": 1, "h": 2, "l": 1, "c": 2}])


def test_an_unsupported_interval_is_rejected():
    with pytest.raises(HyperliquidSchemaError, match="interval"):
        HyperliquidContextAccumulator().ingest_candles("5m", [candle(T)])


def test_rows_with_unknown_availability_are_excluded_in_live_mode():
    acc = HyperliquidContextAccumulator()
    acc.ingest_candles("15m", [candle(T)])                       # no availability
    assert acc.features_for(T + FIFTEEN, mode=LIVE, freeze_ns=10**18)[
        "hyperliquid_t0_return_bps_15m"
    ] is None
    assert acc.features_for(T + FIFTEEN, mode=HISTORICAL)[
        "hyperliquid_t0_return_bps_15m"
    ] == pytest.approx(500.0)


def test_a_poll_that_arrived_after_the_freeze_is_not_used():
    acc = HyperliquidContextAccumulator()
    acc.ingest_candles("15m", [candle(T)], available_ns=1_000)
    assert acc.features_for(T + FIFTEEN, mode=LIVE, freeze_ns=999)[
        "hyperliquid_t0_return_bps_15m"
    ] is None
    assert acc.features_for(T + FIFTEEN, mode=LIVE, freeze_ns=1_000)[
        "hyperliquid_t0_return_bps_15m"
    ] == pytest.approx(500.0)


def test_a_revised_bar_cannot_back_date_its_availability():
    acc = HyperliquidContextAccumulator()
    acc.ingest_candles("15m", [candle(T)], available_ns=500)
    acc.ingest_candles("15m", [candle(T, c=120.0)], available_ns=900)
    assert acc.candles_15m.available_ns[T] == 500
    assert acc.features_for(T + FIFTEEN, mode=LIVE, freeze_ns=500)[
        "hyperliquid_t0_return_bps_15m"
    ] == pytest.approx(2000.0)


def test_live_mode_requires_a_freeze_instant():
    with pytest.raises(ValueError, match="freeze"):
        HyperliquidContextAccumulator().features_for(T, mode=LIVE)


def test_validity_reports_missing_columns_and_fails_closed():
    acc = HyperliquidContextAccumulator()
    report = acc.validity(T)
    assert report["valid"] is False
    assert set(report["missing_columns"]) == set(FEATURE_COLUMNS)


def test_pruning_never_drops_a_pending_targets_inputs():
    acc = HyperliquidContextAccumulator()
    acc.ingest_candles("15m", [candle(T - 90 * FIFTEEN)], available_ns=1)
    acc.open_target(T)
    acc.prune(T + 200 * FIFTEEN)
    assert len(acc.candles_15m.rows) == 1
    acc.close_target(T)
    acc.prune(T + 200 * FIFTEEN)
    assert len(acc.candles_15m.rows) == 0


def test_state_round_trips_and_restart_resumes_identically(sample):
    acc = HyperliquidContextAccumulator()
    acc.ingest_candles("15m", sample["c15"][:200], available_ns=1)
    acc.ingest_candles("1h", sample["c1h"][:50], available_ns=1)
    acc.ingest_funding(sample["funding"][:50], available_ns=1)
    acc.open_target(T)

    restored = HyperliquidContextAccumulator.loads(acc.dumps())
    assert restored.dumps() == acc.dumps()

    target = int(pd.to_datetime(sample["c15"][150]["t"], unit="ms").value // 10**6) + FIFTEEN
    assert restored.features_for(target) == acc.features_for(target)


def test_repeated_polling_of_the_same_window_is_idempotent(sample):
    acc = HyperliquidContextAccumulator()
    first = acc.ingest_candles("15m", sample["c15"][:100], available_ns=1)
    second = acc.ingest_candles("15m", sample["c15"][:100], available_ns=2)
    assert first == 100 and second == 0
    assert len(acc.candles_15m.rows) == 100
