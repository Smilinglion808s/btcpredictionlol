"""v3-predictor-worker entrypoint: feed, scheduler, catch-up, sender, /healthz.

Env:
  V3_DATA_DIR            durable volume (default /data/v3)
  V3_DELIVERY_ENABLED    "true" to POST; anything else = capture only (default off)
  V3_WEBHOOK_URL         bettor's V3 receiver (never a V1.2/V2 receiver)
  BTC15M_WEBHOOK_SECRET  existing shared HMAC secret (raw-body x-btc15m-signature)
  V3_MODE                body "mode": shadow (default) or live
  PORT                   health port (default 8080)
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from net import Market, SecondFeed, Sender  # noqa: E402
from v3core import CHECKPOINTS, GRACE_MS, SLOT, Engine, FailClosed, Store, verify_package  # noqa: E402

CLOCK_MAX_SKEW_MS = 1000


class Runtime:
    def __init__(self) -> None:
        data = Path(os.environ.get("V3_DATA_DIR", "/data/v3"))
        data.mkdir(parents=True, exist_ok=True)
        enabled = os.environ.get("V3_DELIVERY_ENABLED", "").strip().lower() == "true"
        url = os.environ.get("V3_WEBHOOK_URL", "").strip()
        secret = os.environ.get("BTC15M_WEBHOOK_SECRET", "").encode()
        self.engine = Engine(Store(data / "v3.sqlite"), delivery_enabled=enabled and bool(url) and bool(secret),
                             mode=os.environ.get("V3_MODE", "shadow"))
        if enabled and not (url and secret):
            self.engine.faults["delivery"] = "ENABLED_WITHOUT_URL_OR_SECRET"
        try:
            verify_package()
            self.engine.load_seed()
        except FailClosed as e:
            self.engine.faults["package"] = str(e)
        self.sender = Sender(url, secret) if self.engine.delivery_enabled else None
        self.market, self.feed = Market(), SecondFeed()
        self.skew_ms: int | None = None
        self.started_ms = int(time.time() * 1000)

    def err(self, k: str, v: str) -> None:
        self.engine.faults[k] = v

    def clock_ok(self) -> bool:
        return self.skew_ms is not None and abs(self.skew_ms) <= CLOCK_MAX_SKEW_MS

    def clock_loop(self) -> None:  # pragma: no cover
        while True:
            try:
                t0 = time.time() * 1000
                srv = self.market.server_time_ms()
                self.skew_ms = int(srv - (t0 + time.time() * 1000) / 2)
                self.engine.faults.pop("clock", None)
            except Exception as e:  # noqa: BLE001
                self.skew_ms = None
                self.err("clock", type(e).__name__)
            time.sleep(30)

    def scheduler_loop(self) -> None:  # pragma: no cover
        start = int(time.time())
        first = start - start % SLOT
        fired = {(first, cp) for cp in CHECKPOINTS if start >= first + cp}  # never replay a missed checkpoint
        if fired:
            self.engine._set_decision(first, "FAIL_CLOSED", "STARTED_LATE")
        while True:
            now = int(time.time() * 1000)
            c = now // 1000 - (now // 1000) % SLOT
            for cp in CHECKPOINTS:
                if (c, cp) in fired or now < (c + cp) * 1000:
                    continue
                deadline = (c + cp) * 1000 + GRACE_MS
                bars = self.feed.prefix(c, cp, deadline)
                if len(bars) == cp or now >= deadline - 20:
                    fired.add((c, cp))
                    try:
                        self.engine.checkpoint(c, cp, bars, self.feed.fresh(now), self.clock_ok())
                    except Exception as e:  # noqa: BLE001
                        self.err("score", type(e).__name__)
            fired = {k for k in fired if k[0] >= c - SLOT}
            time.sleep(0.02)

    def catchup_loop(self) -> None:  # pragma: no cover - REST, off the scoring thread
        while True:
            try:
                now_s = int(time.time())
                closed = now_s - now_s % SLOT
                for c in self.engine.missing_feature_candles(closed, limit=40):
                    self.engine.apply_backfill(c, self.market.seconds(c), final=now_s >= c + SLOT + 120)
                need = self.engine.s.q("SELECT MIN(candle_s) FROM rows WHERE label IS NULL AND candle_s>=?",
                                       (self.engine.seed_end,))[0][0]
                lo = need if need is not None else max(self.engine.seed_end, closed - 4 * SLOT)
                after = None
                for _ in range(40):
                    got = self.market.okx_labels(after)
                    self.engine.apply_labels({c: v for c, v in got.items() if c + SLOT <= now_s})
                    if not got or min(got) <= lo:
                        break
                    after = min(got)
                self.engine.catchup_step(now_s)
                self.engine.faults.pop("catchup", None)
            except Exception as e:  # noqa: BLE001
                self.err("catchup", type(e).__name__)
            time.sleep(1)

    def sender_loop(self) -> None:  # pragma: no cover
        while True:
            try:
                self.engine.prepare_due()
                if self.sender:
                    for eid, raw in self.engine.deliverable():
                        code, error = self.sender.post(eid, raw)
                        self.engine.record_attempt(eid, code, error)
            except Exception as e:  # noqa: BLE001
                self.err("sender", type(e).__name__)
            time.sleep(0.1)

    def health(self) -> dict:
        now = int(time.time() * 1000)
        st = self.engine.status()
        reasons = [k for k, v in st["fit_today"].items() if not v and (k := f"FIT_MISSING_T{k}")]
        if not st["caught_up"]:
            reasons.append("CATCHUP_GAP")
        if not self.feed.fresh(now):
            reasons.append("FEED_STALE")
        if not self.clock_ok():
            reasons.append("CLOCK_SKEW")
        if "package" in self.engine.faults:
            reasons.append("PACKAGE_INVALID")
        return {"alive": True, "prediction_ready": not reasons, "not_ready_reasons": reasons,
                "feed_age_ms": None if self.feed.last_rx_ms is None else now - self.feed.last_rx_ms,
                "clock_skew_ms": self.skew_ms, "uptime_s": (now - self.started_ms) // 1000, **st}


def serve(rt: Runtime) -> None:  # pragma: no cover
    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps(rt.health(), default=str).encode()
            self.send_response(200 if self.path in ("/", "/health", "/healthz") else 404)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), H).serve_forever()


def main() -> None:  # pragma: no cover
    rt = Runtime()
    for fn in (lambda: rt.feed.run_forever(lambda m: rt.err("feed", m)), rt.clock_loop, rt.catchup_loop,
               rt.scheduler_loop, rt.sender_loop):
        threading.Thread(target=fn, daemon=True).start()
    serve(rt)


if __name__ == "__main__":
    main()
