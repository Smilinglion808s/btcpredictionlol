"""Read-only market data (Binance GLOBAL spot 1s, OKX 15m) and the signed V3 sender.

No exchange credentials, no order endpoints. Quote fields are kept exactly:
websocket k.q / k.Q, REST kline[7] (quote volume) / kline[10] (taker-buy quote volume).
"""
from __future__ import annotations

import asyncio
import json
import threading
import time

import httpx

BINANCE_REST = "https://api.binance.com"
BINANCE_WS = "wss://stream.binance.com:9443/ws/btcusdt@kline_1s"
OKX_REST = "https://www.okx.com"
KALSHI_REST = "https://api.elections.kalshi.com/trade-api/v2"
UA = "v3-predictor-worker/v3-pf-e008-r1 (+railway; read-only)"


def parse_rest_kline(k: list) -> dict:
    return {"open_ms": int(k[0]), "open": float(k[1]), "high": float(k[2]), "low": float(k[3]), "close": float(k[4]),
            "close_ms": int(k[6]), "quote_volume": float(k[7]), "taker_buy_quote_volume": float(k[10]), "is_final": True}


def parse_ws_kline(k: dict) -> dict:
    return {"open_ms": int(k["t"]), "close_ms": int(k["T"]), "open": float(k["o"]), "high": float(k["h"]),
            "low": float(k["l"]), "close": float(k["c"]), "quote_volume": float(k["q"]),
            "taker_buy_quote_volume": float(k["Q"]), "is_final": k.get("x") is True}


class Market:
    def __init__(self, timeout: float = 8.0) -> None:
        self.http = httpx.Client(timeout=timeout, headers={"User-Agent": UA})

    def server_time_ms(self) -> int:
        r = self.http.get(f"{BINANCE_REST}/api/v3/time")
        r.raise_for_status()
        return int(r.json()["serverTime"])

    def seconds(self, candle_s: int, n: int = 30) -> list[dict]:
        r = self.http.get(f"{BINANCE_REST}/api/v3/klines", params={
            "symbol": "BTCUSDT", "interval": "1s", "startTime": candle_s * 1000,
            "endTime": candle_s * 1000 + n * 1000 - 1, "limit": n})
        r.raise_for_status()
        return [parse_rest_kline(k) for k in r.json()]

    def okx_labels(self, after_s: int | None = None) -> dict[int, int]:
        """Confirmed OKX BTC-USDT 15m candles -> sign(close-open); 'after' pages backwards."""
        params = {"instId": "BTC-USDT", "bar": "15m", "limit": "100"}
        if after_s is not None:
            params["after"] = str(after_s * 1000)
        r = self.http.get(f"{OKX_REST}/api/v5/market/history-candles", params=params)
        r.raise_for_status()
        body = r.json()
        if body.get("code") != "0":
            raise RuntimeError("OKX_" + str(body.get("code")))
        out = {}
        for k in body["data"]:
            if k[8] != "1":
                continue
            o, c = float(k[1]), float(k[4])
            out[int(k[0]) // 1000] = (c > o) - (c < o)
        return out

    def kalshi_markets(self, series: str, min_close_s: int, max_close_s: int) -> list[dict]:
        """Public, unauthenticated Kalshi market metadata (identity only; no prices used)."""
        r = self.http.get(f"{KALSHI_REST}/markets", params={
            "series_ticker": series, "min_close_ts": min_close_s, "max_close_ts": max_close_s, "limit": 100})
        r.raise_for_status()
        return list(r.json().get("markets") or [])


class SecondFeed:
    """Final 1s bars with their local receipt time. Never fabricates a bar."""

    def __init__(self) -> None:
        self.bars: dict[int, tuple[dict, int]] = {}
        self.last_rx_ms: int | None = None
        self.connected = False
        self.lock = threading.Lock()

    def put(self, bar: dict, rx_ms: int) -> None:
        if not bar["is_final"]:
            return
        with self.lock:
            self.bars.setdefault(bar["open_ms"], (bar, rx_ms))
            self.last_rx_ms = rx_ms
            cutoff = rx_ms - 300_000
            for k in [k for k in self.bars if k < cutoff]:
                del self.bars[k]

    def prefix(self, candle_s: int, n: int, received_by_ms: int) -> list[dict]:
        with self.lock:
            out = []
            for i in range(n):
                hit = self.bars.get(candle_s * 1000 + i * 1000)
                if hit and hit[1] <= received_by_ms:
                    out.append(hit[0])
            return out

    def fresh(self, now_ms: int, max_age_ms: int = 3000) -> bool:
        return self.connected and self.last_rx_ms is not None and 0 <= now_ms - self.last_rx_ms <= max_age_ms

    def run_forever(self, on_error) -> None:  # pragma: no cover - network loop
        import websockets

        async def loop():
            while True:
                try:
                    async with websockets.connect(BINANCE_WS, ping_interval=20, close_timeout=5,
                                                  user_agent_header=UA) as ws:
                        self.connected = True
                        async for msg in ws:
                            k = json.loads(msg).get("k")
                            if k:
                                self.put(parse_ws_kline(k), int(time.time() * 1000))
                except Exception as e:  # noqa: BLE001
                    on_error(f"feed:{type(e).__name__}")
                finally:
                    self.connected = False
                await asyncio.sleep(1)
        asyncio.run(loop())


class Sender:
    """Posts persisted bytes exactly. Cannot place orders; knows only one URL."""

    MAX_TIMEOUT_S = 0.8

    def __init__(self, url: str, secret: bytes, client: httpx.Client | None = None, now_ms=None) -> None:
        from v3core import url_allowed
        if url and not url_allowed(url):
            raise ValueError("V3_WEBHOOK_URL_FORBIDDEN")
        self.url, self.secret = url, secret
        self.now_ms = now_ms or (lambda: int(time.time() * 1000))
        self.http = client or httpx.Client(timeout=0.8, follow_redirects=False, headers={"User-Agent": UA})

    def post(self, event_id: str, raw: bytes, expires_ms: int | None = None) -> tuple[int | None, str | None]:
        """Final expiry check immediately before the POST; transport deadline capped to the remaining window.
        (The receiver still enforces expires_at itself.)"""
        from v3core import sign
        timeout = self.MAX_TIMEOUT_S
        if expires_ms is not None:
            remaining = expires_ms - self.now_ms()
            if remaining <= 0:
                return None, "EXPIRED_BEFORE_SEND"
            timeout = min(timeout, remaining / 1000)
        try:
            r = self.http.post(self.url, content=raw, timeout=timeout, headers={
                "content-type": "application/json", "x-btc15m-signature": sign(self.secret, raw),
                "x-v3-event-id": event_id, "x-v3-model": "v3-pf-e008-r1"})
        except httpx.HTTPError as e:
            return None, type(e).__name__
        if 300 <= r.status_code < 400:
            return 400, "REDIRECT_BLOCKED"
        return r.status_code, None
