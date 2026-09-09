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


def ns(ms: int) -> int:
    """Receipt instants are real epoch nanoseconds, as the collector records them."""
    return int(ms) * 1_000_000


CLOSE = T + FIFTEEN          # the bar opening at T closes here


def test_a_poll_that_arrived_after_the_freeze_is_not_used():
    acc = HyperliquidContextAccumulator()
    acc.ingest_candles("15m", [candle(T)], available_ns=ns(CLOSE + 1_000))
    assert acc.features_for(T + FIFTEEN, mode=LIVE, freeze_ns=ns(CLOSE + 999))[
        "hyperliquid_t0_return_bps_15m"
    ] is None
    assert acc.features_for(T + FIFTEEN, mode=LIVE, freeze_ns=ns(CLOSE + 1_000))[
        "hyperliquid_t0_return_bps_15m"
    ] == pytest.approx(500.0)


def test_a_partial_bar_seen_before_its_close_is_not_used_as_final():
    """A snapshot taken mid-bar is not a completed candle, whatever its close ts."""
    acc = HyperliquidContextAccumulator()
    acc.ingest_candles("15m", [candle(T, c=101.0)], available_ns=ns(CLOSE - 60_000))
    report = acc.input_coverage(T + FIFTEEN, mode=LIVE, freeze_ns=ns(CLOSE - 1))
    assert report["excluded_not_confirmed_final"] == 1
    assert acc.features_for(T + FIFTEEN, mode=LIVE, freeze_ns=ns(CLOSE - 1))[
        "hyperliquid_t0_return_bps_15m"
    ] is None
    # The source's own confirmation is honoured when it is supplied.
    acc2 = HyperliquidContextAccumulator()
    acc2.ingest_candles("15m", [candle(T, c=101.0)],
                        available_ns=ns(CLOSE - 60_000), final=True)
    assert acc2.features_for(T + FIFTEEN, mode=LIVE, freeze_ns=ns(CLOSE - 1))[
        "hyperliquid_t0_return_bps_15m"
    ] == pytest.approx(100.0)


def test_a_correction_after_the_freeze_cannot_reach_back_before_it():
    """The defect this replaces: a revision inheriting the partial's timestamp."""
    acc = HyperliquidContextAccumulator()
    acc.ingest_candles("15m", [candle(T)], available_ns=ns(CLOSE), final=True)
    acc.ingest_candles("15m", [candle(T, c=120.0)], available_ns=ns(CLOSE + 60_000))
    # Frozen between the two: the version that had actually arrived, unrevised.
    assert acc.features_for(T + FIFTEEN, mode=LIVE, freeze_ns=ns(CLOSE + 1_000))[
        "hyperliquid_t0_return_bps_15m"
    ] == pytest.approx(500.0)
    # Frozen after: the correction.
    assert acc.features_for(T + FIFTEEN, mode=LIVE, freeze_ns=ns(CLOSE + 60_000))[
        "hyperliquid_t0_return_bps_15m"
    ] == pytest.approx(2000.0)


def test_an_identical_repeated_payload_keeps_the_earliest_receipt():
    acc = HyperliquidContextAccumulator()
    acc.ingest_candles("15m", [candle(T)], available_ns=ns(CLOSE), final=True)
    acc.ingest_candles("15m", [candle(T)], available_ns=ns(CLOSE + 600_000), final=True)
    assert len(acc.candles_15m.versions[T]) == 1
    assert acc.features_for(T + FIFTEEN, mode=LIVE, freeze_ns=ns(CLOSE))[
        "hyperliquid_t0_return_bps_15m"
    ] == pytest.approx(500.0)


def test_an_unknown_availability_revision_cannot_take_a_known_versions_timestamp():
    acc = HyperliquidContextAccumulator()
    acc.ingest_candles("15m", [candle(T)], available_ns=ns(CLOSE), final=True)
    acc.ingest_candles("15m", [candle(T, c=120.0)], available_ns=None)
    assert acc.features_for(T + FIFTEEN, mode=LIVE, freeze_ns=ns(CLOSE + 10**6))[
        "hyperliquid_t0_return_bps_15m"
    ] == pytest.approx(500.0)


def test_an_out_of_order_poll_response_cannot_displace_a_newer_version():
    """A slow response carrying the older snapshot lands last but is still older."""
    acc = HyperliquidContextAccumulator()
    acc.ingest_candles("15m", [candle(T, c=120.0)],
                       available_ns=ns(CLOSE + 60_000), final=True)
    acc.ingest_candles("15m", [candle(T)], available_ns=ns(CLOSE), final=True)
    assert acc.features_for(T + FIFTEEN, mode=LIVE, freeze_ns=ns(CLOSE + 10**6))[
        "hyperliquid_t0_return_bps_15m"
    ] == pytest.approx(2000.0)


def test_a_funding_revision_is_versioned_the_same_way():
    acc = HyperliquidContextAccumulator()
    ts = T - 60_000
    acc.ingest_funding([{"time": ts, "fundingRate": "0.0001", "premium": "0.0002"}],
                       available_ns=ns(ts + 1_000))
    acc.ingest_funding([{"time": ts, "fundingRate": "0.0009", "premium": "0.0002"}],
                       available_ns=ns(ts + 60_000))
    early = acc.features_for(T, mode=LIVE, freeze_ns=ns(ts + 2_000))
    late = acc.features_for(T, mode=LIVE, freeze_ns=ns(ts + 60_000))
    assert early["hyperliquid_funding_rate"] == pytest.approx(0.0001)
    assert late["hyperliquid_funding_rate"] == pytest.approx(0.0009)


def test_input_coverage_reports_missing_columns_without_vetoing_the_target():
    """Missing inputs are reported; the imputing pipeline decides, not this."""
    acc = HyperliquidContextAccumulator()
    report = acc.input_coverage(T)
    assert set(report["missing_columns"]) == set(FEATURE_COLUMNS)
    assert "valid" not in report


def test_retention_keeps_the_shift_anchor_a_target_still_needs():
    """At 12:15 the last completed hourly bar is 11:00 and shift(3) needs 08:00.

    Four hours of wall-clock retention deletes 08:00 and silently changes the
    4h return; count-based retention keeps it.
    """
    acc = HyperliquidContextAccumulator()
    hour = 60 * 60_000
    target = T + FIFTEEN                      # 12:15
    bars = [candle(target - FIFTEEN - k * hour) for k in range(0, 8)]
    acc.ingest_candles("1h", bars, available_ns=ns(target), final=True)
    before = acc.features_for(target)
    acc.prune(target)
    assert acc.features_for(target) == before
    assert (target - FIFTEEN - 3 * hour) in acc.candles_1h.versions


def test_retention_survives_a_feed_gap_and_delayed_bars():
    """Across an outage the needed row sits further back than any fixed window."""
    acc = HyperliquidContextAccumulator()
    hour = 60 * 60_000
    target = T + FIFTEEN
    # Only four hourly bars exist at all, the newest 9 hours before the target.
    bars = [candle(target - 9 * hour - k * hour) for k in range(0, 4)]
    acc.ingest_candles("1h", bars, available_ns=ns(target), final=True)
    before = acc.features_for(target)
    acc.prune(target)
    assert acc.features_for(target) == before
    assert len(acc.candles_1h.versions) == 4


def test_pruning_never_drops_a_pending_targets_inputs_and_stays_bounded():
    acc = HyperliquidContextAccumulator()
    acc.ingest_candles("15m", [candle(T - k * FIFTEEN) for k in range(300)],
                       available_ns=ns(T + 300 * FIFTEEN))
    acc.open_target(T)
    later = T + 200 * FIFTEEN
    acc.prune(later)
    # The oldest pending target still anchors retention, so ITS 96-row window
    # survives even though the newer target alone would have evicted it.
    assert (T - 96 * FIFTEEN) in acc.candles_15m.versions
    acc.close_target(T)
    acc.prune(later)
    assert (T - 96 * FIFTEEN) not in acc.candles_15m.versions
    assert len(acc.candles_15m.versions) <= 96


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
    assert len(acc.candles_15m.versions) == 100
