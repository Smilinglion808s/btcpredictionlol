"""Boundary PRICE-REFERENCE feeds used ONLY when the venue's own strike is absent.

Version 1's `floor_strike` is an OFFICIAL contract field. It stays the first
choice and nothing here ever overwrites it. These feeds exist because a listed
KXBTC15M contract sometimes answers without a strike by the freeze, and losing
the boundary entirely costs more coverage than a disclosed estimate.

What the venue's own rules say (read from a live KXBTC15M market on
2026-09-10): the comparison value is the simple average of the 60 CF Benchmarks
BTC Real Time Index (BRTI) values in the 60 seconds immediately BEFORE the
opening boundary, rounded to two decimals. So a usable reference must be:

  * about the OPENING boundary T, never the close (T+15m) and never a spot
    price sampled at T+5s;
  * built from ticks whose SOURCE timestamps fall in (T-60s, T];
  * built only from ticks actually RECEIVED before this packet's freeze.

Two independent references are collected continuously and concurrently, so the
choice at freeze is made from candidates already in hand:

  ``cf_brti``            CF Benchmarks BRTI through Kalshi's authenticated
                         `cfbenchmarks_value` channel, decoded from the
                         DOCUMENTED envelope: `msg.index_id == "BRTI"`,
                         `msg.data` a JSON STRING carrying `id`/`time`/`value`,
                         and the quarter-hour field
                         `last_60s_windowed_average_15min` with
                         `window_size` / `window_start_ts_ms` /
                         `window_end_ts_exclusive`. Only a window whose
                         `window_size` is 60 and whose accumulation window is
                         exactly `(T-60s, T]` is the COMPLETED average; the
                         partial second-indexed counts published earlier in the
                         final minute are never presented as final. When no
                         completed window is held, the causal mean of received
                         ticks is used and tagged `causal_approx_60s_mean`.

  ``chainlink_streams``  Chainlink Data Streams BTC/USD v3 reports, decoded
                         from the report blob and validated for feed id,
                         timestamp consistency, units and expiry. The
                         low-latency stream only; an on-chain heartbeat oracle
                         is NOT substituted for it. Reports are DECODED over an
                         authenticated TLS channel — their signatures are not
                         cryptographically verified here, and nothing claims
                         otherwise.

Both are estimates. They are labelled as such at every layer, they never feed
settlement (official Kalshi results alone grade a decision), and they never
rewrite a frozen decision.

Neither feed has credentials in this project today. Without them each collector
reports `credentials_missing`, produces nothing and never counts as connected:
a disabled collector is never reported as operational.
"""
from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import math
import time
from dataclasses import dataclass, field
from typing import Any

import httpx
import websockets

from .feeds import NS, HostLimiter, _BaseBuffer, now_ns

MINUTE_MS = 60_000
QUARTER_MS = 15 * MINUTE_MS

#: A reference tick older than this at the boundary cannot describe it.
MAX_TICK_AGE_MS = 5_000
#: Largest tolerated hole ANYWHERE in the 60-second window — including the
#: leading edge (window start -> first tick) and the trailing edge
#: (last tick -> boundary). Thirty ticks crammed into the final half minute is
#: not a 60-second average and must not pass.
MAX_GAP_MS = 5_000
#: Fewest ticks an approximation may be built from (of the ~60 expected).
MIN_TICKS = 30
#: Sanity band for a BTC/USD reference, in USD. Outside it the value is a unit
#: error (wei, cents, basis points), not a price, and is refused.
MIN_PRICE = 1_000.0
MAX_PRICE = 10_000_000.0
#: How far after the boundary the completed window's own end stamp may sit.
EXACT_END_TOLERANCE_MS = 2_000


def _finite_price(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or not MIN_PRICE <= number <= MAX_PRICE:
        return None
    return number


def _int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


@dataclass
class ReferenceBuffer(_BaseBuffer):
    """Per-second boundary reference ticks from ONE named source."""

    #: Stable source id recorded on every decision that uses it.
    source: str = "reference"
    unit: str = "USD"
    #: (source_ts_ms, value, receipt_ns, expires_at_ms|None), by receipt order.
    ticks: list[tuple[int, float, int, int | None]] = field(default_factory=list)
    #: boundary_ms -> the venue's own COMPLETED 60-tick average for it.
    exact_averages: dict[int, dict[str, Any]] = field(default_factory=dict)
    retain_ms: int = 10 * MINUTE_MS
    credentials_missing: bool = False
    freshness_budget_ns: int = 10 * NS
    #: How an approximation built from these ticks is described. Irregular
    #: TRADE prints are not the index's evenly spaced per-second readings, and
    #: the difference is disclosed on every decision rather than smoothed over.
    approx_method: str = "causal_approx_60s_mean"
    #: Venue event ids already stored, so a repeated print is never counted
    #: twice and a replayed frame cannot change a second's chosen value.
    seen_events: set = field(default_factory=set)

    def append(
        self,
        source_ts_ms: Any,
        value: Any,
        receipt_ns: int,
        expires_at_ms: int | None = None,
        event_id: Any = None,
    ) -> bool:
        price = _finite_price(value)
        stamp = _int(source_ts_ms)
        if price is None or stamp is None or stamp <= 0:
            return False
        if expires_at_ms is not None and expires_at_ms <= stamp:
            return False  # already expired when it was observed
        if event_id is not None:
            key = (self.source, str(event_id))
            if key in self.seen_events:
                return False
            self.seen_events.add(key)
            if len(self.seen_events) > 20_000:
                self.seen_events.clear()
        self.ticks.append((stamp, price, int(receipt_ns), expires_at_ms, event_id))
        self.last_event_ns = max(self.last_event_ns, stamp * 1_000_000)
        self.last_receipt_ns = max(self.last_receipt_ns, int(receipt_ns))
        self.connected_since_ns = self.connected_since_ns or int(receipt_ns)
        if len(self.ticks) > 4096:
            cutoff = stamp - self.retain_ms
            self.ticks = [t for t in self.ticks if t[0] >= cutoff]
        return True

    def record_exact_average(
        self,
        value: Any,
        *,
        window_size: Any,
        window_start_ms: Any,
        window_end_ms: Any,
        receipt_ns: int,
    ) -> int | None:
        """Store a COMPLETED quarter-hour window. Returns its boundary, or None.

        Completed means exactly what the channel documents: `window_size == 60`
        over the accumulation window `(boundary - 60s, boundary]`, whose start
        stamp is therefore `boundary - 60000` and whose boundary lands on a
        quarter hour. A partial final-minute count is rejected. The FIRST
        eligible version received is kept; a later frame never replaces it.
        """
        price = _finite_price(value)
        size = _int(window_size)
        start = _int(window_start_ms)
        end = _int(window_end_ms)
        if price is None or size != 60 or start is None or end is None:
            return None
        boundary = start + MINUTE_MS
        if boundary % QUARTER_MS != 0:
            return None
        if not boundary <= end <= boundary + EXACT_END_TOLERANCE_MS:
            return None
        if boundary in self.exact_averages:
            return boundary  # earliest eligible version is retained
        self.exact_averages[boundary] = {
            "value": price,
            "count": size,
            "receipt_ns": int(receipt_ns),
            "window_start_ms": start,
            "window_end_ts_exclusive": end,
        }
        for key in [k for k in self.exact_averages if k < boundary - self.retain_ms]:
            self.exact_averages.pop(key, None)
        return boundary

    # -- candidate selection ------------------------------------------------ #
    def boundary_reference(self, target_ms: int, freeze_ns: int) -> dict[str, Any]:
        """The best CAUSAL candidate for this boundary, or a named refusal."""
        target_ms = int(target_ms)
        window_start = target_ms - MINUTE_MS
        base = {
            "source": self.source,
            "unit": self.unit,
            "estimated": True,
            "event_window_ms": [window_start, target_ms],
            "event_window": f"({window_start}, {target_ms}] source-time ms",
        }
        if self.credentials_missing:
            return {**base, "usable": False, "reason": "credentials_missing"}

        exact = self.exact_averages.get(target_ms)
        if exact and exact["receipt_ns"] <= freeze_ns:
            return {
                **base,
                "usable": True,
                "value": round(exact["value"], 2),
                "method": "venue_60s_final_average",
                "tick_count": exact["count"],
                "receipt_ns": exact["receipt_ns"],
                "source_age_ms": 0,
            }

        usable = [
            row
            for row in self.ticks
            if window_start < row[0] <= target_ms
            and row[2] <= freeze_ns
            and (row[3] is None or row[3] > target_ms)
        ]
        if not usable:
            return {**base, "usable": False, "reason": "no_ticks_in_window"}
        # One value per SOURCE second, chosen deterministically by source time
        # then venue event id. Receipt order is deliberately not the tiebreak:
        # a frame that arrives late must not rewrite a second that was already
        # settled by a later-stamped print.
        by_second: dict[int, tuple] = {}
        for row in sorted(usable, key=lambda item: (item[0], str(item[4]))):
            by_second[row[0] // 1000] = row
        rows = sorted(by_second.values(), key=lambda item: item[0])
        count = len(rows)
        age_ms = target_ms - rows[-1][0]
        interior = [b[0] - a[0] for a, b in zip(rows, rows[1:])]
        leading = rows[0][0] - window_start
        worst_gap = max([leading, age_ms, *interior])
        detail = {
            **base,
            "tick_count": count,
            "source_age_ms": age_ms,
            "max_gap_ms": worst_gap,
            "leading_gap_ms": leading,
            "receipt_ns": max(row[2] for row in rows),
        }
        if count < MIN_TICKS:
            return {**detail, "usable": False, "reason": "too_few_ticks"}
        if age_ms > MAX_TICK_AGE_MS:
            return {**detail, "usable": False, "reason": "stale_at_boundary"}
        if worst_gap > MAX_GAP_MS:
            return {**detail, "usable": False, "reason": "window_gap"}
        mean = sum(row[1] for row in rows) / count
        return {
            **detail,
            "usable": True,
            "value": round(mean, 2),
            "method": self.approx_method,
        }


# --------------------------------------------------------------------------- #
# CF Benchmarks BRTI, through Kalshi's authenticated passthrough
# --------------------------------------------------------------------------- #
def kalshi_auth_headers(
    key_id: str, private_key_pem: str, method: str, path: str
) -> dict[str, str]:
    """Kalshi's documented RSA-PSS request signature. Never logs the key."""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    timestamp = str(int(time.time() * 1000))
    key = serialization.load_pem_private_key(private_key_pem.encode(), password=None)
    signature = key.sign(
        (timestamp + method.upper() + path).encode(),
        padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=hashes.SHA256.digest_size),
        hashes.SHA256(),
    )
    return {
        "KALSHI-ACCESS-KEY": key_id,
        "KALSHI-ACCESS-TIMESTAMP": timestamp,
        "KALSHI-ACCESS-SIGNATURE": base64.b64encode(signature).decode(),
    }


class CFBenchmarksCollector:
    """BRTI ticks from Kalshi's authenticated `cfbenchmarks_value` channel."""

    SOURCE = "cf_brti"
    INDEX_ID = "BRTI"
    PATH = "/trade-api/ws/v2"

    def __init__(
        self,
        buffer: ReferenceBuffer,
        ws_url: str,
        key_id: str | None,
        private_key_pem: str | None,
    ) -> None:
        self.buffer = buffer
        self.ws_url = ws_url
        self.key_id = key_id or ""
        self.private_key_pem = private_key_pem or ""
        self.buffer.credentials_missing = not (self.key_id and self.private_key_pem)

    def ingest(self, frame: dict[str, Any], receipt_ns: int) -> bool:
        """One decoded websocket frame, in the channel's DOCUMENTED shape.

        Required: `msg.index_id == "BRTI"` (never assumed), and `msg.data` a
        JSON STRING whose `id` is also BRTI, carrying `time` (ms) and `value`.
        """
        message = frame.get("msg")
        if not isinstance(message, dict):
            return False
        if message.get("index_id") != self.INDEX_ID:
            return False

        stored = False
        raw = message.get("data")
        payload: Any = None
        if isinstance(raw, str):
            with contextlib.suppress(Exception):
                payload = json.loads(raw)
        elif isinstance(raw, dict):
            payload = raw
        if isinstance(payload, dict) and payload.get("id") == self.INDEX_ID:
            stored = self.buffer.append(payload.get("time"), payload.get("value"), receipt_ns)

        window = message.get("last_60s_windowed_average_15min")
        if isinstance(window, dict):
            recorded = self.buffer.record_exact_average(
                window.get("value"),
                window_size=window.get("window_size"),
                window_start_ms=window.get("window_start_ts_ms"),
                window_end_ms=window.get("window_end_ts_exclusive"),
                receipt_ns=receipt_ns,
            )
            stored = stored or recorded is not None
        return stored

    async def run(self) -> None:
        if self.buffer.credentials_missing:
            self.buffer.error = (
                "cf_brti disabled: KALSHI_API_KEY_ID / KALSHI_PRIVATE_KEY_PEM not configured"
            )
            return
        subscribe = json.dumps(
            {
                "id": 1,
                "cmd": "subscribe",
                "params": {"channels": ["cfbenchmarks_value"], "index_ids": [self.INDEX_ID]},
            }
        )
        while True:
            try:
                headers = kalshi_auth_headers(
                    self.key_id, self.private_key_pem, "GET", self.PATH
                )
                async with websockets.connect(
                    self.ws_url, additional_headers=headers, ping_interval=10
                ) as socket:
                    self.buffer.transport = "websocket"
                    self.buffer.error = None
                    await socket.send(subscribe)
                    async for raw in socket:
                        with contextlib.suppress(Exception):
                            self.ingest(json.loads(raw), now_ns())
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                self.buffer.disconnects += 1
                self.buffer.error = f"{type(exc).__name__}: {exc}"
                await asyncio.sleep(2.0)


# --------------------------------------------------------------------------- #
# Chainlink Data Streams
# --------------------------------------------------------------------------- #
#: A v3 report blob is nine 32-byte words. A shorter blob is a different schema
#: (or a truncated payload) and is refused rather than read positionally.
V3_WORDS = 9


def decode_v3_report(full_report_hex: str) -> dict[str, Any] | None:
    """Decode a Data Streams v3 report blob into its documented fields.

    Layout: the outer payload is
    `abi.encode(bytes32[3] reportContext, bytes reportBlob, bytes32[] rs,
    bytes32[] ss, bytes32 rawVs)`; the blob is nine 32-byte words: feedId,
    validFromTimestamp, observationsTimestamp, nativeFee, linkFee, expiresAt,
    benchmarkPrice, bid, ask. Prices are signed 192-bit integers scaled 1e18.

    This DECODES a report. It does not verify the report's signatures; the
    transport's authentication and TLS are the only assurances in play.
    """
    text = full_report_hex[2:] if full_report_hex.startswith("0x") else full_report_hex
    try:
        raw = bytes.fromhex(text)
    except ValueError:
        return None
    if len(raw) < 32:
        return None

    def word(source: bytes, index: int) -> int:
        return int.from_bytes(source[index * 32 : (index + 1) * 32], "big")

    blob = raw
    if len(raw) >= 32 * 6:
        offset = word(raw, 3)
        if 0 < offset < len(raw) - 32 and offset % 32 == 0:
            length = word(raw, offset // 32)
            start = offset + 32
            if 0 < length <= len(raw) - start:
                blob = raw[start : start + length]
    if len(blob) < 32 * V3_WORDS:
        return None

    def signed(index: int) -> int:
        value = word(blob, index)
        return value - (1 << 256) if value >= 1 << 255 else value

    return {
        "feed_id": "0x" + blob[0:32].hex(),
        "valid_from_ts": word(blob, 1),
        "observations_ts": word(blob, 2),
        "expires_at": word(blob, 5),
        "benchmark_price": signed(6) / 1e18,
        "bid": signed(7) / 1e18,
        "ask": signed(8) / 1e18,
    }


class ChainlinkStreamsCollector:
    """BTC/USD benchmark prices from Chainlink Data Streams (low latency).

    The ordinary on-chain heartbeat oracle updates far too slowly for a 15
    minute boundary and is deliberately NOT accepted as a substitute here.
    """

    SOURCE = "chainlink_streams"

    def __init__(
        self,
        buffer: ReferenceBuffer,
        rest_url: str,
        feed_id: str | None,
        user_id: str | None,
        secret: str | None,
        limiter: HostLimiter | None = None,
        poll_s: float = 1.0,
    ) -> None:
        self.buffer = buffer
        self.rest_url = rest_url.rstrip("/")
        self.feed_id = (feed_id or "").lower()
        self.user_id = user_id or ""
        self.secret = secret or ""
        self.limiter = limiter
        self.poll_s = poll_s
        self.buffer.credentials_missing = not (self.feed_id and self.user_id and self.secret)

    def headers(self, method: str, path: str, body: bytes = b"") -> dict[str, str]:
        import hashlib
        import hmac

        timestamp = str(int(time.time() * 1000))
        body_hash = hashlib.sha256(body).hexdigest()
        message = f"{method.upper()} {path} {body_hash} {self.user_id} {timestamp}"
        signature = hmac.new(
            self.secret.encode(), message.encode(), hashlib.sha256
        ).hexdigest()
        return {
            "Authorization": self.user_id,
            "X-Authorization-Timestamp": timestamp,
            "X-Authorization-Signature-SHA256": signature,
        }

    def ingest(self, payload: dict[str, Any], receipt_ns: int) -> bool:
        """One `/reports/latest` body. The DECODED report is authoritative."""
        report = payload.get("report") if isinstance(payload.get("report"), dict) else payload
        if not isinstance(report, dict):
            return False
        decoded = decode_v3_report(str(report.get("fullReport") or ""))
        if decoded is None:
            return False
        if not self.feed_id or decoded["feed_id"].lower() != self.feed_id:
            return False
        served = str(report.get("feedID") or report.get("feed_id") or "").lower()
        if served and served != decoded["feed_id"].lower():
            return False

        observed = int(decoded["observations_ts"] or 0)
        valid_from = int(decoded["valid_from_ts"] or 0)
        expires = int(decoded["expires_at"] or 0)
        if observed <= 0 or valid_from <= 0 or valid_from > observed:
            return False
        if expires <= observed:
            return False  # already expired when observed
        # The envelope's own stamp must agree with the report it wraps.
        outer = _int(report.get("observationsTimestamp"))
        if outer is not None and abs(outer - observed) > 1:
            return False
        # Data Streams timestamps are UNIX SECONDS; the buffer stores ms.
        return self.buffer.append(
            observed * 1000,
            decoded["benchmark_price"],
            receipt_ns,
            expires_at_ms=expires * 1000,
        )

    async def run(self) -> None:
        if self.buffer.credentials_missing:
            self.buffer.error = (
                "chainlink_streams disabled: CHAINLINK_STREAMS_FEED_ID / "
                "CHAINLINK_STREAMS_USER_ID / CHAINLINK_STREAMS_SECRET not configured"
            )
            return
        path = f"/api/v1/reports/latest?feedID={self.feed_id}"
        async with httpx.AsyncClient(timeout=3.0) as client:
            while True:
                try:
                    url = self.rest_url + path
                    if self.limiter is not None:
                        await self.limiter.acquire(url)
                    response = await client.get(url, headers=self.headers("GET", path))
                    if self.limiter is not None:
                        self.limiter.note(url, response)
                    response.raise_for_status()
                    self.buffer.transport = "rest"
                    self.buffer.error = None
                    self.ingest(response.json() or {}, now_ns())
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    self.buffer.error = f"{type(exc).__name__}: {exc}"
                await asyncio.sleep(self.poll_s)


# --------------------------------------------------------------------------- #
# FREE public spot references: Coinbase Exchange and Kraken
# --------------------------------------------------------------------------- #
# Neither is the venue's own index. Both are ordinary public BTC/USD TRADE
# streams, reachable with no account, no key and no purchase, and both are used
# ONLY as a disclosed ESTIMATE of the opening boundary when the official
# same-contract strike is absent. Trade prints arrive irregularly, so the value
# they produce is a causal mean of the received prints in (T-60s, T] and is
# labelled `causal_approx_60s_trade_mean` — never presented as the exact
# 60-reading index average the contract settles against.
def _rfc3339_ms(text: Any) -> int | None:
    """Milliseconds for an RFC3339 stamp, as both venues publish them."""
    if not isinstance(text, str) or not text:
        return None
    value = text.strip()
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    from datetime import datetime

    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        return None
    if moment.tzinfo is None:
        from datetime import timezone as _tz

        moment = moment.replace(tzinfo=_tz.utc)
    return int(moment.timestamp() * 1000)


class CoinbaseMatchesCollector:
    """BTC-USD trades from Coinbase Exchange's PUBLIC market-data websocket.

    `wss://ws-feed.exchange.coinbase.com` is documented as publicly available
    without authentication (the `ws-direct` host is the one that is not), and
    the `matches` channel carries each trade's own source `time`. `heartbeat`
    is subscribed alongside it so a silent market is distinguishable from a
    dead socket.

    The first frame after subscribing is a `last_match`: a HISTORICAL print,
    stored with its real source time and its real receipt instant. It is one
    tick, and the window's gap checks refuse to treat it as sixty seconds of
    live coverage.
    """

    SOURCE = "coinbase_btcusd"
    PRODUCT = "BTC-USD"

    def __init__(
        self, buffer: ReferenceBuffer, ws_url: str = "wss://ws-feed.exchange.coinbase.com"
    ) -> None:
        self.buffer = buffer
        self.ws_url = ws_url
        self.buffer.approx_method = "causal_approx_60s_trade_mean"
        self.buffer.credentials_missing = False
        self.heartbeats = 0

    def ingest(self, frame: dict[str, Any], receipt_ns: int) -> bool:
        if not isinstance(frame, dict):
            return False
        kind = frame.get("type")
        if kind == "heartbeat":
            self.heartbeats += 1
            self.buffer.last_receipt_ns = max(self.buffer.last_receipt_ns, int(receipt_ns))
            return False
        if kind not in ("match", "last_match"):
            return False
        if frame.get("product_id") != self.PRODUCT:
            return False
        return self.buffer.append(
            _rfc3339_ms(frame.get("time")),
            frame.get("price"),
            receipt_ns,
            event_id=frame.get("trade_id"),
        )

    async def run(self) -> None:
        subscribe = json.dumps(
            {
                "type": "subscribe",
                "product_ids": [self.PRODUCT],
                "channels": ["matches", "heartbeat"],
            }
        )
        while True:
            try:
                async with websockets.connect(self.ws_url, ping_interval=10) as socket:
                    self.buffer.transport = "websocket"
                    self.buffer.error = None
                    await socket.send(subscribe)
                    async for raw in socket:
                        with contextlib.suppress(Exception):
                            self.ingest(json.loads(raw), now_ns())
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                self.buffer.disconnects += 1
                self.buffer.error = f"{type(exc).__name__}: {exc}"
                await asyncio.sleep(2.0)


class KrakenTradeCollector:
    """BTC/USD trades from Kraken's PUBLIC spot websocket v2 `trade` channel.

    `wss://ws.kraken.com/v2` needs no token for public channels. Each update
    carries a `data` BATCH; every element has its own RFC3339 `timestamp`,
    `price` and `trade_id`, and each is stored individually.
    """

    SOURCE = "kraken_btcusd"
    SYMBOL = "BTC/USD"

    def __init__(
        self, buffer: ReferenceBuffer, ws_url: str = "wss://ws.kraken.com/v2"
    ) -> None:
        self.buffer = buffer
        self.ws_url = ws_url
        self.buffer.approx_method = "causal_approx_60s_trade_mean"
        self.buffer.credentials_missing = False

    def ingest(self, frame: dict[str, Any], receipt_ns: int) -> bool:
        if not isinstance(frame, dict) or frame.get("channel") != "trade":
            return False
        if frame.get("type") not in ("update", "snapshot"):
            return False
        rows = frame.get("data")
        if not isinstance(rows, list):
            return False
        stored = False
        for row in rows:
            if not isinstance(row, dict) or row.get("symbol") != self.SYMBOL:
                continue
            stored = (
                self.buffer.append(
                    _rfc3339_ms(row.get("timestamp")),
                    row.get("price"),
                    receipt_ns,
                    event_id=row.get("trade_id"),
                )
                or stored
            )
        return stored

    async def run(self) -> None:
        subscribe = json.dumps(
            {
                "method": "subscribe",
                "params": {"channel": "trade", "symbol": [self.SYMBOL]},
            }
        )
        while True:
            try:
                async with websockets.connect(self.ws_url, ping_interval=10) as socket:
                    self.buffer.transport = "websocket"
                    self.buffer.error = None
                    await socket.send(subscribe)
                    async for raw in socket:
                        with contextlib.suppress(Exception):
                            self.ingest(json.loads(raw), now_ns())
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                self.buffer.disconnects += 1
                self.buffer.error = f"{type(exc).__name__}: {exc}"
                await asyncio.sleep(2.0)
