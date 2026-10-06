"""v3-predictor-worker entrypoint: feed, scheduler, catch-up, sender, /healthz.

Env:
  V3_DATA_DIR            durable volume (default /data/v3)
  V3_DELIVERY_ENABLED    "true" to POST; anything else = capture only (default off)
  V3_WEBHOOK_URL         bettor's V3 receiver (never a V1.2/V2 receiver)
  BTC15M_WEBHOOK_SECRET  existing shared HMAC secret (raw-body x-btc15m-signature)
  V3_MODE                body "mode": shadow (default) or live
  PORT                   health port (default 8080)
  V3_DELIVERY_POLICY     t48-r1 (default, legacy: send at T48) or asap-r1 (send right after selection);
                         any other value refuses to start
  V3_RECORD_URL          optional dashboard recorder (site /api/public/hooks/v3-record); off when unset
  C85_GATEWAY_SECRET     HMAC for the dashboard recorder only (never used for betting delivery)
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
from v3core import DELIVERY_POLICIES, CHECKPOINTS, GRACE_MS, SLOT, Engine, FailClosed, Store, verify_package  # noqa: E402

CLOCK_MAX_SKEW_MS = 1000


class Runtime:
    def __init__(self) -> None:
        data = Path(os.environ.get("V3_DATA_DIR", "/data/v3"))
        data.mkdir(parents=True, exist_ok=True)
        enabled = os.environ.get("V3_DELIVERY_ENABLED", "").strip().lower() == "true"
        url = os.environ.get("V3_WEBHOOK_URL", "").strip()
        secret = os.environ.get("BTC15M_WEBHOOK_SECRET", "").encode()
        policy = os.environ.get("V3_DELIVERY_POLICY", "").strip() or "t48-r1"
        if policy not in DELIVERY_POLICIES:
            raise SystemExit(f"UNKNOWN_DELIVERY_POLICY:{policy}")
        self.wake = threading.Event()
        self.engine = Engine(Store(data / "v3.sqlite"), delivery_policy=policy, delivery_enabled=enabled and bool(url) and bool(secret),
                             mode=os.environ.get("V3_MODE", "shadow"))
        if enabled and not (url and secret):
            self.engine.faults["delivery"] = "ENABLED_WITHOUT_URL_OR_SECRET"
        try:
            verify_package()
            self.engine.load_seed()
        except FailClosed as e:
            self.engine.faults["package"] = str(e)
        except Exception as e:  # noqa: BLE001 - any seed/manifest problem fails closed
            self.engine.faults["package"] = f"PACKAGE_INVALID:{type(e).__name__}"
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
        if fired and self.engine._decision(first) is None:
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
                        r = self.engine.checkpoint(c, cp, bars, self.feed.fresh(now), self.clock_ok())
                        if r.get("status") == "SELECTED":
                            self.wake.set()  # sender prepares/sends off this thread
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

    def market_loop(self) -> None:  # pragma: no cover - public Kalshi metadata, off the scoring thread
        from v3core import KALSHI_SERIES
        while True:
            try:
                now_s = int(time.time())
                got = self.market.kalshi_markets(KALSHI_SERIES, now_s, now_s + 4 * SLOT)
                self.engine.record_markets(got, KALSHI_SERIES)
                self.engine.faults.pop("market_fetch", None)
            except Exception as e:  # noqa: BLE001
                self.err("market_fetch", type(e).__name__)
            time.sleep(60)

    def send_once(self) -> dict:
        """One sender pass. Capture/expiry always run; an actual POST requires a good clock checked
        immediately before each send. Clock-blocked events stay queued (same bytes) and expire at T49."""
        self.engine.prepare_due()
        out = {"posted": 0, "clock_blocked": 0}
        if not self.sender:
            return out
        for eid, raw in self.engine.deliverable():
            if not self.clock_ok():
                out["clock_blocked"] += 1
                self.err("sender_clock", f"CLOCK_BLOCKED:{eid}")
                continue
            code, error = self.sender.post(eid, raw, self.engine.expires_ms(eid))
            self.engine.record_attempt(eid, code, error)
            out["posted"] += 1
        if out["clock_blocked"] == 0:
            self.engine.faults.pop("sender_clock", None)
        return out

    def sender_loop(self) -> None:  # pragma: no cover
        while True:
            try:
                self.send_once()
            except Exception as e:  # noqa: BLE001
                self.err("sender", type(e).__name__)
            self.wake.wait(0.1)  # woken immediately on a SELECTED checkpoint; else poll for retries/expiry
            self.wake.clear()

    def record_payload(self, limit: int = 8) -> dict:
        """Status + recent decisions for the dashboard tile. Read-only view of local state."""
        import uuid
        from v3core import MODEL_VERSION, iso_ms
        rows = self.engine.s.q(
            "SELECT d.candle_s,d.status,d.reason,d.checkpoint,d.direction,d.rank,d.decision_ms,d.fit_version,d.audit,o.status "
            "FROM decisions d LEFT JOIN outbox o ON o.candle_s=d.candle_s ORDER BY d.candle_s DESC LIMIT ?", (limit,))
        out = []
        for c, stt, reason, cp, direction, rank, dms, fv, audit, delivery in rows:
            a = json.loads(audit or "{}")
            out.append({"candle_open": iso_ms(c * 1000), "status": stt, "reason": reason, "checkpoint": cp,
                        "direction": direction, "rank": rank, "decision_at": iso_ms(dms) if dms else None,
                        "fit_version": fv, "delivery": delivery,
                        "t15_rank": (a.get("t15") or {}).get("rank"), "t30_rank": (a.get("t30") or {}).get("rank")})
        return {"model_version": MODEL_VERSION, "worker_id": os.environ.get("RAILWAY_REPLICA_ID", "v3-worker")[:64],
                "nonce": uuid.uuid4().hex + uuid.uuid4().hex[:8], "status": self.health(), "decisions": out}

    def record_loop(self) -> None:  # pragma: no cover - dashboard only, never betting
        import hashlib
        import hmac
        import httpx
        url, secret = os.environ.get("V3_RECORD_URL", "").strip(), os.environ.get("C85_GATEWAY_SECRET", "").encode()
        if not (url.startswith("https://") and url.endswith("/api/public/hooks/v3-record") and secret):
            return
        http = httpx.Client(timeout=5.0, follow_redirects=False)
        while True:
            try:
                raw = json.dumps(self.record_payload(), separators=(",", ":"), default=str).encode()
                ts = str(int(time.time() * 1000))
                sig = hmac.new(secret, ts.encode() + b"." + raw, hashlib.sha256).hexdigest()
                http.post(url, content=raw, headers={"content-type": "application/json",
                                                     "x-c85-timestamp": ts, "x-c85-signature": sig})
                self.engine.faults.pop("recorder", None)
            except Exception as e:  # noqa: BLE001
                self.err("recorder", type(e).__name__)
            time.sleep(20)

    def health(self) -> dict:
        now = int(time.time() * 1000)
        try:
            st = self.engine.status()
        except Exception as e:  # noqa: BLE001
            st = {"fit_today": {}, "caught_up": False, "status_error": type(e).__name__}
        reasons = [f"FIT_MISSING_T{k}" for k, v in st["fit_today"].items() if not v]
        if not st["caught_up"]:
            reasons.append("CATCHUP_GAP")
        if not self.feed.fresh(now):
            reasons.append("FEED_STALE")
        if not self.clock_ok():
            reasons.append("CLOCK_SKEW")
        if "package" in self.engine.faults:
            reasons.append("PACKAGE_INVALID")
        if "status_error" in st:
            reasons.append("STATUS_ERROR")
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
    for fn in (lambda: rt.feed.run_forever(lambda m: rt.err("feed", m)), rt.clock_loop, rt.catchup_loop, rt.market_loop, rt.record_loop,
               rt.scheduler_loop, rt.sender_loop):
        threading.Thread(target=fn, daemon=True).start()
    serve(rt)


if __name__ == "__main__":
    main()
