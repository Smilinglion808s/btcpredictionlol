"""Binance spot BTCUSDT market data for V2 Final R1.

Read-only market data. This module holds no exchange credentials and cannot
place, cancel or modify an order.

Two feeds:
  * 15m closed bars   -> continuous indicator history (repo seed + REST backfill,
                         carried forward on the persistent volume).
  * 1s closed klines  -> opening-window tape, websocket first, REST backfill on
                         (re)connect. Missing seconds are NEVER silently filled.
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import threading
import time
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

INTERVAL_MS = 900_000
SYMBOL = "BTCUSDT"
COLUMNS = ["bar_open", "open", "high", "low", "close", "volume", "quote_volume", "trade_count",
           "complete", "taker_buy_volume"]


class MissingSeconds(Exception):
    """Raised when the one-second tape is incomplete. Always fails closed."""


def _f(x) -> float:
    return float(x)


def parse_kline(k: list) -> dict:
    return {
        "open_ms": int(k[0]), "open": _f(k[1]), "high": _f(k[2]), "low": _f(k[3]), "close": _f(k[4]),
        "volume": _f(k[5]), "close_ms": int(k[6]), "quote_volume": _f(k[7]), "trade_count": int(k[8]),
        "taker_buy_volume": _f(k[9]),
    }


class Rest:
    def __init__(self, base: str, timeout: float = 8.0) -> None:
        self.base = base.rstrip("/")
        self.http = httpx.Client(timeout=timeout)

    def klines(self, interval: str, start_ms: int, end_ms: int, limit: int = 1000) -> list[dict]:
        r = self.http.get(f"{self.base}/api/v3/klines", params={
            "symbol": SYMBOL, "interval": interval, "startTime": start_ms, "endTime": end_ms - 1, "limit": limit})
        r.raise_for_status()
        return [parse_kline(k) for k in r.json()]

    def server_time_ms(self) -> int:
        r = self.http.get(f"{self.base}/api/v3/time")
        r.raise_for_status()
        return int(r.json()["serverTime"])


# --------------------------------------------------------------------------- 15m history
class BarHistory:
    """Continuous 15m closed-bar history. Seed is never truncated."""

    def __init__(self, seed_dir: Path, data_dir: Path, rest: Rest) -> None:
        self.seed_dir = Path(seed_dir)
        self.path = Path(data_dir) / "bars15.csv.gz"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.rest = rest
        self.lock = threading.Lock()
        self.df = pd.DataFrame(columns=COLUMNS)

    # -- seed -----------------------------------------------------------------
    def load_seed(self) -> pd.DataFrame:
        meta = json.loads((self.seed_dir / "SEED_SHA256.json").read_text())
        raw = gzip.decompress((self.seed_dir / meta["file"]).read_bytes())
        digest = hashlib.sha256(raw).hexdigest()
        if digest != meta["decoded_sha256"]:
            raise ValueError(f"seed sha256 mismatch: {digest} != {meta['decoded_sha256']}")
        df = pd.read_csv(io.BytesIO(raw))
        if len(df) != meta["rows"]:
            raise ValueError("seed row count mismatch")
        return self._normalize(df)

    @staticmethod
    def _normalize(df: pd.DataFrame) -> pd.DataFrame:
        out = df.copy()
        out["bar_open"] = pd.to_datetime(out["bar_open"], utc=True)
        out["complete"] = out["complete"].astype(bool)
        out["trade_count"] = out["trade_count"].astype("int64")
        for c in ["open", "high", "low", "close", "volume", "quote_volume", "taker_buy_volume"]:
            out[c] = out[c].astype(float)
        out = out[COLUMNS].drop_duplicates("bar_open").sort_values("bar_open").reset_index(drop=True)
        return out

    # -- assembly --------------------------------------------------------------
    def load(self) -> pd.DataFrame:
        """Persistent volume copy if present, else the repo seed."""
        with self.lock:
            if self.path.exists():
                try:
                    df = self._normalize(pd.read_csv(self.path))
                    seed = self.load_seed()
                    if len(df) >= len(seed) and df.bar_open.iloc[0] == seed.bar_open.iloc[0]:
                        self.df = df
                        return self.df
                except Exception:  # noqa: BLE001 — corrupt cache: fall back to the verified seed
                    pass
            self.df = self.load_seed()
            return self.df

    def backfill(self, through_open_ms: int) -> int:
        """Append every closed 15m bar after the last stored bar, up to (not incl.) through_open_ms."""
        added: list[dict] = []
        cursor = int(self.df.bar_open.iloc[-1].value // 1_000_000) + INTERVAL_MS
        while cursor < through_open_ms:
            batch = self.rest.klines("15m", cursor, min(cursor + 1000 * INTERVAL_MS, through_open_ms))
            batch = [b for b in batch if b["open_ms"] < through_open_ms]
            if not batch:
                break
            added.extend(batch)
            cursor = batch[-1]["open_ms"] + INTERVAL_MS
        if added:
            rows = pd.DataFrame([{
                "bar_open": pd.Timestamp(b["open_ms"], unit="ms", tz="UTC"), "open": b["open"], "high": b["high"],
                "low": b["low"], "close": b["close"], "volume": b["volume"], "quote_volume": b["quote_volume"],
                "trade_count": b["trade_count"], "complete": True, "taker_buy_volume": b["taker_buy_volume"],
            } for b in added])
            with self.lock:
                self.df = self._normalize(pd.concat([self.df, rows], ignore_index=True))
        self.assert_continuous()
        return len(added)

    def assert_continuous(self) -> None:
        gaps = np.diff(self.df.bar_open.astype("int64").to_numpy())
        if len(gaps) and not np.all(gaps == INTERVAL_MS * 1_000_000):
            raise ValueError("15m history has a gap; refusing to predict on a truncated warmup")

    def persist(self) -> None:
        tmp = self.path.with_suffix(".tmp")
        with self.lock:
            self.df.to_csv(tmp, index=False, compression="gzip")
        tmp.replace(self.path)

    def frame(self) -> pd.DataFrame:
        with self.lock:
            return self.df.copy()

    @property
    def last_open_ms(self) -> int:
        return int(self.df.bar_open.iloc[-1].value // 1_000_000)


# --------------------------------------------------------------------------- 1s feed
class SecondFeed:
    """Closed one-second klines keyed by close_time_ms. Never fabricates a bar."""

    KEEP_MS = 3 * INTERVAL_MS

    def __init__(self, rest: Rest, ws_url: str) -> None:
        self.rest = rest
        self.ws_url = ws_url
        self.lock = threading.Lock()
        self.bars: dict[int, dict] = {}
        self.last_message_ms = 0
        self.connected = False
        self.backfilled_through_ms = 0
        self.reconnects = 0

    def put(self, bar: dict) -> None:
        with self.lock:
            self.bars[bar["close_ms"]] = bar
            self.last_message_ms = int(time.time() * 1000)
            if len(self.bars) > self.KEEP_MS // 1000:
                cutoff = max(self.bars) - self.KEEP_MS
                for k in [k for k in self.bars if k < cutoff]:
                    del self.bars[k]

    def backfill(self, start_ms: int, end_ms: int) -> int:
        """Pull completed one-second history over [start_ms, end_ms) via REST."""
        got = 0
        cursor = start_ms
        while cursor < end_ms:
            batch = self.rest.klines("1s", cursor, min(cursor + 1000_000, end_ms))
            if not batch:
                break
            for b in batch:
                if b["close_ms"] < end_ms:
                    self.put(b)
                    got += 1
            cursor = batch[-1]["open_ms"] + 1000
        self.backfilled_through_ms = max(self.backfilled_through_ms, end_ms)
        return got

    def tape(self, open_ms: int, seconds: int) -> dict:
        """Exactly `seconds` closed bars: 0..seconds-1 of this candle. Fails closed."""
        expected = [open_ms + i * 1000 + 999 for i in range(seconds)]
        with self.lock:
            missing = [c for c in expected if c not in self.bars]
            if missing:
                raise MissingSeconds(f"missing {len(missing)} of {seconds} one-second bars")
            rows = [self.bars[c] for c in expected]
        tape = {k: [r[k] for r in rows] for k in ["open", "high", "low", "close", "volume", "taker_buy_volume"]}
        tape["count"] = [r["trade_count"] for r in rows]
        return {"tape": tape, "close_time_ms": expected,
                "last_received_ms": max(self.last_message_ms, expected[-1])}

    def age_ms(self) -> int | None:
        return None if not self.last_message_ms else int(time.time() * 1000) - self.last_message_ms

    # -- websocket -------------------------------------------------------------
    def run_forever(self, on_error=lambda m: None) -> None:  # pragma: no cover - network loop
        import asyncio

        import websockets

        async def loop() -> None:
            while True:
                try:
                    async with websockets.connect(self.ws_url, ping_interval=20, close_timeout=5) as ws:
                        self.connected = True
                        # Backfill everything the socket could not have delivered.
                        now = int(time.time() * 1000)
                        try:
                            self.backfill(now - now % INTERVAL_MS, now - now % 1000)
                        except Exception as e:  # noqa: BLE001
                            on_error(f"1s backfill failed: {type(e).__name__}")
                        async for message in ws:
                            k = json.loads(message).get("k")
                            if k and k.get("x") is True:
                                self.put(parse_kline([k["t"], k["o"], k["h"], k["l"], k["c"], k["v"], k["T"],
                                                      k["q"], k["n"], k["V"], k["Q"], "0"]))
                except Exception as e:  # noqa: BLE001
                    self.connected = False
                    self.reconnects += 1
                    on_error(f"1s websocket: {type(e).__name__}")
                    await asyncio.sleep(2)

        asyncio.run(loop())
