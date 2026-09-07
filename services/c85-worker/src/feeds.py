"""Live market-data collectors with honest event/receipt timestamping.

Each collector keeps a rolling in-memory buffer of raw trades. Every record
carries BOTH the exchange event time and the local receipt time in integer
nanoseconds, because the T+5s ceiling is a *receipt* deadline, not a slicing
convenience: only events with event_ns < T+5s that were actually received before
the packet freeze may enter a live packet.

Feeds required by unchanged C85:

    binance_spot   BTCUSDT   spot trades          (direction t0/t5 windows)
    binance_um     BTCUSDT   USD-M perp trades    (direction t0/t5 windows)
    binance_cm     BTCUSD_PERP COIN-M trades      (cm_* features, T-16m .. T-1ms)
    binance_usdc   BTCUSDC   spot trades          (usdc anchor basis)
    binance_index  BTCUSDT   index price stream   (index anchor basis)
    binance_1m     BTCUSDT   completed 1m klines  (auxiliary 23 features, ends T-1ms)
    kalshi         KXBTC15M  target market trades (market_q1, last_yes_price, settlement)

A feed that has not produced a fresh record inside its freshness budget is
STALE and fails the packet closed. Collectors never interpolate, never
back-fill a missing tick and never move a timestamp.
"""
from __future__ import annotations

import asyncio
import bisect
import json
import time
from dataclasses import dataclass, field
from typing import Any, Iterable

import websockets

NS = 1_000_000_000


def now_ns() -> int:
    return time.time_ns()


@dataclass(frozen=True)
class Trade:
    event_ns: int
    receipt_ns: int
    price: float
    quantity: float
    quote_quantity: float
    buyer_is_maker: bool
    trade_id: int | None = None

    @property
    def taker_buy(self) -> bool:
        # Binance: buyer_is_maker True means the aggressive side was the seller.
        return not self.buyer_is_maker


@dataclass
class FeedBuffer:
    """Rolling, time-ordered trade buffer for one venue/symbol."""

    name: str
    retain_ns: int = 20 * 60 * NS
    freshness_budget_ns: int = 5 * NS
    trades: list[Trade] = field(default_factory=list)
    last_event_ns: int = -1
    last_receipt_ns: int = -1
    connected_since_ns: int | None = None
    disconnects: int = 0
    error: str | None = None

    def append(self, trade: Trade) -> None:
        self.trades.append(trade)
        self.last_event_ns = max(self.last_event_ns, trade.event_ns)
        self.last_receipt_ns = max(self.last_receipt_ns, trade.receipt_ns)
        horizon = trade.receipt_ns - self.retain_ns
        if self.trades and self.trades[0].receipt_ns < horizon:
            keep = bisect.bisect_left([t.receipt_ns for t in self.trades], horizon)
            if keep > 0:
                del self.trades[:keep]

    def slice(self, start_ns: int, end_ns: int, frozen_at_ns: int) -> list[Trade]:
        """Trades with start_ns <= event_ns < end_ns that arrived before the freeze.

        The receipt filter is the whole point: a historical [T, T+5) window is
        not evidence that those events were available to decide with.
        """
        return [
            t
            for t in self.trades
            if start_ns <= t.event_ns < end_ns and t.receipt_ns <= frozen_at_ns
        ]

    def freshness(self, at_ns: int) -> dict[str, Any]:
        age = None if self.last_receipt_ns < 0 else at_ns - self.last_receipt_ns
        return {
            "feed": self.name,
            "connected": self.connected_since_ns is not None,
            "last_event_ns": str(self.last_event_ns),
            "last_receipt_ns": str(self.last_receipt_ns),
            "age_ns": None if age is None else str(age),
            "stale": age is None or age > self.freshness_budget_ns,
            "disconnects": self.disconnects,
            "error": self.error,
        }

    def is_fresh(self, at_ns: int) -> bool:
        return not self.freshness(at_ns)["stale"]


class BinanceTradeCollector:
    """Persistent websocket collector for one Binance aggregate-trade stream."""

    def __init__(self, buffer: FeedBuffer, ws_base: str, stream: str) -> None:
        self.buffer = buffer
        self.url = f"{ws_base}?streams={stream}"

    async def run(self) -> None:
        backoff = 0.5
        while True:
            try:
                async with websockets.connect(
                    self.url, ping_interval=15, ping_timeout=10, max_queue=4096
                ) as ws:
                    self.buffer.connected_since_ns = now_ns()
                    self.buffer.error = None
                    backoff = 0.5
                    async for raw in ws:
                        receipt = now_ns()
                        self._ingest(raw, receipt)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - collectors must never die
                self.buffer.connected_since_ns = None
                self.buffer.disconnects += 1
                self.buffer.error = f"{type(exc).__name__}: {exc}"
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 15.0)

    def _ingest(self, raw: str | bytes, receipt_ns: int) -> None:
        payload = json.loads(raw)
        data = payload.get("data", payload)
        if data.get("e") not in ("aggTrade", "trade"):
            return
        price = float(data["p"])
        quantity = float(data["q"])
        self.buffer.append(
            Trade(
                event_ns=int(data["T"]) * 1_000_000,
                receipt_ns=receipt_ns,
                price=price,
                quantity=quantity,
                quote_quantity=price * quantity,
                buyer_is_maker=bool(data.get("m", False)),
                trade_id=data.get("a") or data.get("t"),
            )
        )


class FeedRegistry:
    """All feeds C85 needs, with a single fail-closed readiness view."""

    REQUIRED = (
        "binance_spot",
        "binance_um",
        "binance_cm",
        "binance_usdc",
        "binance_index",
        "binance_1m",
        "kalshi",
    )

    def __init__(self, env: dict[str, str]) -> None:
        spot_ws = env.get("BINANCE_SPOT_WS", "wss://stream.binance.com:9443/stream")
        um_ws = env.get("BINANCE_UM_WS", "wss://fstream.binance.com/stream")
        cm_ws = env.get("BINANCE_CM_WS", "wss://dstream.binance.com/stream")
        self.buffers: dict[str, FeedBuffer] = {
            name: FeedBuffer(name) for name in self.REQUIRED
        }
        # COIN-M features look back 16 minutes, so it retains a longer window.
        self.buffers["binance_cm"].retain_ns = 30 * 60 * NS
        self.buffers["binance_1m"].freshness_budget_ns = 90 * NS
        self.buffers["kalshi"].freshness_budget_ns = 120 * NS
        self._collectors = [
            BinanceTradeCollector(self.buffers["binance_spot"], spot_ws, "btcusdt@aggTrade"),
            BinanceTradeCollector(self.buffers["binance_um"], um_ws, "btcusdt@aggTrade"),
            BinanceTradeCollector(self.buffers["binance_cm"], cm_ws, "btcusd_perp@aggTrade"),
            BinanceTradeCollector(self.buffers["binance_usdc"], spot_ws, "btcusdc@aggTrade"),
        ]
        self._tasks: list[asyncio.Task] = []

    async def start(self) -> None:
        for collector in self._collectors:
            self._tasks.append(asyncio.create_task(collector.run()))

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()

    def watermarks(self, at_ns: int | None = None) -> dict[str, Any]:
        at_ns = at_ns or now_ns()
        return {name: buf.freshness(at_ns) for name, buf in self.buffers.items()}

    def missing(self, at_ns: int | None = None) -> list[str]:
        at_ns = at_ns or now_ns()
        return [name for name in self.REQUIRED if not self.buffers[name].is_fresh(at_ns)]

    def ready(self, at_ns: int | None = None) -> bool:
        return not self.missing(at_ns)
