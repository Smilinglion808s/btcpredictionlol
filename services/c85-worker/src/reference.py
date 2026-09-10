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

  ``cf_brti``            CF Benchmarks BRTI, through Kalshi's authenticated
                         `cfbenchmarks_value` websocket. When the venue itself
                         publishes the completed windowed average for the
                         boundary (`last_60s_windowed_average_15min`, final
                         count 60) that exact value is reused and tagged
                         `venue_60s_final_average`. Otherwise the causal mean of
                         the received ticks is used and tagged
                         `causal_approx_60s_mean` — a partially built trailing
                         average is never presented as the final one.

  ``chainlink_streams``  Chainlink Data Streams BTC/USD, v3 reports. The
                         low-latency stream only; an on-chain heartbeat oracle
                         is NOT substituted for it.

Both are estimates. They are labelled as such at every layer, they never feed
settlement (official Kalshi results alone grade a decision), and they never
rewrite a frozen decision.

Neither feed has credentials in this project today. Without them each collector
reports `credentials_missing` and produces nothing: a disabled collector is
never reported as operational.
"""
from __future__ import annotations

import asyncio
import base64
import contextlib
import datetime as _dt
import json
import math
import time
from dataclasses import dataclass, field
from typing import Any

import httpx
import websockets

from .feeds import NS, HostLimiter, _BaseBuffer, now_ns

MINUTE_MS = 60_000

#: A reference tick older than this at the boundary cannot describe it.
MAX_TICK_AGE_MS = 5_000
#: Largest tolerated hole inside the 60-second window for an approximation.
MAX_GAP_MS = 5_000
#: Fewest ticks an approximation may be built from (of the ~60 expected).
MIN_TICKS = 30
#: Sanity band for a BTC/USD reference, in USD. Outside it the value is a unit
#: error (wei, cents, basis points), not a price, and is refused.
MIN_PRICE = 1_000.0
MAX_PRICE = 10_000_000.0


def _finite_price(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or not MIN_PRICE <= number <= MAX_PRICE:
        return None
    return number


@dataclass
class ReferenceBuffer(_BaseBuffer):
    """Per-second boundary reference ticks from ONE named source."""

    #: Stable source id recorded on every decision that uses it.
    source: str = "reference"
    unit: str = "USD"
    #: (source_ts_ms, value, receipt_ns), append-ordered by receipt.
    ticks: list[tuple[int, float, int]] = field(default_factory=list)
    #: boundary_ms -> the venue's own completed 60s average for that boundary.
    exact_averages: dict[int, dict[str, Any]] = field(default_factory=dict)
    retain_ms: int = 10 * MINUTE_MS
    credentials_missing: bool = False
    freshness_budget_ns: int = 10 * NS

    def append(self, source_ts_ms: int, value: Any, receipt_ns: int) -> bool:
        price = _finite_price(value)
        if price is None:
            return False
        source_ts_ms = int(source_ts_ms)
        if source_ts_ms <= 0:
            return False
        self.ticks.append((source_ts_ms, price, int(receipt_ns)))
        self.last_event_ns = source_ts_ms * 1_000_000
        self.last_receipt_ns = int(receipt_ns)
        self.connected_since_ns = self.connected_since_ns or int(receipt_ns)
        cutoff = source_ts_ms - self.retain_ms
        if len(self.ticks) > 4096:
            self.ticks = [t for t in self.ticks if t[0] >= cutoff]
        return True

    def record_exact_average(
        self, boundary_ms: int, value: Any, count: Any, receipt_ns: int
    ) -> bool:
        """Only a COMPLETED 60-tick window may be stored as the exact average."""
        price = _finite_price(value)
        try:
            ticks = int(count)
        except (TypeError, ValueError):
            return False
        if price is None or ticks != 60:
            return False
        self.exact_averages[int(boundary_ms)] = {
            "value": price,
            "count": ticks,
            "receipt_ns": int(receipt_ns),
        }
        for key in [k for k in self.exact_averages if k < int(boundary_ms) - self.retain_ms]:
            self.exact_averages.pop(key, None)
        return True

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
            (ts, value, receipt)
            for ts, value, receipt in self.ticks
            if window_start < ts <= target_ms and receipt <= freeze_ns
        ]
        if not usable:
            return {**base, "usable": False, "reason": "no_ticks_in_window"}
        usable.sort(key=lambda item: item[0])
        # De-duplicate on source second; the last received wins.
        by_second: dict[int, tuple[int, float, int]] = {}
        for ts, value, receipt in usable:
            by_second[ts // 1000] = (ts, value, receipt)
        rows = sorted(by_second.values(), key=lambda item: item[0])
        count = len(rows)
        newest_ts = rows[-1][0]
        age_ms = target_ms - newest_ts
        gaps = [b[0] - a[0] for a, b in zip(rows, rows[1:])]
        worst_gap = max(gaps) if gaps else target_ms - rows[0][0]
        detail = {
            **base,
            "tick_count": count,
            "source_age_ms": age_ms,
            "max_gap_ms": worst_gap,
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
            "method": "causal_approx_60s_mean",
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

    def ingest(self, message: dict[str, Any], receipt_ns: int) -> bool:
        """One decoded frame -> buffered tick(s). Pure; unit-tested directly."""
        payload = message.get("msg") if isinstance(message.get("msg"), dict) else message
        if not isinstance(payload, dict):
            return False
        if str(payload.get("index_id") or self.INDEX_ID).upper() != self.INDEX_ID:
            return False
        source_ts = payload.get("source_ts_ms") or payload.get("ts_ms")
        stored = False
        if source_ts:
            stored = self.buffer.append(int(source_ts), payload.get("value"), receipt_ns)
        window = payload.get("last_60s_windowed_average_15min")
        if isinstance(window, dict):
            boundary = window.get("quarter_close_ts_ms") or window.get("boundary_ts_ms")
            if boundary:
                stored |= self.buffer.record_exact_average(
                    int(boundary), window.get("value"), window.get("count"), receipt_ns
                )
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
def decode_v3_report(full_report_hex: str) -> dict[str, Any] | None:
    """Decode a Data Streams v3 report blob into its documented fields.

    Layout (schema v3): the outer payload is
    `abi.encode(bytes32[3] reportContext, bytes reportBlob, ...)`; the blob is a
    fixed sequence of 32-byte words: feedId, validFromTimestamp,
    observationsTimestamp, nativeFee, linkFee, expiresAt, benchmarkPrice, bid,
    ask. Prices are signed 192-bit integers scaled by 1e18.
    """
    text = full_report_hex[2:] if full_report_hex.startswith("0x") else full_report_hex
    try:
        raw = bytes.fromhex(text)
    except ValueError:
        return None
    if len(raw) < 32 * 5:
        return None

    def word(source: bytes, index: int) -> int:
        return int.from_bytes(source[index * 32 : (index + 1) * 32], "big")

    blob = raw
    # Outer encoding: word 3 is the offset to the report blob's length word.
    if len(raw) >= 32 * 6:
        offset = word(raw, 3)
        if 0 < offset < len(raw) - 32:
            length = word(raw, offset // 32)
            start = offset + 32
            if 0 < length <= len(raw) - start:
                blob = raw[start : start + length]
    if len(blob) < 32 * 7:
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
        report = payload.get("report") if isinstance(payload.get("report"), dict) else payload
        if not isinstance(report, dict):
            return False
        served = str(report.get("feedID") or report.get("feed_id") or "").lower()
        if self.feed_id and served and served != self.feed_id:
            return False
        decoded = decode_v3_report(str(report.get("fullReport") or ""))
        if decoded is None:
            return False
        if self.feed_id and decoded["feed_id"].lower() != self.feed_id:
            return False
        observed = int(report.get("observationsTimestamp") or decoded["observations_ts"] or 0)
        if observed <= 0:
            return False
        # Data Streams timestamps are UNIX SECONDS; the buffer stores ms.
        return self.buffer.append(observed * 1000, decoded["benchmark_price"], receipt_ns)

    async def run(self) -> None:
        if self.buffer.credentials_missing:
            self.buffer.error = (
                "chainlink_streams disabled: CHAINLINK_STREAMS_FEED_ID / _USER_ID / "
                "_SECRET not configured"
            )
            return
        path = f"/api/v1/reports/latest?feedID={self.feed_id}"
        async with httpx.AsyncClient(timeout=3.0) as client:
            while True:
                try:
                    if self.limiter is not None:
                        await self.limiter.acquire()
                    response = await client.get(
                        self.rest_url + path, headers=self.headers("GET", path)
                    )
                    if self.limiter is not None:
                        self.limiter.observe(response.status_code, response.headers)
                    response.raise_for_status()
                    self.buffer.transport = "rest"
                    self.buffer.error = None
                    self.ingest(response.json() or {}, now_ns())
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    self.buffer.error = f"{type(exc).__name__}: {exc}"
                await asyncio.sleep(self.poll_s)


def utc_ms(moment: _dt.datetime) -> int:
    return int(moment.astimezone(_dt.timezone.utc).timestamp() * 1000)
