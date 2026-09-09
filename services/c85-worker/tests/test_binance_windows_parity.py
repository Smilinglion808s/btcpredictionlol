"""Raw-trade parity for the Binance spot/UM window producer.

The comparison runs the ORIGINAL functions, compiled from
`build_multivenue_features_r1.py`'s own source text, against this worker's
transcription, over AUTHENTIC publisher raw aggTrade archives:

    binance_aggtrades/sample/binance_spot/BTCUSDT-aggTrades-2026-01-02.zip
    binance_aggtrades/sample/binance_um/BTCUSDT-aggTrades-2026-01-02.zip

Those samples are exact, unmodified line subsets of the full
data.binance.vision daily archives (2026-01-02 00:00-02:00 UTC), which were
themselves verified against the publisher's own .CHECKSUM files. Nothing in the
raw rows is synthesised.

Tests marked `synthetic edge case` build small hand-written event sets to probe
boundary endpoints, duplicates, out-of-order receipt and insufficient history.
They are supplemental and are NOT archived raw parity.
"""
from __future__ import annotations

import ast
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.experts.binance_windows import (  # noqa: E402
    FIFTEEN_MIN_US,
    ONE_SECOND_US,
    BinanceWindowAccumulator,
    build_binance_features,
    read_binance_archive,
)

CACHE = Path("/mnt/documents/.lovable/c85-cache")
ORIGINAL = CACHE / "upx/ancestor/source/6cf37dff6f5a/build_multivenue_features_r1.py"
SAMPLE = CACHE / "binance_aggtrades/sample"
SPOT = SAMPLE / "binance_spot/BTCUSDT-aggTrades-2026-01-02.zip"
UM = SAMPLE / "binance_um/BTCUSDT-aggTrades-2026-01-02.zip"

pytestmark = pytest.mark.skipif(
    not (ORIGINAL.exists() and SPOT.exists() and UM.exists()),
    reason="durable recovery cache / raw sample not mounted in this environment",
)

WANTED = (
    "merge_frames",
    "standardized_event_aggregate",
    "aggregate_event_windows",
    "read_binance_archive",
)


def original_namespace() -> dict:
    """Compile only the needed functions from the original module's own text.

    The module runs heavy top-level I/O on import; extracting the function
    nodes runs the ORIGINAL code unedited without that side effect.
    """
    tree = ast.parse(ORIGINAL.read_text())
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in WANTED]
    assert {n.name for n in nodes} == set(WANTED), "original functions not found"
    namespace: dict = {
        "pd": pd, "np": np, "Path": Path,
        "FIFTEEN_MIN_US": FIFTEEN_MIN_US, "ONE_SECOND_US": ONE_SECOND_US,
        "Any": __import__("typing").Any,
    }
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(ORIGINAL), "exec"), namespace)
    return namespace


def assert_exact(reference: pd.DataFrame, produced: pd.DataFrame, label: str) -> None:
    assert list(produced.columns) == list(reference.columns), f"{label}: column set/order differs"
    assert len(produced) == len(reference), f"{label}: row count differs"
    for column in reference.columns:
        a, b = reference[column], produced[column]
        if pd.api.types.is_numeric_dtype(a):
            af, bf = a.to_numpy(dtype=float), b.to_numpy(dtype=float)
            bad = ~np.isclose(af, bf, rtol=0, atol=0, equal_nan=True)
        else:
            bad = (a.astype(str) != b.astype(str)).to_numpy()
        assert not bad.any(), f"{label} {column}: {int(bad.sum())} cells differ"


@pytest.fixture(scope="module")
def original():
    return original_namespace()


@pytest.mark.parametrize("venue,path", [("spot", SPOT), ("um", UM)])
def test_raw_archive_reader_matches_original(original, venue, path):
    """Timestamp units, sign, quote and underlying_n straight off the raw tape."""
    reference = original["read_binance_archive"](path, venue)
    produced = read_binance_archive(path, venue)
    assert_exact(reference, produced, f"read_binance_archive/{venue}")
    assert len(produced) > 10_000
    # spot archives are microseconds, UM milliseconds *1000 — both land in 2026-01-02.
    assert 1_767_312_000_000_000 <= int(produced["ts_us"].min()) < 1_767_319_200_000_000


@pytest.mark.parametrize("venue,path", [("spot", SPOT), ("um", UM)])
def test_window_aggregation_matches_original_on_raw_trades(original, venue, path):
    raw = read_binance_archive(path, venue)
    reference = original["aggregate_event_windows"](raw, venue_prefix=f"binance_{venue}")
    from src.experts.binance_windows import aggregate_event_windows

    produced = aggregate_event_windows(raw, venue_prefix=f"binance_{venue}")
    assert_exact(reference, produced, f"aggregate_event_windows/{venue}")
    assert len(produced) >= 8  # two hours of quarter-hour targets, both sides


def test_full_binance_build_including_cross_columns(original):
    spot = read_binance_archive(SPOT, "spot")
    um = read_binance_archive(UM, "um")
    frames = []
    for venue, raw in (("spot", spot), ("um", um)):
        frames.append(
            original["aggregate_event_windows"](raw, venue_prefix=f"binance_{venue}")
            .drop_duplicates("target_ts", keep="last")
        )
    reference = original["merge_frames"](frames)
    for horizon in ("t0", "t5"):
        sf = f"binance_spot_{horizon}_w005_flow_imbalance"
        uf = f"binance_um_{horizon}_w005_flow_imbalance"
        sr = f"binance_spot_{horizon}_w005_return_bps"
        ur = f"binance_um_{horizon}_w005_return_bps"
        reference[f"binance_cross_{horizon}_flow_agreement_5s"] = np.sign(reference[sf]) * np.sign(reference[uf])
        reference[f"binance_cross_{horizon}_flow_gap_5s"] = reference[sf] - reference[uf]
        reference[f"binance_cross_{horizon}_return_agreement_5s"] = np.sign(reference[sr]) * np.sign(reference[ur])
        reference[f"binance_cross_{horizon}_return_gap_5s"] = reference[sr] - reference[ur]

    produced = build_binance_features(spot, um)
    assert_exact(reference, produced, "build_binance_features")


def test_live_accumulator_equals_the_archive_path_event_by_event():
    """Feeding the raw tape one event at a time reproduces the batch features."""
    spot = read_binance_archive(SPOT, "spot")
    um = read_binance_archive(UM, "um")
    batch = build_binance_features(spot, um)

    accumulator = BinanceWindowAccumulator()
    accumulator.ingest_archive("spot", SPOT)
    accumulator.ingest_archive("um", UM)

    # A fully covered target: 01:00Z has 900s of prior history inside the sample.
    target_us = 1_767_312_000_000_000 + 4 * FIFTEEN_MIN_US
    produced = accumulator.features_for(target_us)
    expected = batch.loc[batch["target_ts"] == pd.Timestamp(target_us, unit="us", tz="UTC")]
    assert not expected.empty and produced
    for name, value in produced.items():
        want = expected.iloc[0][name]
        if pd.isna(want):
            assert value is None, name
        else:
            assert value == pytest.approx(float(want), rel=0, abs=0), name


def test_restart_reload_reproduces_identical_features():
    accumulator = BinanceWindowAccumulator()
    accumulator.ingest_archive("spot", SPOT)
    accumulator.ingest_archive("um", UM)
    target_us = 1_767_312_000_000_000 + 4 * FIFTEEN_MIN_US
    before = accumulator.features_for(target_us)

    restored = BinanceWindowAccumulator.loads(accumulator.dumps())
    assert restored.features_for(target_us) == before


# -- synthetic edge cases (supplemental; NOT archived raw parity) -------------
def _event(accumulator, venue, agg_id, ts_us, price, qty, maker=False, receipt_ns=None):
    """Feed one event through a real transport adapter.

    With a receipt time this uses the websocket transport (milliseconds, the
    observed live unit); without one it uses the archive transport, whose
    availability is legitimately unknown.
    """
    if receipt_ns is None:
        name = f"{venue}_archive_csv"
        stamp = ts_us if venue == "spot" else ts_us // 1000
        payload = {
            "agg_trade_id": agg_id, "price": price, "quantity": qty,
            "first_trade_id": agg_id, "last_trade_id": agg_id,
            "transact_time": stamp, "is_buyer_maker": maker,
        }
    else:
        name = f"{venue}_ws_aggTrade"
        payload = {
            "a": agg_id, "p": price, "q": qty, "f": agg_id, "l": agg_id,
            "T": ts_us // 1000, "m": maker,
        }
    return accumulator.ingest(name, payload, receipt_ns=receipt_ns)


def test_synthetic_half_open_boundary_endpoints():
    """synthetic edge case: T+5s belongs to the NEXT target, never to this one."""
    accumulator = BinanceWindowAccumulator()
    target_us = 1_767_312_000_000_000
    _event(accumulator, "spot", 1, target_us, 100.0, 1.0)                      # exactly T -> in
    _event(accumulator, "spot", 2, target_us + 5 * ONE_SECOND_US - 1, 101.0, 1.0)  # T+4.999999 -> in
    _event(accumulator, "spot", 3, target_us + 5 * ONE_SECOND_US, 999.0, 1.0)  # exactly T+5s -> out
    features = accumulator.features_for(target_us)
    assert features["binance_spot_t5_w005_event_count"] == 2
    assert features["binance_spot_t5_w005_return_bps"] == pytest.approx(
        10_000.0 * (101.0 / 100.0 - 1.0)
    )
    # and the T0 side ends strictly before T
    _event(accumulator, "spot", 4, target_us - 1, 100.0, 1.0)
    assert accumulator.features_for(target_us)["binance_spot_t0_w005_event_count"] == 1


def test_synthetic_duplicates_and_out_of_order_receipt():
    """synthetic edge case: duplicate ids dropped; event time governs ordering."""
    accumulator = BinanceWindowAccumulator()
    target_us = 1_767_312_000_000_000
    _event(accumulator, "spot", 10, target_us + 2 * ONE_SECOND_US, 102.0, 1.0)
    _event(accumulator, "spot", 11, target_us + 1 * ONE_SECOND_US, 101.0, 1.0)  # arrives late
    assert accumulator.add(
        "spot", agg_trade_id=10, transact_time=target_us + 2 * ONE_SECOND_US,
        price=102.0, quantity=1.0, first_trade_id=10, last_trade_id=10, is_buyer_maker=False,
    ) is False
    features = accumulator.features_for(target_us)
    assert features["binance_spot_t5_w005_event_count"] == 2
    # first/last price follow EVENT time, not arrival order
    assert features["binance_spot_t5_w005_return_bps"] == pytest.approx(
        10_000.0 * (102.0 / 101.0 - 1.0)
    )


def test_synthetic_receipt_after_freeze_is_not_available():
    """synthetic edge case: event time in-window but received after the freeze."""
    accumulator = BinanceWindowAccumulator()
    target_us = 1_767_312_000_000_000
    freeze_ns = (target_us + 5 * ONE_SECOND_US) * 1000
    _event(accumulator, "spot", 20, target_us + ONE_SECOND_US, 100.0, 1.0, receipt_ns=freeze_ns - 10)
    _event(accumulator, "spot", 21, target_us + 2 * ONE_SECOND_US, 500.0, 1.0, receipt_ns=freeze_ns + 10)
    live = accumulator.features_for(target_us, freeze_ns=freeze_ns)
    assert live["binance_spot_t5_w005_event_count"] == 1
    assert accumulator.features_for(target_us)["binance_spot_t5_w005_event_count"] == 2


def test_synthetic_insufficient_history_and_empty_window():
    """synthetic edge case: no imputation — an empty window yields no column."""
    accumulator = BinanceWindowAccumulator()
    target_us = 1_767_312_000_000_000
    assert accumulator.features_for(target_us) == {}
    assert accumulator.has_history(target_us) is False
    _event(accumulator, "spot", 30, target_us + ONE_SECOND_US, 100.0, 1.0)
    features = accumulator.features_for(target_us)
    assert "binance_spot_t5_w005_event_count" in features
    # Nothing occurred before T, so the T0 columns exist (outer merge across
    # windows) but carry NaN -> None. They are never imputed to 0.
    assert features["binance_spot_t0_w900_event_count"] is None
    # The narrow T0 windows produced no rows at all for this target, so their
    # columns are simply absent rather than filled with zeros.
    assert "binance_spot_t0_w005_quote_volume" not in features
    assert accumulator.has_history(target_us) is False
