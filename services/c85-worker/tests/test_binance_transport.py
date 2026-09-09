"""Contract tests for the Binance transport adapters and buffer safety.

These cover the collector-input hazards specifically, not feature parity (that
lives in test_binance_windows_parity.py). Nothing here is a live-parity claim.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.experts.binance_windows import (  # noqa: E402
    HISTORICAL,
    LIVE,
    TRANSPORTS,
    BinanceWindowAccumulator,
    TransportError,
    VenueBuffer,
)

SPOT_MS = 1_788_913_080_217          # observed live spot websocket value
SPOT_US = SPOT_MS * 1000


def ws_payload(**overrides):
    payload = {
        "e": "aggTrade", "a": 4_059_449_654, "p": "78681.16000000",
        "q": "0.01512000", "f": 6_666_699_062, "l": 6_666_699_089,
        "T": SPOT_MS, "m": False,
    }
    payload.update(overrides)
    return payload


# -- units ------------------------------------------------------------------
def test_live_spot_is_milliseconds_even_though_the_spot_archive_is_micros():
    """The exact defect: unit follows the transport, never the venue."""
    live = TRANSPORTS["spot_ws_aggTrade"].parse(ws_payload(), receipt_ns=1)
    assert live["ts_us"] == SPOT_US

    archive_row = {
        "agg_trade_id": 1, "price": "1.0", "quantity": "1.0", "first_trade_id": 1,
        "last_trade_id": 1, "transact_time": SPOT_US, "is_buyer_maker": False,
    }
    assert TRANSPORTS["spot_archive_csv"].parse(archive_row)["ts_us"] == SPOT_US
    # Same venue, same instant, two different declared units - both correct.
    assert TRANSPORTS["spot_ws_aggTrade"].time_unit != TRANSPORTS["spot_archive_csv"].time_unit


def test_a_mis_declared_unit_is_rejected_not_silently_shifted():
    """Feeding microseconds to the millisecond adapter must fail loudly."""
    with pytest.raises(TransportError, match="outside the plausible band"):
        TRANSPORTS["spot_ws_aggTrade"].parse(ws_payload(T=SPOT_US), receipt_ns=1)


# -- schema strictness ------------------------------------------------------
@pytest.mark.parametrize("bad", ["0", 0, 1, None, "yes", "true_"])
def test_malformed_booleans_are_rejected_rather_than_truthy(bad):
    """`bool('false')` is True in Python; a side must never be decided that way."""
    with pytest.raises(TransportError):
        TRANSPORTS["spot_ws_aggTrade"].parse(ws_payload(m=bad), receipt_ns=1)


def test_real_boolean_strings_map_to_the_source_sign_convention():
    assert TRANSPORTS["spot_ws_aggTrade"].parse(ws_payload(m="true"), receipt_ns=1)["signed"] == -1.0
    assert TRANSPORTS["spot_ws_aggTrade"].parse(ws_payload(m="false"), receipt_ns=1)["signed"] == 1.0


@pytest.mark.parametrize("field,bad", [("p", "abc"), ("q", None), ("p", "NaN"), ("a", "x"), ("T", "")])
def test_malformed_numerics_are_rejected(field, bad):
    with pytest.raises(TransportError):
        TRANSPORTS["spot_ws_aggTrade"].parse(ws_payload(**{field: bad}), receipt_ns=1)


def test_reversed_trade_id_range_is_rejected():
    with pytest.raises(TransportError, match="last_trade_id"):
        TRANSPORTS["spot_ws_aggTrade"].parse(ws_payload(f=10, l=5), receipt_ns=1)


def test_a_live_transport_must_carry_a_receipt_time():
    with pytest.raises(TransportError, match="receipt_ns"):
        TRANSPORTS["spot_ws_aggTrade"].parse(ws_payload())


# -- identity and idempotence ----------------------------------------------
def test_repeat_delivery_of_the_same_agg_trade_is_stored_once():
    acc = BinanceWindowAccumulator()
    assert acc.ingest("spot_ws_aggTrade", ws_payload(), receipt_ns=1) is True
    assert acc.ingest("spot_ws_aggTrade", ws_payload(), receipt_ns=999) is False
    assert len(acc.buffers["spot"].events) == 1


def test_rest_backfill_overlapping_the_live_stream_adds_nothing():
    acc = BinanceWindowAccumulator()
    acc.ingest("spot_ws_aggTrade", ws_payload(a=1), receipt_ns=5)
    acc.ingest("spot_ws_aggTrade", ws_payload(a=2, T=SPOT_MS + 1), receipt_ns=6)
    added = acc.ingest_bootstrap(
        "spot_rest_bootstrap",
        [ws_payload(a=1), ws_payload(a=2, T=SPOT_MS + 1), ws_payload(a=3, T=SPOT_MS + 2)],
        available_at_ns=7,
    )
    assert added == 1                       # only the genuinely new one
    assert len(acc.buffers["spot"].events) == 3


def test_same_timestamp_events_order_by_agg_id_regardless_of_receipt_order():
    """Shuffled arrival must not change the frame the features are built from."""
    payloads = [ws_payload(a=aid, p=f"{100 + aid}.0") for aid in (10, 11, 12, 13)]
    ordered, shuffled = BinanceWindowAccumulator(), BinanceWindowAccumulator()
    for p in payloads:
        ordered.ingest("spot_ws_aggTrade", p, receipt_ns=1)
    for p in reversed(payloads):
        shuffled.ingest("spot_ws_aggTrade", p, receipt_ns=1)
    a = ordered.buffers["spot"].frame()
    b = shuffled.buffers["spot"].frame()
    assert a.equals(b)
    assert list(a["price"]) == [110.0, 111.0, 112.0, 113.0]


# -- availability -----------------------------------------------------------
def test_unknown_availability_is_excluded_and_counted_in_live_mode():
    acc = BinanceWindowAccumulator()
    acc.buffers["spot"].add_event({
        "agg_trade_id": 1, "ts_us": SPOT_US, "price": 1.0, "quantity": 1.0,
        "underlying_n": 1, "signed": 1.0, "quote": 1.0, "receipt_ns": -1,
        "provenance": "archive",
    })
    live = acc.buffers["spot"].frame(mode=LIVE, freeze_ns=10**18)
    assert live.empty
    assert acc.buffers["spot"].excluded_unknown_availability == 1
    # Historical replay has no availability filter at all.
    assert len(acc.buffers["spot"].frame(mode=HISTORICAL)) == 1


def test_events_received_after_the_freeze_are_excluded():
    acc = BinanceWindowAccumulator()
    acc.ingest("spot_ws_aggTrade", ws_payload(a=1), receipt_ns=100)
    acc.ingest("spot_ws_aggTrade", ws_payload(a=2, T=SPOT_MS + 1), receipt_ns=300)
    assert len(acc.buffers["spot"].frame(mode=LIVE, freeze_ns=200)) == 1


def test_bootstrap_rows_are_usable_only_from_their_recorded_arrival():
    acc = BinanceWindowAccumulator()
    acc.ingest_bootstrap("spot_rest_bootstrap", [ws_payload(a=1)], available_at_ns=500)
    assert acc.buffers["spot"].frame(mode=LIVE, freeze_ns=499).empty
    assert len(acc.buffers["spot"].frame(mode=LIVE, freeze_ns=500)) == 1


def test_live_mode_requires_a_freeze_instant():
    with pytest.raises(ValueError, match="freeze"):
        VenueBuffer("spot").frame(mode=LIVE)


def test_archive_ingest_cannot_be_passed_off_as_bootstrap():
    with pytest.raises(TransportError, match="not a bootstrap transport"):
        BinanceWindowAccumulator().ingest_bootstrap(
            "spot_ws_aggTrade", [ws_payload()], available_at_ns=1
        )


# -- coverage, duplicates and retention -------------------------------------
def _cover(acc, target_us):
    start, end = acc.window_us(target_us)
    for venue in ("spot", "um"):
        acc.declare_coverage(venue, start, end, "collector")


def test_a_recorded_reconnect_gap_marks_an_overlapping_targets_inputs_incomplete():
    acc = BinanceWindowAccumulator()
    target_us = (SPOT_US // 900_000_000) * 900_000_000 + 900_000_000
    _cover(acc, target_us)
    assert acc.input_coverage(target_us)["inputs_complete"] is True
    acc.mark_gap("spot", (target_us - 60_000_000) * 1000, (target_us - 30_000_000) * 1000)
    report = acc.input_coverage(target_us)
    assert report["inputs_complete"] is False
    assert report["venues"]["spot"]["receipt_gaps"]


def test_a_gap_outside_the_targets_window_is_not_counted_against_it():
    acc = BinanceWindowAccumulator()
    target_us = 1_800_000_000_000_000
    _cover(acc, target_us)
    start, _ = acc.window_us(target_us)
    acc.mark_gap("spot", (start - 600_000_000) * 1000, (start - 300_000_000) * 1000)
    assert acc.input_coverage(target_us)["inputs_complete"] is True


def test_one_ancient_trade_does_not_make_a_sparse_bootstrap_covered():
    acc = BinanceWindowAccumulator()
    target_us = 1_800_000_000_000_000
    acc.buffers["spot"].add_event({
        "agg_trade_id": 1, "ts_us": target_us - 5_000_000_000, "price": 1.0,
        "quantity": 1.0, "underlying_n": 1, "signed": 1.0, "quote": 1.0,
        "receipt_ns": 1, "provenance": "bootstrap",
    })
    assert acc.has_history(target_us, "spot") is False
    start, end = acc.window_us(target_us)
    acc.declare_coverage("spot", start, end, "rest_pagination")
    assert acc.has_history(target_us, "spot") is True


def test_partial_coverage_of_the_window_is_not_enough():
    acc = BinanceWindowAccumulator()
    target_us = 1_800_000_000_000_000
    start, end = acc.window_us(target_us)
    acc.declare_coverage("spot", start, end - 1_000_000, "collector")
    assert acc.has_history(target_us, "spot") is False


def test_an_identical_duplicate_merges_the_earliest_known_receipt():
    buffer = VenueBuffer("spot")
    base = {"agg_trade_id": 7, "ts_us": 100, "price": 1.0, "quantity": 2.0,
            "underlying_n": 1, "signed": 2.0, "quote": 2.0}
    assert buffer.add_event({**base, "receipt_ns": -1, "provenance": "archive"}) is True
    assert buffer.add_event({**base, "receipt_ns": 500, "provenance": "live"}) is False
    stored = buffer.events[7]
    assert stored["receipt_ns"] == 500 and stored["provenance"] == "live"
    # A later replay must never back-date an already known receipt.
    buffer.add_event({**base, "receipt_ns": 900, "provenance": "live"})
    assert buffer.events[7]["receipt_ns"] == 500
    assert buffer.merged_duplicates == 2
    # And the merged row is now visible to a LIVE read that it was invisible to.
    assert len(buffer.frame(mode=LIVE, freeze_ns=600)) == 1


def test_a_conflicting_duplicate_is_quarantined_not_applied():
    buffer = VenueBuffer("spot")
    base = {"agg_trade_id": 7, "ts_us": 100, "price": 1.0, "quantity": 2.0,
            "underlying_n": 1, "signed": 2.0, "quote": 2.0, "receipt_ns": 5,
            "provenance": "live"}
    buffer.add_event(dict(base))
    assert buffer.add_event({**base, "price": 9.0, "receipt_ns": 6}) is False
    assert buffer.events[7]["price"] == 1.0
    assert len(buffer.conflicts) == 1
    assert buffer.conflicts[0]["rejected"]["price"] == 9.0


def test_unknown_availability_only_blocks_targets_that_read_the_event():
    acc = BinanceWindowAccumulator()
    target_us = 1_800_000_000_000_000
    _cover(acc, target_us)
    for venue in ("spot", "um"):
        acc.buffers[venue].add_event({
            "agg_trade_id": 1, "ts_us": target_us - 400_000_000, "price": 1.0,
            "quantity": 1.0, "underlying_n": 1, "signed": 1.0, "quote": 1.0,
            "receipt_ns": -1, "provenance": "archive",
        })
    assert acc.input_coverage(target_us, mode=LIVE, freeze_ns=10**18)[
        "inputs_complete"] is False
    far = target_us + 4 * 900_000_000
    _cover(acc, far)
    assert acc.input_coverage(far, mode=LIVE, freeze_ns=10**18)["inputs_complete"] is True


def test_pruning_never_drops_a_pending_targets_inputs():
    acc = BinanceWindowAccumulator()
    older = 1_800_000_000_000_000
    newer = older + 900_000_000
    acc.open_target(older)
    acc.buffers["spot"].add_event({
        "agg_trade_id": 1, "ts_us": older - 800_000_000, "price": 1.0, "quantity": 1.0,
        "underlying_n": 1, "signed": 1.0, "quote": 1.0, "receipt_ns": 1, "provenance": "live",
    })
    acc.prune(newer)                       # newer target alone would evict it
    assert len(acc.buffers["spot"].events) == 1
    acc.close_target(older)
    acc.prune(newer)
    assert len(acc.buffers["spot"].events) == 0


def test_pruning_trims_the_coverage_claim_with_the_events():
    acc = BinanceWindowAccumulator()
    target_us = 1_800_000_000_000_000
    acc.declare_coverage("spot", target_us - 5_000_000_000, target_us + 5_000_000, "collector")
    acc.prune(target_us)
    assert acc.has_history(target_us, "spot") is True
    later = target_us + 900_000_000
    acc.prune(later)
    assert acc.has_history(later, "spot") is False    # coverage was trimmed away
    assert acc.buffers["spot"].coverage[0][0] == later - 900_000_000


# -- state ------------------------------------------------------------------
def test_state_round_trips_including_ids_gaps_and_pending_targets():
    acc = BinanceWindowAccumulator()
    acc.ingest("spot_ws_aggTrade", ws_payload(a=7), receipt_ns=11)
    acc.mark_gap("um", 1, 2)
    acc.open_target(1_800_000_000_000_000)
    restored = BinanceWindowAccumulator.loads(acc.dumps())
    assert restored.dumps() == acc.dumps()
    assert 7 in restored.buffers["spot"].events
    assert restored.buffers["um"].gaps == [(1, 2)]
    assert restored.pending_targets == {1_800_000_000_000_000}
    json.loads(acc.dumps())


def test_restart_then_replay_matches_uninterrupted_ingestion():
    payloads = [ws_payload(a=100 + i, T=SPOT_MS + i) for i in range(6)]
    straight = BinanceWindowAccumulator()
    for p in payloads:
        straight.ingest("spot_ws_aggTrade", p, receipt_ns=1)

    part = BinanceWindowAccumulator()
    for p in payloads[:3]:
        part.ingest("spot_ws_aggTrade", p, receipt_ns=1)
    resumed = BinanceWindowAccumulator.loads(part.dumps())
    for p in payloads[1:]:                      # deliberate overlap after restart
        resumed.ingest("spot_ws_aggTrade", p, receipt_ns=1)

    assert resumed.buffers["spot"].frame().equals(straight.buffers["spot"].frame())
