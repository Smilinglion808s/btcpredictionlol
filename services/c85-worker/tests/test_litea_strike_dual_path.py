"""Version 1's two OFFICIAL strike paths.

Both paths ask the same venue for the same contract. Neither substitutes a
price, borrows another interval, or bypasses a published rate limit. These
tests pin exactly the behaviours that decide whether a boundary may be scored.
"""
from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.feeds import (  # noqa: E402
    LIMITER,
    KalshiStrikeBackupCollector,
    KalshiStrikeCollector,
    MarketBuffer,
)

TARGET_MS = 1_757_512_800_000  # 2025-09-10T14:00:00Z, exact 15m boundary
INTERVAL_MS = 15 * 60_000
BASE = "https://api.example.invalid/trade-api/v2"


def _market(ticker: str, strike, *, target_ms: int = TARGET_MS) -> dict:
    import datetime as dt

    def iso(ms: int) -> str:
        return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )

    return {
        "ticker": ticker,
        "floor_strike": strike,
        "status": "active",
        "open_time": iso(target_ms),
        "close_time": iso(target_ms + INTERVAL_MS),
    }


class FakeResponse:
    def __init__(self, payload: dict, status: int = 200) -> None:
        self._payload = payload
        self.status_code = status
        self.headers: dict[str, str] = {}

    def json(self) -> dict:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    @property
    def text(self) -> str:
        return ""


class FakeClient:
    """Serves each path from a handler, recording call order and concurrency."""

    def __init__(self, handler) -> None:
        self.handler = handler
        self.in_flight = 0
        self.max_in_flight = 0
        self.urls: list[str] = []

    async def get(self, url: str):
        self.urls.append(url)
        self.in_flight += 1
        self.max_in_flight = max(self.max_in_flight, self.in_flight)
        try:
            return await self.handler(url)
        finally:
            self.in_flight -= 1


def _collectors(buffer: MarketBuffer):
    return (
        KalshiStrikeCollector(buffer, BASE, "KXBTC15M"),
        KalshiStrikeBackupCollector(buffer, BASE, "KXBTC15M"),
    )


def test_paths_hit_distinct_documented_endpoints():
    buffer = MarketBuffer("kalshi_markets")
    primary, backup = _collectors(buffer)
    ticker = primary.ticker_for(TARGET_MS)
    assert primary.request_url(ticker) == f"{BASE}/markets/{ticker}"
    assert backup.request_url(ticker) == f"{BASE}/markets?tickers={ticker}"
    assert "status=open" not in backup.request_url(ticker)


def test_both_paths_run_concurrently():
    """A slow answer on one path must not hold the other one up.

    The venue's shared minimum spacing still applies between requests — that
    is the rate limit, not a dependency — but the two paths overlap in flight
    and the quick one finishes while the slow one is still waiting.
    """
    buffer = MarketBuffer("kalshi_markets")
    primary, backup = _collectors(buffer)
    ticker = primary.ticker_for(TARGET_MS)
    finished: list[str] = []

    async def handler(url: str):
        if "tickers=" in url:
            await asyncio.sleep(0.05)
            return FakeResponse({"markets": [_market(ticker, 77_000.5)]})
        await asyncio.sleep(2.0)  # primary is slow
        return FakeResponse({"market": _market(ticker, 77_000.5)})

    client = FakeClient(handler)

    async def run():
        async def poll(name, collector):
            await collector._poll_once(client, TARGET_MS)
            finished.append(name)

        started = time.monotonic()
        tasks = [
            asyncio.create_task(poll("primary", primary)),
            asyncio.create_task(poll("backup", backup)),
        ]
        await asyncio.wait(tasks, timeout=1.5)
        elapsed = time.monotonic() - started
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        return elapsed

    elapsed = asyncio.run(run())
    assert client.max_in_flight == 2, "the two official paths did not overlap"
    assert finished == ["backup"], "the backup waited on the slow primary"
    assert elapsed < 1.5
    assert MarketBuffer._usable(buffer.sources[TARGET_MS]["backup"])


def test_primary_is_preferred_when_both_are_usable():
    buffer = MarketBuffer("kalshi_markets")
    ticker = "KXBTC15M-T"
    buffer.record(TARGET_MS, {**_market(ticker, 77_000.0), "receipt_ns": 50}, source="backup")
    buffer.record(TARGET_MS, {**_market(ticker, 77_000.0), "receipt_ns": 80}, source="primary")
    record, why = buffer.chosen(TARGET_MS, frozen_at_ns=100)
    assert why == "primary" and record["floor_strike"] == 77_000.0
    assert buffer.diagnostics(TARGET_MS, 100)["backup_rescued"] is False


def test_backup_rescues_a_boundary_the_primary_left_strikeless():
    buffer = MarketBuffer("kalshi_markets")
    ticker = "KXBTC15M-T"
    buffer.record(TARGET_MS, {**_market(ticker, None), "receipt_ns": 40}, source="primary")
    buffer.record(TARGET_MS, {**_market(ticker, 77_313.34), "receipt_ns": 60}, source="backup")
    record, why = buffer.chosen(TARGET_MS, frozen_at_ns=100)
    assert why == "backup" and record["floor_strike"] == 77_313.34
    diag = buffer.diagnostics(TARGET_MS, 100)
    assert diag["backup_rescued"] is True
    assert diag["source_chosen"] == "backup"
    assert diag["primary"]["held_strike_state"] == "null"


def test_primary_transport_failure_does_not_invalidate_the_backup():
    buffer = MarketBuffer("kalshi_markets")
    primary, backup = _collectors(buffer)
    ticker = primary.ticker_for(TARGET_MS)

    async def handler(url: str):
        if "tickers=" in url:
            return FakeResponse({"markets": [_market(ticker, 77_100.0)]})
        raise RuntimeError("connection reset")

    client = FakeClient(handler)

    async def run():
        with pytest.raises(RuntimeError):
            await primary._poll_once(client, TARGET_MS)
        primary._publish_transport("RuntimeError: connection reset")
        await backup._poll_once(client, TARGET_MS)
        backup._publish_transport(None)

    asyncio.run(run())
    assert buffer.error is None, "a live backup must keep the source valid"
    assert buffer.chosen(TARGET_MS, frozen_at_ns=now_after(buffer))[1] == "backup"


def now_after(buffer: MarketBuffer) -> int:
    return max(int(r["receipt_ns"]) for r in buffer.sources[TARGET_MS].values()) + 1


def test_backup_received_after_the_freeze_is_excluded():
    buffer = MarketBuffer("kalshi_markets")
    ticker = "KXBTC15M-T"
    buffer.record(TARGET_MS, {**_market(ticker, 77_000.0), "receipt_ns": 500}, source="backup")
    record, why = buffer.chosen(TARGET_MS, frozen_at_ns=100)
    assert record is None and why == "none_by_freeze"


def test_wrong_ticker_and_wrong_window_are_never_recorded():
    buffer = MarketBuffer("kalshi_markets")
    primary, backup = _collectors(buffer)
    ticker = primary.ticker_for(TARGET_MS)
    other = "KXBTC15M-OTHER"

    async def handler(url: str):
        if "tickers=" in url:  # right ticker, WRONG window
            return FakeResponse(
                {"markets": [_market(ticker, 77_000.0, target_ms=TARGET_MS + INTERVAL_MS)]}
            )
        return FakeResponse({"market": _market(other, 66_000.0)})  # wrong contract

    client = FakeClient(handler)

    async def run():
        await primary._poll_once(client, TARGET_MS)
        await backup._poll_once(client, TARGET_MS)

    asyncio.run(run())
    assert buffer.sources.get(TARGET_MS, {}) == {}
    kinds = buffer.diagnostics(TARGET_MS, 10**19)["outcomes"]
    assert kinds.get("ticker_mismatch") == 1
    assert kinds.get("window_mismatch") == 1


def test_a_null_refresh_or_late_response_cannot_erase_an_eligible_strike():
    buffer = MarketBuffer("kalshi_markets")
    ticker = "KXBTC15M-T"
    buffer.record(TARGET_MS, {**_market(ticker, 77_000.0), "receipt_ns": 50}, source="primary")
    buffer.record(TARGET_MS, {**_market(ticker, None), "receipt_ns": 70}, source="primary")
    buffer.record(TARGET_MS, {**_market(ticker, 88_888.0), "receipt_ns": 900}, source="primary")
    record, why = buffer.chosen(TARGET_MS, frozen_at_ns=100)
    assert why == "primary"
    assert record["floor_strike"] == 77_000.0
    assert int(record["receipt_ns"]) == 50, "a strike must keep its own receipt"
    assert buffer.suppressed_overwrites[TARGET_MS] == 2


def test_disagreement_between_official_paths_refuses_the_boundary():
    buffer = MarketBuffer("kalshi_markets")
    ticker = "KXBTC15M-T"
    buffer.record(TARGET_MS, {**_market(ticker, 77_000.0), "receipt_ns": 50}, source="primary")
    buffer.record(TARGET_MS, {**_market(ticker, 77_500.0), "receipt_ns": 60}, source="backup")
    record, why = buffer.chosen(TARGET_MS, frozen_at_ns=100)
    assert record is None and why == "conflict"
    diag = buffer.diagnostics(TARGET_MS, 100)
    assert diag["same_contract_verified"] is False
    assert diag["conflict"]["primary_strike"] == 77_000.0
    assert diag["conflict"]["backup_strike"] == 77_500.0


def test_neither_path_available_yields_no_strike_and_a_reason():
    buffer = MarketBuffer("kalshi_markets")
    record, why = buffer.chosen(TARGET_MS, frozen_at_ns=100)
    assert record is None and why == "none_by_freeze"
    assert buffer.diagnostics(TARGET_MS, 100)["no_source_reason"] == "none_by_freeze"


def test_backup_shares_the_venue_backoff_and_cannot_out_run_it():
    buffer = MarketBuffer("kalshi_markets")
    _, backup = _collectors(buffer)
    ticker = backup.ticker_for(TARGET_MS)
    url = backup.request_url(ticker)

    class Limited(FakeResponse):
        def __init__(self) -> None:
            super().__init__({}, status=429)
            self.headers = {"retry-after": "30"}

    LIMITER.note(url, Limited())
    try:
        assert LIMITER.banned_for(url) > 25
        # the primary endpoint is the SAME host, so it is held back too
        assert LIMITER.banned_for(f"{BASE}/markets/{ticker}") > 25
    finally:
        LIMITER._banned_until.clear()
        LIMITER._next_at.clear()
