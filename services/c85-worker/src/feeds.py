"""Live market-data collectors with honest event/receipt timestamping.

Every record carries BOTH the exchange event time and the local receipt time in
integer nanoseconds, because the T+5s ceiling is a *receipt* deadline, not a
slicing convenience: only events with event_ns < T+5s that were actually
received before the packet freeze may enter a live packet.

Feeds required by C85:

    binance_spot   BTCUSDT   spot aggTrades       (direction t0/t5 windows)
    binance_um     BTCUSDT   USD-M perp aggTrades (direction t0/t5 windows)
    binance_cm     BTCUSD_PERP COIN-M aggTrades   (cm_* features, T-16m .. T-1ms)
    binance_usdc   BTCUSDC   spot aggTrades       (usdc anchor basis)
    binance_index  BTCUSDT   index price 1m klines(index anchor basis)
    binance_1m     BTCUSDT   completed 1m klines  (auxiliary features, ends T-1ms)
    kalshi         KXBTC15M  [T, T+5s) target trades (market_q1, last_yes_price)

Transports. Each Binance feed prefers its websocket stream. Some networks
accept the `fstream` (USD-M) handshake and then deliver no frames at all —
measured here on 2026-09-09: handshake 0.84s, zero messages in 20s, while
`fapi` REST returns 200. A feed that has produced no data within its websocket
grace period therefore falls back to REST polling of the SAME endpoint family
and reports `transport: "rest"`, so a degraded transport is visible instead of
looking like an outage. REST polling has a genuinely later receipt time; that
lateness is recorded, never hidden, and it is the receipt time that gates the
packet.

Nothing here interpolates, back-fills a missing tick or moves a timestamp. A
feed with no fresh received record is STALE and fails the packet closed.
"""
from __future__ import annotations

import asyncio
import bisect
import json
import os
import re
import time
import urllib.parse
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable


import httpx
import websockets

from .tickers import EASTERN, format_ticker

NS = 1_000_000_000


def now_ns() -> int:
    return time.time_ns()


# --------------------------------------------------------------------------- #
# venue rate-limit discipline
# --------------------------------------------------------------------------- #
class HostLimiter:
    """One shared, venue-respecting budget per REST host.

    Binance answers an over-weight address with 429 and then 418 ("banned until
    <epoch ms>"). Every collector in this process shares one address, so a ban
    earned by one poller silently starves all the others — which is exactly how
    a 16-minute COIN-M context ends up incomplete at a boundary. Retrying inside
    the ban only extends it.

    So each host gets: a minimum spacing between requests, and a hard deadline
    published by the venue itself (`Retry-After`, or the epoch in the 418 body).
    Nothing here bypasses a limit, rotates an address or hides a refusal.
    """

    MIN_INTERVAL_S = float(os.environ.get("LITEA_FEED_MIN_INTERVAL_S", "0.4"))

    def __init__(self) -> None:
        self._next_at: dict[str, float] = {}
        self._banned_until: dict[str, float] = {}

    @staticmethod
    def _host(url: str) -> str:
        return urllib.parse.urlsplit(url).netloc

    def banned_for(self, url: str) -> float:
        """Seconds still to wait for this host, 0 when free."""
        return max(0.0, self._banned_until.get(self._host(url), 0.0) - time.time())

    async def acquire(self, url: str) -> None:
        host = self._host(url)
        while True:
            wait = max(
                self._banned_until.get(host, 0.0) - time.time(),
                self._next_at.get(host, 0.0) - time.monotonic(),
            )
            if wait <= 0:
                break
            await asyncio.sleep(min(wait, 30.0))
        self._next_at[host] = time.monotonic() + self.MIN_INTERVAL_S

    def note(self, url: str, response: "httpx.Response | None", exc: Exception | None = None) -> None:
        """Record a venue refusal so every collector on this host backs off."""
        host = self._host(url)
        status = getattr(response, "status_code", None)
        body = ""
        if response is not None and status in (418, 429):
            try:
                body = response.text[:300]
            except Exception:  # noqa: BLE001
                body = ""
        elif exc is not None:
            body = str(exc)[:300]
            match = re.search(r"'(418|429)[^']*'", body)
            status = int(match.group(1)) if match else None
        if status not in (418, 429):
            return
        until = None
        deadline = re.search(r"banned until (\d+)", body)
        if deadline:
            until = int(deadline.group(1)) / 1000.0
        elif response is not None:
            retry_after = response.headers.get("retry-after")
            if retry_after and retry_after.strip().isdigit():
                until = time.time() + int(retry_after.strip())
        if until is None:
            until = time.time() + 120.0
        self._banned_until[host] = max(self._banned_until.get(host, 0.0), until)


#: Process-wide, because the venue counts the address, not the collector.
LIMITER = HostLimiter()



# --------------------------------------------------------------------------- #
# records
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Trade:
    """One Binance aggregate trade.

    `first_trade_id`/`last_trade_id` are the aggTrade `f`/`l` fields. They are
    NOT decoration: the archive builder's `underlying_n` is `l - f + 1`, the
    number of individual trades the aggregate covers, and
    `underlying_trade_count` sums it. Collapsing that to 1 per event would
    silently change a model input, so both ids are carried from the wire.
    """

    event_ns: int
    receipt_ns: int
    price: float
    quantity: float
    quote_quantity: float
    buyer_is_maker: bool
    trade_id: int | None = None
    first_trade_id: int | None = None
    last_trade_id: int | None = None

    @property
    def taker_buy(self) -> bool:
        # Binance: buyer_is_maker True means the aggressive side was the seller.
        return not self.buyer_is_maker

    @property
    def underlying_n(self) -> int:
        if self.first_trade_id is None or self.last_trade_id is None:
            raise ValueError(
                "underlying_n requires the aggTrade f/l ids; this record was built "
                "without them and must not enter a packet"
            )
        return int(self.last_trade_id) - int(self.first_trade_id) + 1


@dataclass(frozen=True)
class Kline:
    """One completed 1-minute kline. Only closed candles are ever stored."""

    open_ms: int
    close_ms: int
    receipt_ns: int
    open: float
    high: float
    low: float
    close: float
    base_volume: float
    quote_volume: float
    trade_count: int
    taker_buy_base: float


# --------------------------------------------------------------------------- #
# buffers
# --------------------------------------------------------------------------- #
@dataclass
class _BaseBuffer:
    name: str
    freshness_budget_ns: int = 5 * NS
    last_event_ns: int = -1
    last_receipt_ns: int = -1
    connected_since_ns: int | None = None
    disconnects: int = 0
    error: str | None = None
    transport: str = "none"

    def freshness(self, at_ns: int) -> dict[str, Any]:
        age = None if self.last_receipt_ns < 0 else at_ns - self.last_receipt_ns
        return {
            "feed": self.name,
            "connected": self.connected_since_ns is not None,
            "transport": self.transport,
            "last_event_ns": str(self.last_event_ns),
            "last_receipt_ns": str(self.last_receipt_ns),
            "age_ns": None if age is None else str(age),
            "stale": age is None or age > self.freshness_budget_ns,
            "disconnects": self.disconnects,
            "error": self.error,
        }

    def is_fresh(self, at_ns: int) -> bool:
        return not self.freshness(at_ns)["stale"]


@dataclass
class FeedBuffer(_BaseBuffer):
    """Rolling, time-ordered aggregate-trade buffer for one venue/symbol."""

    retain_ns: int = 20 * 60 * NS
    trades: list[Trade] = field(default_factory=list)
    _seen: set = field(default_factory=set)

    def append(self, trade: Trade) -> None:
        # REST fallback re-reads overlapping id ranges; the same aggregate must
        # never be counted twice into a window aggregate.
        key = trade.trade_id
        if key is not None:
            if key in self._seen:
                return
            self._seen.add(key)
        self.trades.append(trade)
        self.last_event_ns = max(self.last_event_ns, trade.event_ns)
        self.last_receipt_ns = max(self.last_receipt_ns, trade.receipt_ns)
        horizon = trade.receipt_ns - self.retain_ns
        if self.trades and self.trades[0].receipt_ns < horizon:
            keep = bisect.bisect_left([t.receipt_ns for t in self.trades], horizon)
            if keep > 0:
                dropped = self.trades[:keep]
                del self.trades[:keep]
                for item in dropped:
                    self._seen.discard(item.trade_id)

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


@dataclass
class KlineBuffer(_BaseBuffer):
    """Completed 1-minute klines keyed by open_ms."""

    freshness_budget_ns: int = 90 * NS
    retain_minutes: int = 240
    klines: dict[int, Kline] = field(default_factory=dict)

    def append(self, kline: Kline) -> None:
        previous = self.klines.get(kline.open_ms)
        if previous is not None and previous.receipt_ns <= kline.receipt_ns:
            # A closed minute is immutable; keep the first receipt we observed.
            self.last_receipt_ns = max(self.last_receipt_ns, kline.receipt_ns)
            return
        self.klines[kline.open_ms] = kline
        self.last_event_ns = max(self.last_event_ns, kline.close_ms * 1_000_000)
        self.last_receipt_ns = max(self.last_receipt_ns, kline.receipt_ns)
        if len(self.klines) > self.retain_minutes:
            for stale in sorted(self.klines)[: len(self.klines) - self.retain_minutes]:
                del self.klines[stale]

    def minute(self, open_ms: int, frozen_at_ns: int) -> Kline | None:
        found = self.klines.get(open_ms)
        if found is None or found.receipt_ns > frozen_at_ns:
            return None
        return found

    def window(self, first_open_ms: int, last_open_ms: int, frozen_at_ns: int) -> list[Kline]:
        """Every completed minute in [first, last], or [] if any is absent."""
        out: list[Kline] = []
        cursor = first_open_ms
        while cursor <= last_open_ms:
            found = self.minute(cursor, frozen_at_ns)
            if found is None:
                return []
            out.append(found)
            cursor += 60_000
        return out

    def missing_minutes(
        self, first_open_ms: int, last_open_ms: int, frozen_at_ns: int | None = None
    ) -> list[int]:
        """Exactly which completed minutes in [first, last] are NOT held.

        Named, not counted: "the context is incomplete" is not a diagnosis, and
        the repair loop needs to know what to ask the venue for.
        """
        frozen_at_ns = now_ns() if frozen_at_ns is None else frozen_at_ns
        return [
            cursor
            for cursor in range(first_open_ms, last_open_ms + 1, 60_000)
            if self.minute(cursor, frozen_at_ns) is None
        ]



@dataclass
class QuoteBuffer(_BaseBuffer):
    """Kalshi [T, T+5s) aggregates keyed by the target's epoch milliseconds."""

    freshness_budget_ns: int = 120 * NS
    windows: dict[int, dict[str, Any]] = field(default_factory=dict)
    retain: int = 96

    def append(self, target_ms: int, aggregate: dict[str, Any]) -> None:
        self.windows[target_ms] = aggregate
        self.last_event_ns = max(self.last_event_ns, (target_ms + 5_000) * 1_000_000)
        self.last_receipt_ns = max(self.last_receipt_ns, int(aggregate["receipt_ns"]))
        if len(self.windows) > self.retain:
            for stale in sorted(self.windows)[: len(self.windows) - self.retain]:
                del self.windows[stale]

    def note_poll(self, receipt_ns: int) -> None:
        """A successful API round-trip keeps the CONNECTION fresh.

        A fresh connection is explicitly NOT evidence that this target's window
        was received: `window()` still requires the aggregate itself, received
        at or before the caller's freeze.
        """
        self.last_receipt_ns = max(self.last_receipt_ns, receipt_ns)

    def window(self, target_ms: int, frozen_at_ns: int) -> dict[str, Any] | None:
        """The target's aggregate, only if it arrived at or before the freeze.

        The Kalshi `[T, T+5s)` window can only be REQUESTED after T+5s, so a
        packet frozen at the T+5 deadline can never legitimately contain it.
        Returning None there is the measured deadline conflict, not a bug; the
        alternative — handing back a later REST body under an earlier declared
        freeze — would be backdating.
        """
        found = self.windows.get(target_ms)
        if found is None or int(found.get("receipt_ns", 0)) > frozen_at_ns:
            return None
        return found


@dataclass
class MarketBuffer(_BaseBuffer):
    """Listed KXBTC15M market metadata, keyed by the target's epoch milliseconds.

    This is the strike source Version 1 actually needs. Unlike the `[T, T+5s)`
    trade aggregate — which can only be REQUESTED after the T+5s deadline it
    feeds — a market's `floor_strike` is published when the contract is LISTED,
    so it is genuinely available before the freeze. Nothing here is derived
    from a price: the strike, the ticker and the market's own open/close
    instants are copied from the venue record, with the receipt time measured.
    """

    freshness_budget_ns: int = 300 * NS
    markets: dict[int, dict[str, Any]] = field(default_factory=dict)
    retain: int = 192

    def record(self, target_ms: int, market: dict[str, Any]) -> None:
        # A contract is LISTED before it opens but its floor_strike is only
        # published AT the open, so an early strike-less listing must never
        # overwrite the record that actually carries the strike.
        existing = self.markets.get(target_ms)
        if (
            existing is not None
            and existing.get("floor_strike") is not None
            and market.get("floor_strike") is None
        ):
            return
        self.markets[target_ms] = market
        self.last_event_ns = max(self.last_event_ns, target_ms * 1_000_000)
        self.last_receipt_ns = max(self.last_receipt_ns, int(market["receipt_ns"]))
        if len(self.markets) > self.retain:
            for stale in sorted(self.markets)[: len(self.markets) - self.retain]:
                del self.markets[stale]

    def note_poll(self, receipt_ns: int) -> None:
        self.last_receipt_ns = max(self.last_receipt_ns, receipt_ns)

    def get(self, target_ms: int, frozen_at_ns: int) -> dict[str, Any] | None:
        """This target's listed market, only if it was received by the freeze."""
        found = self.markets.get(target_ms)
        if found is None or int(found.get("receipt_ns", 0)) > frozen_at_ns:
            return None
        return found


# --------------------------------------------------------------------------- #
# collectors
# --------------------------------------------------------------------------- #
class BinanceTradeCollector:
    """Websocket collector for one Binance aggregate-trade stream."""

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
                        self.buffer.transport = "websocket"
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
        self.buffer.append(_trade_from_agg(data, receipt_ns))


def _trade_from_agg(data: dict[str, Any], receipt_ns: int) -> Trade:
    """One aggTrade payload (websocket or REST) in the archive builder's units."""
    price = float(data["p"])
    quantity = float(data["q"])
    return Trade(
        event_ns=int(data["T"]) * 1_000_000,
        receipt_ns=receipt_ns,
        price=price,
        quantity=quantity,
        quote_quantity=price * quantity,
        buyer_is_maker=bool(data.get("m", False)),
        trade_id=data.get("a"),
        first_trade_id=data.get("f"),
        last_trade_id=data.get("l"),
    )


class BinanceRestTradeCollector:
    """REST fallback for an aggregate-trade feed whose websocket delivers nothing.

    Same venue, same endpoint family and identical `aggTrades` payload schema
    (a/p/q/f/l/T/m), so `underlying_n` and the sign convention are unchanged.
    Only the transport and therefore the receipt time differ.
    """

    def __init__(self, buffer: FeedBuffer, rest_base: str, symbol: str, path: str,
                 interval_s: float = 1.0) -> None:
        self.buffer = buffer
        self.url = f"{rest_base.rstrip('/')}{path}"
        self.symbol = symbol
        self.interval_s = interval_s

    async def run(self) -> None:
        async with httpx.AsyncClient(timeout=5.0) as client:
            last_id: int | None = None
            while True:
                response = None
                try:
                    params: dict[str, Any] = {"symbol": self.symbol, "limit": 1000}
                    if last_id is not None:
                        params["fromId"] = last_id + 1
                    await LIMITER.acquire(self.url)
                    response = await client.get(self.url, params=params)
                    LIMITER.note(self.url, response)
                    response.raise_for_status()
                    receipt = now_ns()
                    rows = response.json()
                    for row in rows:
                        self.buffer.append(_trade_from_agg(row, receipt))
                        last_id = max(last_id or 0, int(row["a"]))
                    self.buffer.connected_since_ns = self.buffer.connected_since_ns or receipt
                    self.buffer.transport = "rest"
                    self.buffer.error = None
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    LIMITER.note(self.url, response, exc)
                    self.buffer.error = f"rest:{type(exc).__name__}: {exc}"
                await asyncio.sleep(self.interval_s)



class KlineCollector:
    """Completed 1-minute klines over websocket, with a REST fallback.

    Only `k.x == true` (closed) candles are stored: an in-progress minute is not
    a completed minute, and every consumer here is defined on `[open, close]`
    boundaries ending at T-1ms.
    """

    def __init__(self, buffer: KlineBuffer, ws_base: str | None, stream: str | None,
                 rest_base: str, path: str, params: dict[str, Any]) -> None:
        self.buffer = buffer
        self.ws_url = None if ws_base is None or stream is None else f"{ws_base}?streams={stream}"
        self.rest_url = f"{rest_base.rstrip('/')}{path}"
        self.params = params

    async def run_ws(self) -> None:
        if self.ws_url is None:
            return
        backoff = 0.5
        while True:
            try:
                async with websockets.connect(
                    self.ws_url, ping_interval=15, ping_timeout=10
                ) as ws:
                    self.buffer.connected_since_ns = now_ns()
                    self.buffer.error = None
                    backoff = 0.5
                    async for raw in ws:
                        receipt = now_ns()
                        data = json.loads(raw).get("data", {})
                        k = data.get("k")
                        if not k or not k.get("x"):
                            continue
                        self.buffer.append(
                            Kline(
                                open_ms=int(k["t"]),
                                close_ms=int(k["T"]),
                                receipt_ns=receipt,
                                open=float(k["o"]),
                                high=float(k["h"]),
                                low=float(k["l"]),
                                close=float(k["c"]),
                                base_volume=float(k["v"]),
                                quote_volume=float(k["q"]),
                                trade_count=int(k["n"]),
                                taker_buy_base=float(k["V"]),
                            )
                        )
                        self.buffer.transport = "websocket"
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                self.buffer.connected_since_ns = None
                self.buffer.disconnects += 1
                self.buffer.error = f"{type(exc).__name__}: {exc}"
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 15.0)

    async def backfill(self, minutes: int) -> int:
        """Fetch `minutes` completed klines once, at startup.

        The auxiliary block needs 481 completed BTCUSDT minutes behind a target;
        waiting eight hours for the live stream to accumulate them is not a
        design, it is an outage. These rows are the same exchange candles the
        stream would deliver, and their receipt instant is the REAL fetch time —
        never backdated — so a boundary frozen before this fetch still refuses
        them.
        """
        stored = 0
        async with httpx.AsyncClient(timeout=15.0) as client:
            remaining = minutes
            end_ms: int | None = None
            while remaining > 0:
                params = {**self.params, "limit": min(1000, remaining)}
                if end_ms is not None:
                    params["endTime"] = end_ms
                response = None
                try:
                    await LIMITER.acquire(self.rest_url)
                    response = await client.get(self.rest_url, params=params)
                    LIMITER.note(self.rest_url, response)
                    response.raise_for_status()
                    rows = response.json()
                except Exception as exc:  # noqa: BLE001 - warmup is best-effort
                    LIMITER.note(self.rest_url, response, exc)
                    self.buffer.error = f"backfill {type(exc).__name__}: {exc}"
                    break

                if not rows:
                    break
                receipt = now_ns()
                now_ms = receipt // 1_000_000
                for row in rows:
                    close_ms = int(row[6])
                    if close_ms >= now_ms:
                        continue
                    self.buffer.append(
                        Kline(
                            open_ms=int(row[0]),
                            close_ms=close_ms,
                            receipt_ns=receipt,
                            open=float(row[1]),
                            high=float(row[2]),
                            low=float(row[3]),
                            close=float(row[4]),
                            base_volume=float(row[5]),
                            quote_volume=float(row[7]),
                            trade_count=int(row[8]),
                            taker_buy_base=float(row[9]),
                        )
                    )
                    stored += 1
                remaining -= len(rows)
                end_ms = int(rows[0][0]) - 1
        return stored

    async def run_rest(self, interval_s: float = 10.0) -> None:
        """Poll closed klines. The newest returned candle may still be open.

        While the websocket is delivering closed minutes this poll adds nothing
        but request weight, and request weight is what earns the venue ban that
        empties the history everything else depends on. So it only polls when
        the stream is not currently supplying the feed.
        """
        async with httpx.AsyncClient(timeout=6.0) as client:
            while True:
                if self.buffer.transport == "websocket" and self.buffer.is_fresh(now_ns()):
                    await asyncio.sleep(interval_s)
                    continue
                response = None
                try:
                    await LIMITER.acquire(self.rest_url)
                    response = await client.get(
                        self.rest_url, params={**self.params, "limit": 10}
                    )
                    LIMITER.note(self.rest_url, response)
                    response.raise_for_status()

                    receipt = now_ns()
                    now_ms = receipt // 1_000_000
                    for row in response.json():
                        close_ms = int(row[6])
                        if close_ms >= now_ms:
                            continue  # still open
                        self.buffer.append(
                            Kline(
                                open_ms=int(row[0]),
                                close_ms=close_ms,
                                receipt_ns=receipt,
                                open=float(row[1]),
                                high=float(row[2]),
                                low=float(row[3]),
                                close=float(row[4]),
                                base_volume=float(row[5]),
                                quote_volume=float(row[7]),
                                trade_count=int(row[8]),
                                taker_buy_base=float(row[9]),
                            )
                        )
                    self.buffer.connected_since_ns = self.buffer.connected_since_ns or receipt
                    if self.buffer.transport != "websocket":
                        self.buffer.transport = "rest"
                    self.buffer.error = None
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    LIMITER.note(self.rest_url, response, exc)
                    self.buffer.error = f"rest:{type(exc).__name__}: {exc}"
                await asyncio.sleep(interval_s)

    async def repair_history(self, minutes: int, period_s: float = 60.0) -> None:
        """Keep re-fetching until the last `minutes` completed minutes are held.

        A single best-effort backfill at startup is not history acquisition: if
        the venue refuses it once — a rate-limit ban, a transient error — the
        buffer stays short and every boundary that needs the 16-minute context
        fails with an incomplete set. This waits out the venue's own deadline
        and asks again, and it stops as soon as the window is genuinely
        complete. It never invents a minute.
        """
        while True:
            now_ms = now_ns() // 1_000_000
            last_open = (now_ms // 60_000) * 60_000 - 60_000
            gaps = self.buffer.missing_minutes(last_open - (minutes - 1) * 60_000, last_open)
            if not gaps:
                await asyncio.sleep(period_s)
                continue
            wait = LIMITER.banned_for(self.rest_url)
            if wait > 0:
                await asyncio.sleep(min(wait + 1.0, 60.0))
                continue
            await self.backfill(min(minutes, len(gaps) + 60))
            await asyncio.sleep(5.0)



class KalshiWindowCollector:
    """The [T, T+5s) target-market trade window, exactly as the prior producer.

    Transcribed from `acquire_kalshi_early_prior_r1.fetch_early_trades` /
    `build_c61_kalshi_confirmed_extension_r1.load_prior`:

    * request `trades?ticker&min_ts=T&max_ts=T+5&limit=1000&is_block_trade=false`,
      following the cursor,
    * reject a trade whose ticker differs, that is a block trade, or whose
      `created_time` is outside `[T, T+5)`,
    * order by `(created_time, str(trade_id))`,
    * `last_yes_price` = last accepted `yes_price_dollars`,
      `vwap_yes_price` = count-weighted mean,
    * `market_q1` = trades >= 1 AND volume > 0 AND both prices finite.

    TIMING, stated rather than smoothed: this window CLOSES at T+5s, which is
    the publication ceiling itself. The quote can only be read after the
    deadline it feeds. That conflict is the model's own definition; it is
    measured and reported, never resolved by moving a timestamp.
    """

    def __init__(self, buffer: QuoteBuffer, api_base: str, series: str,
                 poll_s: float = 5.0, markets: "MarketBuffer | None" = None) -> None:
        self.buffer = buffer
        self.base = api_base.rstrip("/")
        self.series = series
        self.poll_s = poll_s
        self.markets = markets
        self._markets: dict[int, dict[str, Any]] = {}  # target_ms -> market
        self._markets_at_ns = -1
        self._fetched: set[int] = set()

    async def _refresh_markets(self, client: httpx.AsyncClient) -> None:
        response = await client.get(
            f"{self.base}/markets",
            params={"series_ticker": self.series, "status": "open", "limit": 200},
        )
        response.raise_for_status()
        receipt = now_ns()
        self.buffer.note_poll(receipt)
        if self.markets is not None:
            self.markets.note_poll(receipt)
        for market in response.json().get("markets", []):
            open_time = market.get("open_time")
            if not open_time:
                continue
            import datetime as _dt

            stamp = _dt.datetime.fromisoformat(open_time.replace("Z", "+00:00"))
            strike = market.get("floor_strike")
            target_ms = int(stamp.timestamp() * 1000)
            record = {
                "ticker": market["ticker"],
                # floor_strike is target-native and comes from the market itself;
                # a missing or non-numeric value stays None and fails the packet.
                "floor_strike": None if strike is None else float(strike),
            }
            self._markets[target_ms] = record
            if self.markets is not None:
                # The listed record, with its own window, so a Version 1 packet
                # can verify the contract instead of formatting a ticker.
                self.markets.record(
                    target_ms,
                    {
                        **record,
                        "open_time": open_time,
                        "close_time": market.get("close_time"),
                        "status": market.get("status"),
                        "receipt_ns": receipt,
                    },
                )
        self._markets_at_ns = now_ns()

    async def _fetch_window(self, client: httpx.AsyncClient, target_ms: int,
                            market: dict[str, Any]) -> None:
        ticker = market["ticker"]
        start_s = target_ms // 1000
        accepted: list[dict[str, Any]] = []
        rejected = {"time": 0, "ticker": 0, "block": 0}
        cursor = ""
        seen: set[str] = set()
        while True:
            params: dict[str, Any] = {
                "ticker": ticker,
                "min_ts": start_s,
                "max_ts": start_s + 5,
                "limit": 1000,
                "is_block_trade": "false",
            }
            if cursor:
                params["cursor"] = cursor
            response = await client.get(f"{self.base}/markets/trades", params=params)
            response.raise_for_status()
            payload = response.json()
            for trade in payload.get("trades") or []:
                if trade.get("ticker") != ticker:
                    rejected["ticker"] += 1
                    continue
                if bool(trade.get("is_block_trade")):
                    rejected["block"] += 1
                    continue
                import datetime as _dt

                created = _dt.datetime.fromisoformat(
                    str(trade.get("created_time")).replace("Z", "+00:00")
                )
                created_ms = int(created.timestamp() * 1000)
                if not (target_ms <= created_ms < target_ms + 5_000):
                    rejected["time"] += 1
                    continue
                accepted.append(
                    {
                        "trade_id": str(trade.get("trade_id")),
                        "created_ms": created_ms,
                        "yes_price": float(trade["yes_price_dollars"]),
                        "count": float(trade["count_fp"]),
                    }
                )
            cursor = payload.get("cursor") or ""
            if not cursor or cursor in seen:
                break
            seen.add(cursor)

        receipt = now_ns()
        accepted.sort(key=lambda item: (item["created_ms"], item["trade_id"]))
        volume = sum(item["count"] for item in accepted)
        vwap = (
            sum(item["yes_price"] * item["count"] for item in accepted) / volume
            if volume > 0
            else None
        )
        last_price = accepted[-1]["yes_price"] if accepted else None
        self.buffer.append(
            target_ms,
            {
                "ticker": ticker,
                "floor_strike": market.get("floor_strike"),
                "receipt_ns": receipt,
                "eligible_trade_count": len(accepted),
                "eligible_contract_volume": volume,
                "last_yes_price": last_price,
                "vwap_yes_price": vwap,
                "rejected": rejected,
                "market_q1": bool(
                    len(accepted) >= 1
                    and volume > 0
                    and last_price is not None
                    and vwap is not None
                ),
            },
        )
        self._fetched.add(target_ms)

    async def run(self) -> None:
        async with httpx.AsyncClient(timeout=6.0) as client:
            while True:
                try:
                    if now_ns() - self._markets_at_ns > 60 * NS:
                        await self._refresh_markets(client)
                    now_ms = now_ns() // 1_000_000
                    for target_ms, market in sorted(self._markets.items()):
                        if target_ms in self._fetched:
                            continue
                        # The window is only complete once T+5s has elapsed.
                        if now_ms < target_ms + 5_000:
                            continue
                        if now_ms - target_ms > 15 * 60_000:
                            self._fetched.add(target_ms)  # too old to matter
                            continue
                        await self._fetch_window(client, target_ms, market)
                    self.buffer.connected_since_ns = self.buffer.connected_since_ns or now_ns()
                    self.buffer.transport = "rest"
                    self.buffer.error = None
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    self.buffer.error = f"{type(exc).__name__}: {exc}"
                await asyncio.sleep(self.poll_s)


class KalshiStrikeCollector:
    """The target's own STRIKE, read from the target's own market record.

    MEASURED venue behaviour (2026-09-10, this address): the series listing
    returns future contracts with `status: initialized` and a NULL
    `floor_strike`, and the `status=open` filter lags by minutes — during the
    04:30 boundary it still returned only the 04:15 contract. Polling that
    listing is therefore not a way to obtain the current target's strike, which
    is what produced `LITEA_MARKET_NOT_LISTED_BY_FREEZE` on the 04:00 and 04:15
    rows.

    So this collector asks for the target's OWN market by ticker
    (`KXBTC15M-YYMMMDDHHMM-MM`, close-stamped in US Eastern, the venue's
    convention) and accepts it only when the record's own open/close instants
    are exactly `[T, T+15m)`. Polling starts before T — a request made early is
    not a value invented early: the record is stored with the receipt instant
    at which the venue actually served a non-null strike, and a packet frozen
    before that instant still refuses it.
    """

    INTERVAL_MS = 15 * 60_000
    #: Start asking before the open, so the very first published strike is
    #: caught rather than missed by a poll phase.
    LEAD_MS = 120_000
    #: Keep asking a little past the packet deadline so the row can record how
    #: LATE the venue actually was, instead of silently reporting nothing.
    TAIL_MS = 20_000

    def __init__(self, buffer: MarketBuffer, api_base: str, series: str,
                 poll_s: float = 0.25) -> None:
        self.buffer = buffer
        self.base = api_base.rstrip("/")
        self.series = series
        self.poll_s = poll_s

    def _has_strike(self, target_ms: int) -> bool:
        record = self.buffer.markets.get(target_ms)
        return bool(record and record.get("floor_strike") is not None)

    def ticker_for(self, target_ms: int) -> str:
        import datetime as _dt

        close = _dt.datetime.fromtimestamp(
            (target_ms + self.INTERVAL_MS) / 1000, _dt.timezone.utc
        )
        return f"{format_ticker(self.series, close)}-{close.astimezone(EASTERN):%M}"

    async def _poll_once(self, client: httpx.AsyncClient, target_ms: int) -> None:
        import datetime as _dt

        ticker = self.ticker_for(target_ms)
        response = await client.get(f"{self.base}/markets/{ticker}")
        receipt = now_ns()
        self.buffer.note_poll(receipt)
        if response.status_code == 404:
            return  # not listed yet; nothing is assumed about it
        response.raise_for_status()
        market = response.json().get("market") or {}
        open_time = market.get("open_time")
        close_time = market.get("close_time")
        if not open_time or not close_time:
            return
        opened = _dt.datetime.fromisoformat(open_time.replace("Z", "+00:00"))
        closed = _dt.datetime.fromisoformat(close_time.replace("Z", "+00:00"))
        # The contract must be the one whose window IS this target's interval.
        if int(opened.timestamp() * 1000) != target_ms:
            return
        if int(closed.timestamp() * 1000) != target_ms + self.INTERVAL_MS:
            return
        strike = market.get("floor_strike")
        self.buffer.record(
            target_ms,
            {
                "ticker": market.get("ticker", ticker),
                "floor_strike": None if strike is None else float(strike),
                "open_time": open_time,
                "close_time": close_time,
                "status": market.get("status"),
                "receipt_ns": receipt,
            },
        )

    async def run(self) -> None:
        async with httpx.AsyncClient(timeout=3.0) as client:
            while True:
                now_ms = now_ns() // 1_000_000
                current_ms = (now_ms // self.INTERVAL_MS) * self.INTERVAL_MS
                offset = now_ms - current_ms
                upcoming = current_ms + self.INTERVAL_MS
                if offset >= self.INTERVAL_MS - self.LEAD_MS and not self._has_strike(upcoming):
                    target_ms = upcoming          # the boundary about to open
                elif offset < self.TAIL_MS and not self._has_strike(current_ms):
                    target_ms = current_ms        # the boundary just opened
                else:
                    # MEASURED: sleeping between boundaries let this feed age
                    # past its freshness budget, so readiness reported a stale
                    # market source for most of every interval. A slow keepalive
                    # poll of the CURRENT contract keeps the watermark honest —
                    # it is a real received record, not a freshness assertion.
                    target_ms = current_ms

                try:
                    await self._poll_once(client, target_ms)
                    self.buffer.connected_since_ns = (
                        self.buffer.connected_since_ns or now_ns()
                    )
                    self.buffer.transport = "rest"
                    self.buffer.error = None
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    self.buffer.error = f"{type(exc).__name__}: {exc}"
                # Rapid only around the open itself; a keepalive otherwise.
                rapid = offset < self.TAIL_MS or offset >= self.INTERVAL_MS - self.LEAD_MS
                await asyncio.sleep(self.poll_s if rapid else 20.0)




# --------------------------------------------------------------------------- #
# registry
# --------------------------------------------------------------------------- #
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

    # A trade websocket that has produced nothing for this long is treated as
    # dead even though its handshake succeeded, and REST takes over.
    WS_GRACE_NS = 20 * NS

    #: Version 1 needs exactly these. Passing them keeps the process from
    #: spending its shared request budget — and its ban risk — on trade streams
    #: no selected model reads. `None` preserves the legacy full set.
    V1_FEEDS = (
        "binance_spot",
        "binance_um",
        "binance_1m",
        "binance_usdcusdt_1m",
        "binance_index",
        "binance_cm_1m",
        "kalshi_markets",
    )

    def __init__(self, env: dict[str, str], only: Iterable[str] | None = None) -> None:
        self.env = env
        self.only = None if only is None else set(only)
        spot_ws = env.get("BINANCE_SPOT_WS", "wss://stream.binance.com:9443/stream")
        um_ws = env.get("BINANCE_UM_WS", "wss://fstream.binance.com/stream")
        cm_ws = env.get("BINANCE_CM_WS", "wss://dstream.binance.com/stream")
        spot_rest = env.get("BINANCE_SPOT_REST", "https://api.binance.com")
        um_rest = env.get("BINANCE_UM_REST", "https://fapi.binance.com")
        cm_rest = env.get("BINANCE_CM_REST", "https://dapi.binance.com")

        self.trades: dict[str, FeedBuffer] = {
            name: FeedBuffer(name)
            for name in ("binance_spot", "binance_um", "binance_cm", "binance_usdc")
        }
        # COIN-M features look back 16 minutes, so it retains a longer window.
        self.trades["binance_cm"].retain_ns = 30 * 60 * NS

        self.klines: dict[str, KlineBuffer] = {
            # The auxiliary block reads 481 completed BTCUSDT minutes ending at
            # T-1ms (240-minute rolling sigma behind a 240-minute return shift),
            # so this buffer must retain more than the 240-minute default.
            "binance_1m": KlineBuffer("binance_1m", retain_minutes=600),
            "binance_index": KlineBuffer("binance_index"),
            # research_c68/audit_quote_data.py asserts symbol == 'USDCUSDT':
            # `quote_vwap_usdt_per_usdc` is the USDT-per-USDC RATE, not the
            # BTCUSDC price. Reading BTCUSDC minutes here produced a ~BTC-priced
            # value that could never satisfy the original 0.9..1.1 range check.
            "binance_usdcusdt_1m": KlineBuffer("binance_usdcusdt_1m"),
            "binance_cm_1m": KlineBuffer("binance_cm_1m"),
        }
        self.quotes = QuoteBuffer("kalshi")
        #: Listed contract metadata (ticker, floor_strike, window). Available
        #: BEFORE T+5s, unlike the quote aggregate, so Version 1 reads it.
        self.markets = MarketBuffer("kalshi_markets")

        self.buffers: dict[str, Any] = {
            **self.trades,
            "binance_1m": self.klines["binance_1m"],
            "binance_index": self.klines["binance_index"],
            "binance_usdcusdt_1m": self.klines["binance_usdcusdt_1m"],
            "binance_cm_1m": self.klines["binance_cm_1m"],
            "kalshi": self.quotes,
            "kalshi_markets": self.markets,
        }

        self._trade_ws = {
            "binance_spot": BinanceTradeCollector(
                self.trades["binance_spot"], spot_ws, "btcusdt@aggTrade"
            ),
            "binance_um": BinanceTradeCollector(
                self.trades["binance_um"], um_ws, "btcusdt@aggTrade"
            ),
            "binance_cm": BinanceTradeCollector(
                self.trades["binance_cm"], cm_ws, "btcusd_perp@aggTrade"
            ),
            "binance_usdc": BinanceTradeCollector(
                self.trades["binance_usdc"], spot_ws, "btcusdc@aggTrade"
            ),
        }
        self._trade_rest = {
            "binance_spot": BinanceRestTradeCollector(
                self.trades["binance_spot"], spot_rest, "BTCUSDT", "/api/v3/aggTrades"
            ),
            "binance_um": BinanceRestTradeCollector(
                self.trades["binance_um"], um_rest, "BTCUSDT", "/fapi/v1/aggTrades"
            ),
            "binance_cm": BinanceRestTradeCollector(
                self.trades["binance_cm"], cm_rest, "BTCUSD_PERP", "/dapi/v1/aggTrades"
            ),
            "binance_usdc": BinanceRestTradeCollector(
                self.trades["binance_usdc"], spot_rest, "BTCUSDC", "/api/v3/aggTrades"
            ),
        }
        self._klines = {
            "binance_1m": KlineCollector(
                self.klines["binance_1m"], spot_ws, "btcusdt@kline_1m",
                spot_rest, "/api/v3/klines", {"symbol": "BTCUSDT", "interval": "1m"},
            ),
            "binance_usdcusdt_1m": KlineCollector(
                self.klines["binance_usdcusdt_1m"], spot_ws, "usdcusdt@kline_1m",
                spot_rest, "/api/v3/klines", {"symbol": "USDCUSDT", "interval": "1m"},
            ),
            # The reference index minute is the COIN-M (dapi) BTCUSD index, which
            # is what the offline recovery path reads and what the supplied
            # feature recipe was fitted on. The UM (fapi) BTCUSDT index is a
            # DIFFERENT series and was silently substituted here before.
            "binance_index": KlineCollector(
                self.klines["binance_index"], cm_ws, "btcusd@indexPriceKline_1m",
                cm_rest, "/dapi/v1/indexPriceKlines", {"pair": "BTCUSD", "interval": "1m"},
            ),
            "binance_cm_1m": KlineCollector(
                self.klines["binance_cm_1m"], cm_ws, "btcusd_perp@kline_1m",
                cm_rest, "/dapi/v1/klines", {"symbol": "BTCUSD_PERP", "interval": "1m"},
            ),
        }
        self._kalshi = KalshiWindowCollector(
            self.quotes,
            env.get("KALSHI_API_BASE", "https://api.elections.kalshi.com/trade-api/v2"),
            env.get("KALSHI_SERIES_TICKER", "KXBTC15M"),
            markets=self.markets,
        )
        self._strikes = KalshiStrikeCollector(
            self.markets,
            env.get("KALSHI_API_BASE", "https://api.elections.kalshi.com/trade-api/v2"),
            env.get("KALSHI_SERIES_TICKER", "KXBTC15M"),
        )
        self._tasks: list[asyncio.Task] = []

    async def _trade_feed(self, name: str) -> None:
        """Run the websocket; promote REST when the socket delivers nothing."""
        buffer = self.trades[name]
        ws_task = asyncio.create_task(self._trade_ws[name].run())
        rest_task: asyncio.Task | None = None
        started = now_ns()
        try:
            while True:
                await asyncio.sleep(2.0)
                silent = buffer.last_receipt_ns < 0 and now_ns() - started > self.WS_GRACE_NS
                stale = buffer.last_receipt_ns > 0 and not buffer.is_fresh(now_ns())
                if rest_task is None and (silent or stale):
                    buffer.error = (
                        f"websocket delivered no data within {self.WS_GRACE_NS // NS}s; "
                        "REST fallback engaged"
                    ) if silent else buffer.error
                    rest_task = asyncio.create_task(self._trade_rest[name].run())
        except asyncio.CancelledError:
            ws_task.cancel()
            if rest_task is not None:
                rest_task.cancel()
            raise

    async def start(self) -> None:
        for name in self._selected(self.trades):
            self._tasks.append(asyncio.create_task(self._trade_feed(name)))
        # Minute history first: the auxiliary and COIN-M blocks are defined over
        # hundreds of completed minutes, so the streams alone would leave the
        # worker input-starved for hours after every restart.
        #
        # SEQUENTIALLY, through the shared host budget. Firing every backfill at
        # once is what earned the venue ban that left the COIN-M context short
        # at the 04:00 and 04:15 boundaries; the limiter can only pace requests
        # it sees one at a time.
        klines = {k: v for k, v in self._klines.items() if k in self._selected(self._klines)}
        for collector in klines.values():
            try:
                await collector.backfill(collector.buffer.retain_minutes)
            except Exception as exc:  # noqa: BLE001 - a refusal is repaired below
                collector.buffer.error = f"backfill {type(exc).__name__}: {exc}"
        for collector in klines.values():
            self._tasks.append(asyncio.create_task(collector.run_ws()))
            self._tasks.append(asyncio.create_task(collector.run_rest()))
            # A one-shot backfill is not history: this keeps asking, after the
            # venue's own deadline, until the recent window is genuinely held.
            self._tasks.append(asyncio.create_task(collector.repair_history(30)))
        if self.only is None or "kalshi" in self.only:
            self._tasks.append(asyncio.create_task(self._kalshi.run()))
        if self.only is None or "kalshi_markets" in self.only:
            self._tasks.append(asyncio.create_task(self._strikes.run()))

    def _selected(self, group: dict[str, Any]) -> list[str]:
        if self.only is None:
            return list(group)
        return [name for name in group if name in self.only]


    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()

    def watermarks(self, at_ns: int | None = None) -> dict[str, Any]:
        at_ns = at_ns or now_ns()
        everything = {**self.buffers, **self.klines}
        return {name: buf.freshness(at_ns) for name, buf in everything.items()}

    def missing(self, at_ns: int | None = None) -> list[str]:
        at_ns = at_ns or now_ns()
        required = self.REQUIRED if self.only is None else tuple(sorted(self.only))
        return [name for name in required if not self.buffers[name].is_fresh(at_ns)]

    def ready(self, at_ns: int | None = None) -> bool:
        return not self.missing(at_ns)
