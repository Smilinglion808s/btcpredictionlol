"""Version 1's SHIPPED strike policy: official > Coinbase > Kraken.

Every frame here is copied from an actual message captured on the public
websockets (Coinbase Exchange `matches` + `heartbeat`, Kraken spot v2 `trade`),
not a shape invented to match the parser. Neither socket needs a key, an
account or a purchase.

What these backups are NOT: the contract's own index. They are irregular trade
prints, so the value they produce is a disclosed ESTIMATE
(`causal_approx_60s_trade_mean`) of the opening boundary, used only when the
official same-contract strike is absent.
"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.litea.strike_policy import (  # noqa: E402
    INPUT_POLICY_VERSION,
    PRIORITY,
    choose_strike,
    official_difference,
)
from src.reference import (  # noqa: E402
    CoinbaseMatchesCollector,
    KrakenTradeCollector,
    ReferenceBuffer,
)

NS = 1_000_000_000
TARGET_MS = 1_710_000_000_000 - (1_710_000_000_000 % (15 * 60_000))
FREEZE_NS = (TARGET_MS + 5_000) * 1_000_000


def stamp(ms: int) -> str:
    return (
        datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


def coinbase_match(ms: int, price: float, trade_id: int, kind: str = "match") -> dict:
    """An actual BTC-USD frame from wss://ws-feed.exchange.coinbase.com."""
    return {
        "type": kind,
        "trade_id": trade_id,
        "maker_order_id": "528b5f3e-5d16-45c4-8654-27b81a24c8da",
        "taker_order_id": "8a512ed8-c9d7-49d4-9fd8-62d33a2f6586",
        "side": "buy",
        "size": "0.00000569",
        "price": f"{price:.2f}",
        "product_id": "BTC-USD",
        "sequence": 135884496028,
        "time": stamp(ms),
    }


def kraken_trade(rows: list[tuple[int, float, int]]) -> dict:
    """An actual batched BTC/USD update from wss://ws.kraken.com/v2."""
    return {
        "channel": "trade",
        "type": "update",
        "data": [
            {
                "symbol": "BTC/USD",
                "side": "sell",
                "price": price,
                "qty": 5.24e-05,
                "ord_type": "limit",
                "trade_id": trade_id,
                "timestamp": stamp(ms),
            }
            for ms, price, trade_id in rows
        ],
    }


def coinbase_buffer(ticks: int = 60, price: float = 68_000.0, offset_ms: int = 0):
    buffer = ReferenceBuffer("coinbase_btcusd", source="coinbase_btcusd")
    collector = CoinbaseMatchesCollector(buffer)
    for index in range(ticks):
        ms = TARGET_MS - (ticks - 1 - index) * 1000 - offset_ms
        collector.ingest(coinbase_match(ms, price, 900_000 + index), (ms + 20) * 1_000_000)
    return buffer, collector


def kraken_buffer(ticks: int = 60, price: float = 68_500.0):
    buffer = ReferenceBuffer("kraken_btcusd", source="kraken_btcusd")
    collector = KrakenTradeCollector(buffer)
    for index in range(ticks):
        ms = TARGET_MS - (ticks - 1 - index) * 1000
        collector.ingest(
            kraken_trade([(ms, price, 100_000 + index)]), (ms + 20) * 1_000_000
        )
    return buffer, collector


def market(strike, receipt_ns: int = (TARGET_MS - 60_000) * 1_000_000):
    return {
        "ticker": "KXBTC15M-A",
        "floor_strike": strike,
        "open_time": "x",
        "close_time": "y",
        "receipt_ns": receipt_ns,
    }


def references(coinbase_ok: bool = True, kraken_ok: bool = True) -> dict:
    return {
        "coinbase_btcusd": coinbase_buffer(ticks=60 if coinbase_ok else 0)[0],
        "kraken_btcusd": kraken_buffer(ticks=60 if kraken_ok else 0)[0],
    }


# --------------------------------------------------------------------------- #
# documented public payloads
# --------------------------------------------------------------------------- #
def test_the_actual_coinbase_match_frame_is_decoded():
    buffer, collector = coinbase_buffer(ticks=1)
    assert len(buffer.ticks) == 1
    ts, value, _receipt, _expires, event = buffer.ticks[0]
    assert value == 68_000.0 and ts == TARGET_MS and event == 900_000
    assert collector.ingest({"type": "ticker", "product_id": "BTC-USD"}, NS) is False


def test_a_heartbeat_marks_liveness_without_inventing_a_price():
    buffer = ReferenceBuffer("coinbase_btcusd", source="coinbase_btcusd")
    collector = CoinbaseMatchesCollector(buffer)
    assert (
        collector.ingest(
            {"type": "heartbeat", "product_id": "BTC-USD", "last_trade_id": 1}, 7 * NS
        )
        is False
    )
    assert buffer.ticks == [] and collector.heartbeats == 1
    assert buffer.last_receipt_ns == 7 * NS


def test_another_product_is_ignored():
    buffer = ReferenceBuffer("coinbase_btcusd", source="coinbase_btcusd")
    frame = coinbase_match(TARGET_MS, 3_000.0, 1)
    frame["product_id"] = "ETH-USD"
    assert CoinbaseMatchesCollector(buffer).ingest(frame, NS) is False
    assert buffer.ticks == []


def test_a_kraken_batch_stores_every_trade_in_it():
    buffer = ReferenceBuffer("kraken_btcusd", source="kraken_btcusd")
    collector = KrakenTradeCollector(buffer)
    rows = [(TARGET_MS - 2000, 68_500.0, 1), (TARGET_MS - 1000, 68_501.0, 2)]
    assert collector.ingest(kraken_trade(rows), NS) is True
    assert [t[1] for t in buffer.ticks] == [68_500.0, 68_501.0]
    # Status and subscription acknowledgements are not trades.
    assert collector.ingest({"channel": "status", "type": "update", "data": []}, NS) is False
    assert collector.ingest({"method": "subscribe", "success": True}, NS) is False


def test_another_symbol_in_the_batch_is_skipped():
    buffer = ReferenceBuffer("kraken_btcusd", source="kraken_btcusd")
    frame = kraken_trade([(TARGET_MS, 3_000.0, 5)])
    frame["data"][0]["symbol"] = "ETH/USD"
    assert KrakenTradeCollector(buffer).ingest(frame, NS) is False
    assert buffer.ticks == []


# --------------------------------------------------------------------------- #
# deduplication and ordering
# --------------------------------------------------------------------------- #
def test_a_replayed_event_id_is_not_counted_twice():
    buffer, collector = coinbase_buffer(ticks=60)
    before = len(buffer.ticks)
    assert collector.ingest(coinbase_match(TARGET_MS, 99_999.0, 900_059), NS) is False
    assert len(buffer.ticks) == before
    assert buffer.boundary_reference(TARGET_MS, FREEZE_NS)["value"] == 68_000.0


def test_a_late_arriving_earlier_print_cannot_rewrite_a_second():
    buffer, collector = coinbase_buffer(ticks=60)
    # Same second, EARLIER source time, received later. Deterministic choice is
    # by source time, so the settled value must not move.
    collector.ingest(coinbase_match(TARGET_MS - 800, 1.0, 999_999), FREEZE_NS - 1)
    assert buffer.boundary_reference(TARGET_MS, FREEZE_NS)["value"] == 68_000.0


# --------------------------------------------------------------------------- #
# window discipline
# --------------------------------------------------------------------------- #
def test_the_estimate_is_labelled_as_irregular_trade_sampling():
    buffer, _ = coinbase_buffer()
    detail = buffer.boundary_reference(TARGET_MS, FREEZE_NS)
    assert detail["usable"] is True
    assert detail["method"] == "causal_approx_60s_trade_mean"
    assert detail["value"] == 68_000.0 and detail["tick_count"] == 60


def test_thirty_prints_in_the_last_half_minute_fail_the_leading_gap():
    buffer = ReferenceBuffer("coinbase_btcusd", source="coinbase_btcusd")
    collector = CoinbaseMatchesCollector(buffer)
    for index in range(30):
        ms = TARGET_MS - (29 - index) * 1000
        collector.ingest(coinbase_match(ms, 68_000.0, index), (ms + 5) * 1_000_000)
    detail = buffer.boundary_reference(TARGET_MS, FREEZE_NS)
    assert detail["usable"] is False and detail["reason"] == "window_gap"


def test_prints_received_after_the_freeze_are_excluded():
    buffer = ReferenceBuffer("coinbase_btcusd", source="coinbase_btcusd")
    collector = CoinbaseMatchesCollector(buffer)
    for index in range(60):
        ms = TARGET_MS - (59 - index) * 1000
        collector.ingest(coinbase_match(ms, 68_000.0, index), FREEZE_NS + NS)
    assert buffer.boundary_reference(TARGET_MS, FREEZE_NS)["usable"] is False


def test_a_stale_last_print_cannot_describe_the_boundary():
    buffer, _ = coinbase_buffer(ticks=60, offset_ms=30_000)
    detail = buffer.boundary_reference(TARGET_MS, FREEZE_NS)
    assert detail["usable"] is False and detail["reason"] == "stale_at_boundary"


def test_prints_after_the_boundary_are_not_used():
    buffer = ReferenceBuffer("coinbase_btcusd", source="coinbase_btcusd")
    collector = CoinbaseMatchesCollector(buffer)
    for index in range(60):
        ms = TARGET_MS + 1000 + index * 1000  # the T+5 window, not the opening
        collector.ingest(coinbase_match(ms, 68_000.0, index), (ms + 5) * 1_000_000)
    assert buffer.boundary_reference(TARGET_MS, FREEZE_NS)["usable"] is False


# --------------------------------------------------------------------------- #
# priority and provenance
# --------------------------------------------------------------------------- #
def test_the_shipped_priority_is_official_then_coinbase_then_kraken():
    assert PRIORITY == ("official", "coinbase_btcusd", "kraken_btcusd")
    assert INPUT_POLICY_VERSION == "strike-fallbacks-free-r1"


def test_the_official_strike_wins_over_both_backups():
    record = choose_strike(market(77_313.34), references(), TARGET_MS, FREEZE_NS)
    assert record["strike"] == 77_313.34
    assert record["strike_source"] == "official" and record["estimated"] is False
    assert record["input_policy_version"] == "strike-fallbacks-free-r1"


def test_coinbase_covers_a_missing_official_strike():
    record = choose_strike(market(None), references(), TARGET_MS, FREEZE_NS)
    assert record["strike_source"] == "coinbase_btcusd" and record["estimated"] is True
    assert record["strike"] == 68_000.0
    assert record["method"] == "causal_approx_60s_trade_mean"
    assert record["source_failures"]["official"] == "no_floor_strike"
    assert record["value_receipt_ns"] and record["event_window"]


def test_kraken_covers_the_boundary_when_coinbase_is_unusable():
    record = choose_strike(
        market(None), references(coinbase_ok=False), TARGET_MS, FREEZE_NS
    )
    assert record["strike_source"] == "kraken_btcusd"
    assert record["strike"] == 68_500.0
    assert record["source_failures"]["coinbase_btcusd"] == "no_ticks_in_window"


def test_no_usable_source_is_an_honest_refusal():
    record = choose_strike(
        market(None),
        references(coinbase_ok=False, kraken_ok=False),
        TARGET_MS,
        FREEZE_NS,
    )
    assert record["strike"] is None and record["strike_source"] is None
    assert set(record["source_failures"]) == {
        "official",
        "coinbase_btcusd",
        "kraken_btcusd",
    }


def test_two_disagreeing_official_paths_refuse_rather_than_estimate():
    record = choose_strike(
        market(None), references(), TARGET_MS, FREEZE_NS, official_conflict=True
    )
    assert record["strike"] is None and record["refused"] == "official_paths_disagree"


def test_a_later_official_strike_is_audit_only_and_never_rewrites_the_freeze():
    record = choose_strike(market(None), references(), TARGET_MS, FREEZE_NS)
    audit = official_difference(record, 68_010.0)
    assert audit["audit_only"] is True and audit["difference"] == -10.0
    assert record["strike"] == 68_000.0
    assert record["strike_source"] == "coinbase_btcusd"


# --------------------------------------------------------------------------- #
# concurrency
# --------------------------------------------------------------------------- #
def test_both_free_feeds_collect_at_the_same_time():
    async def scenario() -> tuple[int, int]:
        coinbase = ReferenceBuffer("coinbase_btcusd", source="coinbase_btcusd")
        kraken = ReferenceBuffer("kraken_btcusd", source="kraken_btcusd")
        cb = CoinbaseMatchesCollector(coinbase)
        kr = KrakenTradeCollector(kraken)

        async def feed_coinbase() -> None:
            for index in range(10):
                cb.ingest(
                    coinbase_match(TARGET_MS - (9 - index) * 1000, 68_000.0, index), NS
                )
                await asyncio.sleep(0)

        async def feed_kraken() -> None:
            for index in range(10):
                kr.ingest(
                    kraken_trade(
                        [(TARGET_MS - (9 - index) * 1000, 68_500.0, index)]
                    ),
                    NS,
                )
                await asyncio.sleep(0)

        await asyncio.gather(feed_coinbase(), feed_kraken())
        return len(coinbase.ticks), len(kraken.ticks)

    assert asyncio.run(scenario()) == (10, 10)


# --------------------------------------------------------------------------- #
# trade-tape sampling budgets
# --------------------------------------------------------------------------- #
def test_trade_backups_carry_their_own_disclosed_sampling_budgets():
    """A quiet minute on a thin tape is coverage, not corruption.

    Measured on the live sockets: Coinbase prints several times a second while
    Kraken can go ~7s without a trade. The trade budgets are wider than the
    index-grade ones, are attached to every estimate, and apply only here.
    """
    buffer, collector = coinbase_buffer(ticks=1)
    assert buffer.max_gap_ms == 20_000
    assert buffer.max_tick_age_ms == 10_000
    assert buffer.min_ticks == 20
    assert kraken_buffer(ticks=1)[0].max_gap_ms == 20_000
    # An index-grade buffer keeps the strict budgets.
    assert ReferenceBuffer("x", source="x").max_gap_ms == 5_000

    thin = ReferenceBuffer("kraken_btcusd", source="kraken_btcusd")
    thin_collector = KrakenTradeCollector(thin)
    for index in range(21):
        ms = TARGET_MS - index * 2_800
        thin_collector.ingest(
            kraken_trade([(ms, 68_500.0, index)]), (ms + 20) * 1_000_000
        )
    detail = thin.boundary_reference(TARGET_MS, FREEZE_NS)
    assert detail["usable"] is True and detail["max_gap_budget_ms"] == 20_000

    # A 25-second hole is still refused.
    holed = ReferenceBuffer("kraken_btcusd", source="kraken_btcusd")
    holed_collector = KrakenTradeCollector(holed)
    for index in range(20):
        ms = TARGET_MS - index * 1_000
        holed_collector.ingest(
            kraken_trade([(ms, 68_500.0, index)]), (ms + 20) * 1_000_000
        )
    assert holed.boundary_reference(TARGET_MS, FREEZE_NS)["usable"] is False
