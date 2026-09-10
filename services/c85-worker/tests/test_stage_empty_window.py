"""Two measured defects, proven fixed, with nothing else exercised.

1. An EMPTY first sub-window (no trade in [T, T+1s)) must leave every aggregate
   of that sub-window NaN — the canonical empty-window template — instead of
   deleting the column and making the derived anchor block raise
   `KeyError: 'binance_spot_t5_w001_return_bps'` (the measured 05:45 failure).
2. The market diagnostics must record what the venue actually served, and must
   never invent a strike.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.features import (  # noqa: E402
    base_anchor_fields,
    binance_cross_fields,
    binance_window_features,
)

from src.feeds import MarketBuffer  # noqa: E402
from src.litea.reconstruct import empty_window_template  # noqa: E402

TARGET_MS = 1_757_476_800_000  # 2026-09-10 05:45:00Z, the failing boundary
TARGET_US = TARGET_MS * 1000


def events(offsets_us: list[int]) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "ts_us": [TARGET_US + o for o in offsets_us],
            "price": [100_000.0 + i for i in range(len(offsets_us))],
            "quantity": [0.5] * len(offsets_us),
            "quote": [50_000.0] * len(offsets_us),
            "signed": [1.0] * len(offsets_us),
            "underlying_n": [1] * len(offsets_us),
        }
    )


def staged_row(offsets_us: list[int]) -> dict:
    """The exact row shape the live stage now builds."""
    row: dict = {"ts": pd.Timestamp(TARGET_MS, unit="ms", tz="UTC"),
                 "target_ms": TARGET_MS, **empty_window_template()}
    row.update(binance_window_features(events(offsets_us), TARGET_MS, "binance_spot"))
    row.update(binance_window_features(events(offsets_us), TARGET_MS, "binance_um"))
    return row


def test_empty_first_second_is_nan_not_absent():
    """No trade before T+1s, real trades later: the 05:45 shape."""
    row = staged_row([1_500_000, 2_500_000, 4_100_000, 4_900_000])
    assert "binance_spot_t5_w001_return_bps" in row
    assert np.isnan(row["binance_spot_t5_w001_return_bps"])
    assert not np.isnan(row["binance_spot_t5_w005_return_bps"])
    # The derived anchor block no longer raises on the missing column.
    frame = base_anchor_fields(pd.DataFrame([{**row, "spot_t0_price": 100_000.0,
                                              "floor_strike": 99_500.0}]))
    assert len(frame) == 1


def test_fully_populated_packet_is_untouched_by_the_template():
    """When every sub-window has events, the template changes nothing."""
    offsets = [-o for o in (900_000_000, 60_000_000, 3_000_000, 1_000)] + [
        100_000, 1_100_000, 2_100_000, 4_100_000
    ]
    with_template = staged_row(offsets)
    bare = {}
    bare.update(binance_window_features(events(offsets), TARGET_MS, "binance_spot"))
    for name, value in bare.items():
        assert with_template[name] == value or (
            np.isnan(value) and np.isnan(with_template[name])
        )


def test_empty_window_template_covers_every_selected_input():
    """Nothing in the template is zero — an unobserved window is NaN."""
    template = empty_window_template()
    assert template and all(np.isnan(v) for v in template.values())


def test_market_diagnostics_distinguish_late_from_defect():
    buffer = MarketBuffer("kalshi_markets")
    freeze = TARGET_MS * 1_000_000 + 5_400_000_000
    buffer.observe(TARGET_MS, {"poll_started_ns": freeze - 3_000_000_000,
                               "receipt_ns": freeze - 2_900_000_000,
                               "kind": "recorded", "strike_state": "null",
                               "status": "initialized"})
    late = freeze + 900_000_000
    buffer.observe(TARGET_MS, {"poll_started_ns": late - 100_000_000,
                               "receipt_ns": late, "kind": "recorded",
                               "strike_state": "finite", "status": "active"})
    diagnostics = buffer.diagnostics(TARGET_MS, freeze)
    assert diagnostics["polls"] == 2
    assert diagnostics["polls_before_freeze"] == 1
    assert diagnostics["finite_strike_before_freeze"] is False
    assert diagnostics["finite_strike_late_by_ms"] == 900
    # No market was ever recorded, so nothing is invented.
    assert buffer.get(TARGET_MS, freeze) is None
    assert diagnostics["stored_strike_state"] is None


def test_strikeless_record_never_overwrites_a_strike_and_is_counted():
    buffer = MarketBuffer("kalshi_markets")
    receipt = TARGET_MS * 1_000_000
    buffer.record(TARGET_MS, {"ticker": "T", "floor_strike": 99_500.0,
                              "status": "active", "receipt_ns": receipt})
    buffer.record(TARGET_MS, {"ticker": "T", "floor_strike": None,
                              "status": "initialized", "receipt_ns": receipt + 1})
    assert buffer.markets[TARGET_MS]["floor_strike"] == 99_500.0
    assert buffer.diagnostics(TARGET_MS, receipt + 10)["suppressed_overwrites"] == 1


@pytest.mark.parametrize(
    "raw,expected",
    [(None, "null"), (0, "zero"), (float("nan"), "nonfinite"),
     ("abc", "unparsable"), (99_500, "finite")],
)
def test_strike_state_reports_what_the_venue_sent(raw, expected):
    from src.feeds import KalshiStrikeCollector

    assert KalshiStrikeCollector._strike_state(raw) == expected
