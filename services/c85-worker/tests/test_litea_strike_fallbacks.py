"""Version 1's strike fallbacks: official > CF BRTI > Chainlink Data Streams.

Every frame fixture here is the shape the vendor actually documents, not a
shape invented to match the parser.
"""
from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.feeds import MarketBuffer  # noqa: E402
from src.litea.strike_policy import (  # noqa: E402
    INPUT_POLICY_VERSION,
    choose_strike,
    official_difference,
)
from src.reference import (  # noqa: E402
    CFBenchmarksCollector,
    ChainlinkStreamsCollector,
    ReferenceBuffer,
    decode_v3_report,
)

TARGET_MS = 1_710_000_000_000 - (1_710_000_000_000 % (15 * 60_000))  # a quarter hour
NS = 1_000_000_000
FREEZE_NS = (TARGET_MS + 5_000) * 1_000_000


# --------------------------------------------------------------------------- #
# fixtures in the vendors' documented shapes
# --------------------------------------------------------------------------- #
def cf_frame(time_ms: int, value: str, window: dict | None = None) -> dict:
    """The documented `cfbenchmarks_value` envelope (msg.data is a STRING)."""
    message = {
        "index_id": "BRTI",
        "received_at": time_ms,
        "data": json.dumps(
            {"type": "value", "id": "BRTI", "time": time_ms, "value": value}
        ),
        "avg_60s_data": {
            "value": value,
            "window_size": 3,
            "window_start_ts_ms": time_ms - 60_000,
            "window_end_ts_exclusive": time_ms,
        },
    }
    if window is not None:
        message["last_60s_windowed_average_15min"] = window
    return {"type": "cfbenchmarks_value", "sid": 1, "seq": 42, "msg": message}


def v3_full_report(
    feed_id: str, valid_from: int, observed: int, expires: int, price: float
) -> str:
    """A v3 report blob inside the documented outer abi.encode envelope."""

    def word(value: int) -> bytes:
        return int(value).to_bytes(32, "big")

    blob = b"".join(
        [
            bytes.fromhex(feed_id[2:]),
            word(valid_from),
            word(observed),
            word(0),
            word(0),
            word(expires),
            word(int(price * 1e18)),
            word(int(price * 1e18) - 10**16),
            word(int(price * 1e18) + 10**16),
        ]
    )
    head = b"".join(word(0) for _ in range(3)) + word(32 * 8)
    tail = b"".join(word(0) for _ in range(4))
    return "0x" + (head + tail + word(len(blob)) + blob).hex()


FEED_ID = "0x" + "00033" + "a" * 59


def chainlink_body(observed: int, expires: int, price: float) -> dict:
    return {
        "report": {
            "feedID": FEED_ID,
            "validFromTimestamp": observed - 1,
            "observationsTimestamp": observed,
            "fullReport": v3_full_report(FEED_ID, observed - 1, observed, expires, price),
        }
    }


def cf_buffer(ticks: int = 60, start_offset_ms: int = 0, price: float = 68_000.0):
    buffer = ReferenceBuffer("cf_brti", source="cf_brti")
    collector = CFBenchmarksCollector(buffer, "wss://x", "key", "pem")
    for index in range(ticks):
        stamp = TARGET_MS - (ticks - 1 - index) * 1000 - start_offset_ms
        collector.ingest(cf_frame(stamp, f"{price:.2f}"), (stamp + 20) * 1_000_000)
    return buffer, collector


def market(strike, receipt_ns: int = (TARGET_MS - 60_000) * 1_000_000, ticker="KX-A"):
    return {
        "ticker": ticker,
        "floor_strike": strike,
        "open_time": "x",
        "close_time": "y",
        "receipt_ns": receipt_ns,
    }


# --------------------------------------------------------------------------- #
# CF Benchmarks: the documented envelope
# --------------------------------------------------------------------------- #
def test_documented_cf_frame_is_decoded_from_the_data_string():
    buffer, collector = cf_buffer(ticks=1)
    assert buffer.ticks and buffer.ticks[0][1] == 68_000.0


def test_a_frame_for_another_index_is_ignored():
    buffer = ReferenceBuffer("cf_brti", source="cf_brti")
    collector = CFBenchmarksCollector(buffer, "wss://x", "key", "pem")
    frame = cf_frame(TARGET_MS, "68000.00")
    frame["msg"]["index_id"] = "ETHUSD_RTI"
    assert collector.ingest(frame, FREEZE_NS) is False
    assert buffer.ticks == []
    # No implicit BRTI default: a frame without the field is not assumed.
    frame["msg"].pop("index_id")
    assert collector.ingest(frame, FREEZE_NS) is False


def test_completed_quarter_hour_window_is_used_verbatim():
    buffer = ReferenceBuffer("cf_brti", source="cf_brti")
    collector = CFBenchmarksCollector(buffer, "wss://x", "key", "pem")
    collector.ingest(
        cf_frame(
            TARGET_MS,
            "68000.12",
            window={
                "value": "68000.23000000",
                "window_size": 60,
                "window_start_ts_ms": TARGET_MS - 60_000,
                "window_end_ts_exclusive": TARGET_MS,
            },
        ),
        (TARGET_MS + 30) * 1_000_000,
    )
    candidate = buffer.boundary_reference(TARGET_MS, FREEZE_NS)
    assert candidate["usable"] and candidate["method"] == "venue_60s_final_average"
    assert candidate["value"] == 68000.23 and candidate["estimated"] is True


def test_partial_final_minute_counts_are_not_final():
    buffer = ReferenceBuffer("cf_brti", source="cf_brti")
    collector = CFBenchmarksCollector(buffer, "wss://x", "key", "pem")
    collector.ingest(
        cf_frame(
            TARGET_MS - 46_000,
            "68000.12",
            window={
                "value": "67999.00",
                "window_size": 14,
                "window_start_ts_ms": TARGET_MS - 60_000,
                "window_end_ts_exclusive": TARGET_MS - 46_000,
            },
        ),
        (TARGET_MS - 46_000) * 1_000_000,
    )
    assert buffer.exact_averages == {}


def test_the_earliest_eligible_completed_window_is_retained():
    buffer = ReferenceBuffer("cf_brti", source="cf_brti")
    window = {
        "value": "68000.23000000",
        "window_size": 60,
        "window_start_ts_ms": TARGET_MS - 60_000,
        "window_end_ts_exclusive": TARGET_MS,
    }
    buffer.record_exact_average(
        window["value"],
        window_size=60,
        window_start_ms=window["window_start_ts_ms"],
        window_end_ms=window["window_end_ts_exclusive"],
        receipt_ns=10,
    )
    buffer.record_exact_average(
        "70000.00",
        window_size=60,
        window_start_ms=window["window_start_ts_ms"],
        window_end_ms=window["window_end_ts_exclusive"],
        receipt_ns=99,
    )
    assert buffer.exact_averages[TARGET_MS]["value"] == 68000.23
    assert buffer.exact_averages[TARGET_MS]["receipt_ns"] == 10


def test_a_window_for_a_different_boundary_is_not_this_targets_average():
    buffer = ReferenceBuffer("cf_brti", source="cf_brti")
    other = TARGET_MS - 15 * 60_000
    buffer.record_exact_average(
        "68000.23", window_size=60, window_start_ms=other - 60_000,
        window_end_ms=other, receipt_ns=1,
    )
    candidate = buffer.boundary_reference(TARGET_MS, FREEZE_NS)
    assert candidate.get("method") != "venue_60s_final_average"
    assert candidate["usable"] is False


# --------------------------------------------------------------------------- #
# causal approximation
# --------------------------------------------------------------------------- #
def test_causal_approximation_is_tagged_and_uses_only_the_window():
    buffer, _ = cf_buffer(ticks=60)
    candidate = buffer.boundary_reference(TARGET_MS, FREEZE_NS)
    assert candidate["usable"] and candidate["method"] == "causal_approx_60s_mean"
    assert candidate["estimated"] is True and candidate["tick_count"] == 60


def test_thirty_ticks_crammed_into_the_last_half_minute_fail_the_leading_gap():
    buffer = ReferenceBuffer("cf_brti", source="cf_brti")
    collector = CFBenchmarksCollector(buffer, "wss://x", "key", "pem")
    for index in range(30):
        stamp = TARGET_MS - (29 - index) * 1000
        collector.ingest(cf_frame(stamp, "68000.00"), stamp * 1_000_000)
    candidate = buffer.boundary_reference(TARGET_MS, FREEZE_NS)
    assert candidate["usable"] is False and candidate["reason"] == "window_gap"
    assert candidate["leading_gap_ms"] > 5_000


def test_ticks_received_after_the_freeze_are_excluded():
    buffer, _ = cf_buffer(ticks=60)
    early_freeze = (TARGET_MS - 60_000) * 1_000_000
    assert buffer.boundary_reference(TARGET_MS, early_freeze)["usable"] is False


def test_a_stale_source_cannot_describe_the_boundary():
    buffer, _ = cf_buffer(ticks=60, start_offset_ms=10_000)
    candidate = buffer.boundary_reference(TARGET_MS, FREEZE_NS)
    assert candidate["usable"] is False and candidate["reason"] == "stale_at_boundary"


def test_a_disabled_feed_is_never_usable_and_says_why():
    buffer = ReferenceBuffer("cf_brti", source="cf_brti")
    CFBenchmarksCollector(buffer, "wss://x", None, None)
    candidate = buffer.boundary_reference(TARGET_MS, FREEZE_NS)
    assert candidate == {**candidate, "usable": False, "reason": "credentials_missing"}
    assert buffer.connected_since_ns is None


# --------------------------------------------------------------------------- #
# Chainlink Data Streams
# --------------------------------------------------------------------------- #
def test_v3_report_decodes_to_its_documented_fields():
    observed = TARGET_MS // 1000
    decoded = decode_v3_report(
        v3_full_report(FEED_ID, observed - 1, observed, observed + 60, 68_010.5)
    )
    assert decoded["feed_id"] == FEED_ID
    assert decoded["observations_ts"] == observed
    assert round(decoded["benchmark_price"], 2) == 68_010.5


def test_a_short_blob_is_not_read_as_a_v3_report():
    assert decode_v3_report("0x" + "00" * (32 * 7)) is None


def test_chainlink_report_is_ingested_and_units_are_usd():
    buffer = ReferenceBuffer("chainlink_streams", source="chainlink_streams")
    collector = ChainlinkStreamsCollector(
        buffer, "https://api.dataengine.chain.link", FEED_ID, "user", "secret"
    )
    for index in range(60):
        second = TARGET_MS // 1000 - (59 - index)
        assert collector.ingest(
            chainlink_body(second, second + 60, 68_010.0), second * NS
        )
    candidate = buffer.boundary_reference(TARGET_MS, FREEZE_NS)
    assert candidate["usable"] and candidate["value"] == 68_010.0


def test_expired_or_inconsistent_reports_are_refused():
    buffer = ReferenceBuffer("chainlink_streams", source="chainlink_streams")
    collector = ChainlinkStreamsCollector(
        buffer, "https://x", FEED_ID, "user", "secret"
    )
    second = TARGET_MS // 1000
    assert collector.ingest(chainlink_body(second, second, 68_000.0), NS) is False
    mismatched = chainlink_body(second, second + 60, 68_000.0)
    mismatched["report"]["observationsTimestamp"] = second + 900
    assert collector.ingest(mismatched, NS) is False
    wrong_feed = chainlink_body(second, second + 60, 68_000.0)
    wrong_feed["report"]["fullReport"] = v3_full_report(
        "0x" + "11" * 32, second - 1, second, second + 60, 68_000.0
    )
    assert collector.ingest(wrong_feed, NS) is False
    assert buffer.ticks == []


def test_a_report_that_expires_before_the_boundary_is_not_used():
    buffer = ReferenceBuffer("chainlink_streams", source="chainlink_streams")
    collector = ChainlinkStreamsCollector(
        buffer, "https://x", FEED_ID, "user", "secret"
    )
    for index in range(60):
        second = TARGET_MS // 1000 - (59 - index)
        collector.ingest(chainlink_body(second, second + 1, 68_010.0), second * NS)
    assert buffer.boundary_reference(TARGET_MS, FREEZE_NS)["usable"] is False


# --------------------------------------------------------------------------- #
# priority and provenance
# --------------------------------------------------------------------------- #
def references(cf_ok: bool = True, link_ok: bool = True) -> dict:
    cf, _ = cf_buffer(ticks=60 if cf_ok else 0, price=68_000.0)
    link = ReferenceBuffer("chainlink_streams", source="chainlink_streams")
    collector = ChainlinkStreamsCollector(link, "https://x", FEED_ID, "u", "s")
    if link_ok:
        for index in range(60):
            second = TARGET_MS // 1000 - (59 - index)
            collector.ingest(chainlink_body(second, second + 60, 68_500.0), second * NS)
    return {"cf_brti": cf, "chainlink_streams": link}


def test_official_strike_wins_over_both_references():
    record = choose_strike(market(77_313.34), references(), TARGET_MS, FREEZE_NS)
    assert record["strike"] == 77_313.34
    assert record["strike_source"] == "official" and record["estimated"] is False
    assert record["input_policy_version"] == INPUT_POLICY_VERSION


def test_cf_is_preferred_over_chainlink_when_the_strike_is_missing():
    record = choose_strike(market(None), references(), TARGET_MS, FREEZE_NS)
    assert record["strike_source"] == "cf_brti" and record["estimated"] is True
    assert record["strike"] == 68_000.0
    assert record["source_failures"]["official"] == "no_floor_strike"
    assert record["value_receipt_ns"] and record["event_window"]


def test_chainlink_rescues_the_boundary_when_cf_is_unusable():
    record = choose_strike(
        market(None), references(cf_ok=False), TARGET_MS, FREEZE_NS
    )
    assert record["strike_source"] == "chainlink_streams"
    assert record["strike"] == 68_500.0
    assert record["source_failures"]["cf_brti"] == "no_ticks_in_window"


def test_all_sources_unusable_is_an_honest_refusal():
    record = choose_strike(
        market(None), references(cf_ok=False, link_ok=False), TARGET_MS, FREEZE_NS
    )
    assert record["strike"] is None and record["strike_source"] is None
    assert set(record["source_failures"]) == {"official", "cf_brti", "chainlink_streams"}


def test_official_conflict_refuses_rather_than_falling_back():
    record = choose_strike(
        market(None), references(), TARGET_MS, FREEZE_NS, official_conflict=True
    )
    assert record["strike"] is None and record["refused"] == "official_paths_disagree"


def test_a_late_official_strike_is_audit_only():
    record = choose_strike(market(None), references(), TARGET_MS, FREEZE_NS)
    audit = official_difference(record, 68_010.0)
    assert audit["audit_only"] is True and audit["difference"] == -10.0
    # The frozen record is untouched by the audit.
    assert record["strike"] == 68_000.0 and record["strike_source"] == "cf_brti"


# --------------------------------------------------------------------------- #
# official conflict eligibility (MarketBuffer)
# --------------------------------------------------------------------------- #
def test_a_post_freeze_conflicting_backup_cannot_invalidate_the_freeze():
    buffer = MarketBuffer("kalshi_markets")
    early = (TARGET_MS - 60_000) * 1_000_000
    late = (TARGET_MS + 60_000) * 1_000_000
    buffer.record(TARGET_MS, market(77_313.34, early), source="primary")
    buffer.record(TARGET_MS, market(80_000.0, late), source="backup")
    assert buffer.eligible_conflict(TARGET_MS, FREEZE_NS) is None
    chosen, why = buffer.chosen(TARGET_MS, FREEZE_NS)
    assert why == "primary" and chosen["floor_strike"] == 77_313.34
    # Both eligible and disagreeing IS a conflict.
    assert buffer.eligible_conflict(TARGET_MS, late) is not None


# --------------------------------------------------------------------------- #
# concurrency: both references collect at the same time
# --------------------------------------------------------------------------- #
def test_both_reference_feeds_collect_concurrently():
    async def scenario() -> tuple[int, int]:
        cf = ReferenceBuffer("cf_brti", source="cf_brti")
        link = ReferenceBuffer("chainlink_streams", source="chainlink_streams")
        cf_collector = CFBenchmarksCollector(cf, "wss://x", "k", "p")
        link_collector = ChainlinkStreamsCollector(
            link, "https://x", FEED_ID, "u", "s"
        )

        async def feed_cf() -> None:
            for index in range(10):
                cf_collector.ingest(
                    cf_frame(TARGET_MS - (9 - index) * 1000, "68000.00"), NS
                )
                await asyncio.sleep(0)

        async def feed_link() -> None:
            for index in range(10):
                second = TARGET_MS // 1000 - (9 - index)
                link_collector.ingest(
                    chainlink_body(second, second + 60, 68_500.0), NS
                )
                await asyncio.sleep(0)

        await asyncio.gather(feed_cf(), feed_link())
        return len(cf.ticks), len(link.ticks)

    assert asyncio.run(scenario()) == (10, 10)
