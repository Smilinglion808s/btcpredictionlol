"""V2 Final R1 recording worker (v2-final-r1). RECORDING ONLY.

Per BTC-USDT 15m candle:
  Binance spot 15m history (repo seed + REST backfill, carried on the volume)
  -> pre-open frame computed off the hot path before T+8
  -> Binance spot 1s closed klines (websocket, REST backfill on reconnect)
  -> frozen package v2final.V2Final (Direction8 > Fade8 > Direction45)
  -> durable SQLite single-candle intent + at-least-once outbox
  -> signed POST to the site's /api/public/hooks/v2-record.

EXECUTION IS UNCONDITIONALLY OFF. This process holds no exchange or betting
credentials, imports no executor, and has no code path that submits, cancels
or retries an order. It never contacts any V1.2 receiver.

Fail-closed rules: missing/late one-second bars, a missed checkpoint window,
an unready pre-open frame, clock skew, a stale/expired model bundle or a hash
mismatch all abstain and record the reason. Nothing is ever back-filled or
silently substituted.

The frozen decision store is authoritative for candle eligibility. Errors are
recorded in this worker's separate audit journal only; they never write a
decision row, so a candle whose T+8 failed is ineligible for T+45.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import httpx
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
PACKAGE_DIR = Path(os.environ.get("V2_PACKAGE_DIR", str(ROOT / "package")))
if str(PACKAGE_DIR) not in sys.path:
    sys.path.insert(0, str(PACKAGE_DIR))

from marketdata import INTERVAL_MS, BarHistory, MissingSeconds, Rest, SecondFeed  # noqa: E402
from journal import Journal  # noqa: E402
from v2final.features import PRE, TECH, preopen_frame  # noqa: E402
from v2final.runtime import MODEL_ID, DecisionStore, V2Final  # noqa: E402

MODEL_VERSION = MODEL_ID  # v2-final-r1
WIRE_SLEEVES = {"Direction8": "v2-direction8-r1", "Fade8": "v2-fade8-r1", "Direction45": "v2-direction45-r1"}
CHECKPOINTS = {"T8": 8, "T45": 45}
REQUIRED_SECONDS = {8: 8, 45: 44}
EXECUTION = "OFF"
MAX_SKEW_MS = 1_500
POLL_MS = 10


# --------------------------------------------------------------------------- config
class Config:
    def __init__(self, env: dict | None = None) -> None:
        e = os.environ if env is None else env
        mode = e.get("V2_MODE", "shadow")
        if mode not in ("shadow", "record"):
            raise SystemExit("V2_MODE must be 'shadow' or 'record'; execution is unconditionally off")
        self.mode = mode
        self.record_url = e.get("V2_RECORD_URL", "")
        self.secret = e.get("C85_GATEWAY_SECRET", "").encode()
        self.worker_id = e.get("V2_WORKER_ID", "v2-predictor-worker")
        self.data_dir = Path(e.get("V2_DATA_DIR", "/data/v2"))
        self.package_dir = PACKAGE_DIR
        self.rest_base = e.get("V2_BINANCE_REST", "https://data-api.binance.vision")
        self.ws_url = e.get("V2_BINANCE_WS", "wss://data-stream.binance.vision/ws/btcusdt@kline_1s")
        self.port = int(e.get("PORT", "8080"))


# --------------------------------------------------------------------------- helpers
def verify_package(package_dir: Path) -> dict:
    """Byte-exact check of every frozen module and model file."""
    spec = json.loads((package_dir / "CONTENT_HASHES.json").read_text())
    bad = [f for f, want in spec["files"].items()
           if hashlib.sha256((package_dir / f).read_bytes()).hexdigest() != want]
    if bad:
        raise ValueError(f"package hash mismatch: {bad}")
    return spec


def inputs_hash(preopen: dict, scale: dict, tape: dict, close_time_ms: list[int]) -> str:
    blob = json.dumps({"preopen": {k: round(float(v), 10) for k, v in sorted(preopen.items())},
                       "scale": {k: round(float(v), 10) for k, v in sorted(scale.items())},
                       "tape": {k: [round(float(x), 10) for x in v] for k, v in sorted(tape.items())},
                       "close_time_ms": close_time_ms}, separators=(",", ":"))
    return hashlib.sha256(blob.encode()).hexdigest()


def iso_ms(ms: int) -> str:
    return pd.Timestamp(ms, unit="ms", tz="UTC").isoformat().replace("+00:00", "Z")


# --------------------------------------------------------------------------- engine
class Engine:
    """Owns state, scoring and journaling. Delivery happens on another thread."""

    FEED_STALE_MS = 5_000

    def __init__(self, cfg: Config, rest: Rest | None = None, feed: SecondFeed | None = None) -> None:
        self.cfg = cfg
        self.rest = rest or Rest(cfg.rest_base)
        self.feed = feed or SecondFeed(self.rest, cfg.ws_url)
        self.history = BarHistory(ROOT / "seed", cfg.data_dir, self.rest)
        self.journal = Journal(cfg.data_dir / "v2.sqlite")
        self.errors: list[str] = []
        self.model: V2Final | None = None
        self.store: DecisionStore | None = None
        self.package_ok = False
        self.history_ready = False
        self.clock_skew_ms: int | None = None
        self.preopen: dict | None = None  # {target_ms, preopen, scale}
        self.last_checkpoint: dict | None = None
        self.started_ms = int(time.time() * 1000)

    # -- diagnostics -----------------------------------------------------------
    @staticmethod
    def now() -> int:
        return int(time.time() * 1000)

    def err(self, msg: str) -> None:
        self.errors = ([f"{time.strftime('%H:%M:%SZ', time.gmtime())} {msg}"] + self.errors)[:10]

    @property
    def manifest(self) -> dict:
        return self.model.schema if self.model else {}

    def model_expired(self, now_ms: int | None = None) -> bool:
        if not self.model:
            return True
        now = pd.Timestamp(now_ms if now_ms is not None else self.now(), unit="ms", tz="UTC")
        return not (pd.Timestamp(self.manifest["valid_from"]) <= now < pd.Timestamp(self.manifest["valid_until"]))

    def feed_ready(self, now_ms: int) -> bool:
        """Recent receipts and observed closed bars cover the current candle.

        REST's startup/reconnect watermark does not advance on a continuous
        socket. Exact checkpoint coverage remains enforced by has_all/tape.
        A connected flag alone is never evidence of fresh market data.
        """
        target = now_ms - now_ms % INTERVAL_MS
        with self.feed.lock:
            last = self.feed.last_message_ms
            latest_close = max(self.feed.bars, default=None)
        return bool(last and latest_close is not None
                    and 0 <= now_ms - last <= self.FEED_STALE_MS
                    and target <= latest_close <= now_ms
                    and now_ms - latest_close <= self.FEED_STALE_MS)

    def preopen_current(self, now_ms: int) -> bool:
        return bool(self.preopen and self.preopen["target_ms"] == now_ms - now_ms % INTERVAL_MS)

    def prediction_ready(self, now_ms: int | None = None) -> bool:
        now_ms = self.now() if now_ms is None else now_ms
        return bool(self.package_ok and self.model and self.history_ready
                    and self.preopen_current(now_ms) and self.feed_ready(now_ms)
                    and not self.model_expired(now_ms)
                    and self.clock_skew_ms is not None and abs(self.clock_skew_ms) <= MAX_SKEW_MS)

    def status(self) -> dict:
        now = self.now()
        return {
            "mode": self.cfg.mode, "execution": EXECUTION, "model_version": MODEL_VERSION,
            "package_ok": self.package_ok, "model_valid": bool(self.model) and not self.model_expired(),
            "model_valid_until": self.manifest.get("valid_until"),
            "refit_required": self.model_expired(),
            "history_ready": self.history_ready, "history_bars": int(len(self.history.df)),
            "history_last_open": iso_ms(self.history.last_open_ms) if len(self.history.df) else None,
            "preopen_target": iso_ms(self.preopen["target_ms"]) if self.preopen else None,
            "preopen_current": self.preopen_current(now),
            "feed_connected": self.feed.connected, "feed_age_ms": self.feed.age_ms(),
            "feed_ready": self.feed_ready(now),
            "feed_reconnects": self.feed.reconnects, "clock_skew_ms": self.clock_skew_ms,
            "prediction_ready": self.prediction_ready(now), "outbox_pending": self.journal.pending_count(),
            "last_checkpoint": self.last_checkpoint, "uptime_s": (now - self.started_ms) // 1000,
            "errors": self.errors,
        }

    # -- startup ---------------------------------------------------------------
    def load_model(self) -> None:
        verify_package(self.cfg.package_dir)
        self.package_ok = True
        self.model = V2Final(self.cfg.package_dir / "models" / "current")
        self.store = DecisionStore(str(self.cfg.data_dir / "v2.sqlite"), self.model)

    def check_clock(self) -> int | None:
        try:
            before = self.now()
            server = self.rest.server_time_ms()
            after = self.now()
            self.clock_skew_ms = (before + after) // 2 - server
        except Exception as e:  # noqa: BLE001
            self.clock_skew_ms = None
            self.err(f"clock check failed: {type(e).__name__}")
        return self.clock_skew_ms

    def warm_history(self) -> None:
        """Seed -> volume copy -> REST backfill through the last closed bar.

        history_ready only becomes true after a fully verified, gap-free load.
        """
        self.history_ready = False
        self.history.load()
        now = self.now()
        self.history.backfill(now - now % INTERVAL_MS)
        self.history.persist()
        self.history_ready = True

    # -- pre-open frame ---------------------------------------------------------
    def build_preopen(self, target_ms: int) -> None:
        """Runs off the hot path. Uses only bars closed before target_ms."""
        bars = self.history.frame()
        bars = bars[bars.bar_open < pd.Timestamp(target_ms, unit="ms", tz="UTC")]
        pre, sc = preopen_frame(bars)
        ts = pd.Timestamp(target_ms, unit="ms", tz="UTC")
        rowp = pre[pre.ts == ts]
        rows = sc[sc.ts == ts]
        if rowp.empty or rows.empty:
            raise ValueError("pre-open row unavailable for target")
        preopen = {k: float(rowp.iloc[0][k]) for k in PRE + TECH}
        scale = {k: float(rows.iloc[0][k]) for k in ["vol", "meanvol", "meancount"]}
        if not all(pd.notna(v) for v in preopen.values()) or not all(v > 0 for v in scale.values()):
            raise ValueError("pre-open warmup incomplete")
        self.preopen = {"target_ms": target_ms, "preopen": preopen, "scale": scale}

    def refresh_boundary(self, target_ms: int) -> None:
        """Append the bar that just closed, then rebuild pre-open for the new target.

        A failed startup warmup is recovered here: readiness returns only after a
        complete verified history plus a current pre-open frame.
        """
        if not self.history_ready:
            self.warm_history()
        self.history.backfill(target_ms)
        self.history.persist()
        self.build_preopen(target_ms)

    # -- eligibility ------------------------------------------------------------
    def frozen_record(self, target_ms: int):
        """(checkpoint, called) from the frozen decision store, or None."""
        if not self.store:
            return None
        try:
            return self.store.db.execute(
                "SELECT checkpoint,called FROM decisions WHERE target_ms=?", (target_ms,)).fetchone()
        except Exception:  # noqa: BLE001
            return None

    def blocking_reason(self, target_ms: int, second: int, now_ms: int) -> str | None:
        """First fail-closed reason preventing a score right now, else None."""
        if not self.package_ok:
            return "PACKAGE_INVALID"
        if not self.model or self.model_expired(now_ms):
            return "MODEL_EXPIRED"
        if self.clock_skew_ms is None or abs(self.clock_skew_ms) > MAX_SKEW_MS:
            return "CLOCK_SKEW"
        if not self.history_ready:
            return "HISTORY_NOT_READY"
        if not self.preopen:
            return "PREOPEN_NOT_READY"
        if self.preopen["target_ms"] != target_ms:
            return "PREOPEN_STALE"
        if not self.feed_ready(now_ms):
            return "FEED_NOT_READY"
        if second == 45 and self.frozen_record(target_ms) is None:
            # T+8 never produced a frozen record (missing data, late, or an error):
            # the whole candle is ineligible. Errors never grant T+45 permission.
            return "T8_UNRESOLVED"
        if not self.feed.has_all(target_ms, REQUIRED_SECONDS[second]):
            return "MISSING_SECONDS"
        return None

    def inputs_available(self, target_ms: int, second: int, now_ms: int) -> bool:
        return self.blocking_reason(target_ms, second, now_ms) is None

    # -- scoring ----------------------------------------------------------------
    def wire_sleeve(self, second: int, sleeve: str) -> str:
        if second == 45:
            return WIRE_SLEEVES["Direction45"]
        return WIRE_SLEEVES.get(sleeve, WIRE_SLEEVES["Direction8"])

    def journal_checkpoint(self, target_ms: int, second: int, sleeve: str, side, probability,
                           eligible: bool, features_ready: bool, reason: str | None, payload: dict,
                           decision_ms: int | None = None, decision_at: str | None = None) -> dict:
        cp = {
            "candle_open": iso_ms(target_ms),
            "checkpoint": "T8" if second == 8 else "T45",
            "sleeve": self.wire_sleeve(second, sleeve),
            "side": side, "probability": probability,
            "eligible": bool(eligible), "features_ready": bool(features_ready),
            "reason": reason,
            # The model's own decision time, never a later serializer clock.
            "decision_at": (iso_ms(int(pd.Timestamp(decision_at).value // 1_000_000)) if decision_at
                            else iso_ms(decision_ms if decision_ms is not None else self.now())),
            "payload": {**payload, "execution": EXECUTION, "mode": self.cfg.mode,
                        "model_version": MODEL_VERSION, "worker_id": self.cfg.worker_id},
        }
        self.journal.record(cp)
        self.last_checkpoint = {"candle_open": cp["candle_open"], "checkpoint": cp["checkpoint"],
                                "sleeve": cp["sleeve"], "eligible": cp["eligible"], "reason": reason}
        return cp

    def fail_closed(self, target_ms: int, second: int, reason: str, now_ms: int | None = None) -> dict:
        """Audit-journal only. No decision row is written, so T+45 stays blocked."""
        return self.journal_checkpoint(target_ms, second, "ABSTAIN", 0, None, False, False, reason,
                                       {"fail_closed": True}, now_ms)

    # -- crash recovery ----------------------------------------------------------
    def checkpoint_from_event(self, event: dict) -> dict:
        """Rebuild the journal record from the immutable frozen decision payload."""
        target_ms = int(event["target_ms"])
        sec = int(event["decision_second"])
        conf = event.get("confidence")
        conf = None if conf is None or not pd.notna(conf) else float(conf)
        return {
            "candle_open": iso_ms(target_ms),
            "checkpoint": "T8" if sec == 8 else "T45",
            "sleeve": self.wire_sleeve(sec, event["sleeve"]),
            "side": int(event["side"]), "probability": conf,
            "eligible": bool(event["model_eligible"]), "features_ready": True, "reason": None,
            # the original decision instant, normalized; never "now"
            "decision_at": iso_ms(int(pd.Timestamp(event["decision_time"]).value // 1_000_000)),
            "payload": {"recovered": True, "event_id": event["event_id"], "sleeve_name": event["sleeve"],
                        "assumed_effective_odds": event.get("assumed_effective_odds"),
                        "execution": EXECUTION, "mode": self.cfg.mode,
                        "model_version": MODEL_VERSION, "worker_id": self.cfg.worker_id},
        }

    def store_recoverable(self, now_ms: int | None = None) -> list[dict]:
        """Committed frozen decisions that may still be missing their journal row.

        Both kinds count: unacknowledged calls (poll_pending) and scored T+8
        ABSTAIN rows, which never enter poll_pending because called=0 yet are the
        record that permits T+45. Only real committed payloads are returned —
        nothing is manufactured.
        """
        if not self.store:
            return []
        rows: list[dict] = []
        try:
            rows.extend(self.store.poll_pending())
        except Exception as e:  # noqa: BLE001
            self.err(f"reconcile read: {type(e).__name__}")
        cutoff = (self.now() if now_ms is None else now_ms) - 2 * INTERVAL_MS
        try:
            rows.extend(json.loads(r[0]) for r in self.store.db.execute(
                "SELECT payload FROM decisions WHERE called=0 AND target_ms>=? ORDER BY target_ms", (cutoff,)))
        except Exception as e:  # noqa: BLE001
            self.err(f"reconcile abstention read: {type(e).__name__}")
        return rows

    def reconcile_store(self, now_ms: int | None = None) -> int:
        """Drain frozen-store decisions committed before their journal write.

        Runs at startup and ahead of any new scoring — so the T+8 abstention is
        journaled before a T+45 evaluation overwrites the frozen row. The payload
        is never altered and a call is acked only once the journal + outbox row is
        durable. Transport is at-least-once with downstream deduplication on the
        natural key; a candle still yields at most one intent.
        """
        n = 0
        for event in self.store_recoverable(now_ms):
            try:
                cp = self.checkpoint_from_event(event)
                fresh = self.journal.record(cp)  # insert-once; identical body on replay
                if event.get("model_eligible"):
                    self.store.ack(event["event_id"])  # only after journal+outbox durable
                elif not fresh:
                    continue  # abstention already journaled; nothing to recover
                self.last_checkpoint = {"candle_open": cp["candle_open"], "checkpoint": cp["checkpoint"],
                                        "sleeve": cp["sleeve"], "eligible": cp["eligible"],
                                        "reason": "RECOVERED"}
                n += 1
            except Exception as e:  # noqa: BLE001
                self.err(f"reconcile: {type(e).__name__}")
        return n


    def run_checkpoint(self, target_ms: int, second: int, now_ms: int | None = None) -> dict:
        self.reconcile_store()
        supplied = now_ms is not None
        now_ms = self.now() if now_ms is None else now_ms
        required = REQUIRED_SECONDS[second]
        start = target_ms + second * 1000
        reason = self.blocking_reason(target_ms, second, now_ms)
        if reason:
            return self.fail_closed(target_ms, second, reason, now_ms)
        if not (start <= now_ms < start + 1000):
            return self.fail_closed(target_ms, second, "CHECKPOINT_WINDOW_MISSED", now_ms)
        try:
            snap = self.feed.tape(target_ms, required)
        except MissingSeconds:
            return self.fail_closed(target_ms, second, "MISSING_SECONDS", now_ms)

        # Snapshot is locked first; the decision clock is read after it.
        decision_ms = now_ms if supplied else self.now()
        if not (start <= decision_ms < start + 1000):
            return self.fail_closed(target_ms, second, "CHECKPOINT_WINDOW_MISSED", decision_ms)
        received = snap["last_received_ms"]
        if (received > decision_ms or received > self.now()
                or received < snap["close_time_ms"][-1]
                or self.clock_skew_ms is None or abs(self.clock_skew_ms) > MAX_SKEW_MS):
            return self.fail_closed(target_ms, second, "INVALID_RECEIPT_TIME", decision_ms)

        request = {
            "target_open": iso_ms(target_ms),
            "decision_time": iso_ms(decision_ms),
            "preopen_asof": pd.Timestamp(target_ms - 1, unit="ms", tz="UTC").isoformat(),
            "last_input_received_at": iso_ms(received),
            "decision_second": second,
            "feed": "binance-spot-btcusdt",
            "preopen": self.preopen["preopen"], "scale": self.preopen["scale"],
            "tape": snap["tape"], "close_time_ms": snap["close_time_ms"],
        }
        try:
            out = self.store.evaluate(request)
        except Exception as e:  # noqa: BLE001 — fail closed, never guess
            self.err(f"score T{second}: {type(e).__name__}")
            return self.fail_closed(target_ms, second, f"SCORE_FAILED_{type(e).__name__}", decision_ms)
        if out.get("duplicate"):
            return self.journal_checkpoint(target_ms, second, out["sleeve"], out["side"], out.get("confidence"),
                                           False, True, "DUPLICATE_INTENT", {"duplicate": True}, decision_ms)
        payload = {
            "inputs_hash": inputs_hash(self.preopen["preopen"], self.preopen["scale"],
                                       snap["tape"], snap["close_time_ms"]),
            "policy_sha256": self.manifest.get("policy_sha256"),
            "sleeve_name": out["sleeve"], "event_id": out["event_id"],
            "assumed_effective_odds": out.get("assumed_effective_odds"),
            # Runtime measurements, kept apart from the model's decision time.
            "receipt_latency_ms": int(decision_ms - received),
            "scoring_latency_ms": int(self.now() - decision_ms),
        }
        prob = out.get("confidence")
        prob = None if prob is None or not pd.notna(prob) else float(prob)
        cp = self.journal_checkpoint(target_ms, second, out["sleeve"], int(out["side"]), prob,
                                     bool(out["model_eligible"]), True, None, payload,
                                     decision_at=out["decision_time"])
        if out["model_eligible"]:
            try:
                self.store.ack(out["event_id"])  # journal + outbox already durable
            except Exception as e:  # noqa: BLE001
                self.err(f"ack: {type(e).__name__}")
        return cp


# --------------------------------------------------------------------------- transport
def _error_code(r: httpx.Response) -> str:
    """Receiver error code only (allowlisted characters), never raw body text."""
    try:
        code = str(r.json().get("error", ""))
    except Exception:  # noqa: BLE001
        code = ""
    return code if code.replace("_", "").isalnum() and len(code) <= 40 else "UNKNOWN"


class Sender:
    """Outbox delivery. Runs on its own thread so scoring is never delayed."""

    def __init__(self, engine: Engine) -> None:
        self.engine = engine
        self.http = httpx.Client(timeout=4.0, headers={"User-Agent": f"v2-predictor-worker/{MODEL_VERSION} (+railway; hmac-signed)"})

    def signed_post(self, op: str, **payload) -> httpx.Response:
        cfg = self.engine.cfg
        body = json.dumps({"op": op, "nonce": uuid.uuid4().hex, "worker_id": cfg.worker_id,
                           "model_version": MODEL_VERSION, **payload},
                          separators=(",", ":"), allow_nan=False, default=str)
        ts = str(int(time.time() * 1000))
        sig = hmac.new(cfg.secret, f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()
        return self.http.post(cfg.record_url, content=body, headers={
            "content-type": "application/json", "x-c85-timestamp": ts, "x-c85-signature": sig})

    def deliver_once(self) -> None:
        eng = self.engine
        for key, body in eng.journal.pending():
            # A T+45 row must never land before its own candle's T+8 record: the
            # receiver would store it with no qualifying abstention. Hold it while
            # the T+8 delivery is still pending; it is retried on the next pass and
            # is never acked or dropped as delivered.
            if body.get("checkpoint") == "T45" and eng.journal.has_pending(body["candle_open"], "T8"):
                continue
            try:
                r = self.signed_post("record", checkpoint=body)

            except httpx.HTTPError as e:
                eng.err(f"deliver transport {type(e).__name__}")
                continue
            if r.is_success:
                eng.journal.mark(key, "DELIVERED", str(r.status_code))
            elif r.status_code >= 500:
                eng.err(f"deliver {r.status_code}")
            else:  # terminal 4xx (e.g. NOT_CURRENT_INTERVAL) — never replayed into a later candle
                code = _error_code(r)
                eng.journal.mark(key, "REJECTED", f"{r.status_code} {code}")
                eng.err(f"rejected {r.status_code} {code}")
        eng.journal.expire_stale()

    def run_forever(self) -> None:  # pragma: no cover - network loop
        while True:
            try:
                self.deliver_once()
            except Exception as e:  # noqa: BLE001
                self.engine.err(f"sender: {type(e).__name__}")
            time.sleep(0.5)

    def heartbeat_forever(self) -> None:  # pragma: no cover - network loop
        while True:
            try:
                self.signed_post("heartbeat", status=self.engine.status())
            except Exception as e:  # noqa: BLE001
                self.engine.err(f"heartbeat: {type(e).__name__}")
            time.sleep(30)


# --------------------------------------------------------------------------- loops
def boundary_loop(engine: Engine) -> None:  # pragma: no cover - timing loop
    """Refresh history + pre-open once per 15m boundary, off the scoring path."""
    done: set[int] = set()
    while True:
        try:
            now = int(time.time() * 1000)
            target = now - now % INTERVAL_MS
            if target not in done and (engine.preopen or {}).get("target_ms") != target:
                engine.refresh_boundary(target)
                done = {target}
        except Exception as e:  # noqa: BLE001
            engine.err(f"preopen build: {type(e).__name__}")
            time.sleep(2)
        time.sleep(0.2)


def clock_loop(engine: Engine) -> None:  # pragma: no cover - timing loop
    while True:
        engine.check_clock()
        time.sleep(60)


def run_window(engine: Engine, target_ms: int, second: int, now=None, sleep=None) -> dict:
    """Wait inside [sec, sec+1) for the exact closed bars, then score once.

    The closed one-second bar for the last required second normally arrives a
    little after the boundary, so firing at exactly sec.000 would record a
    spurious MISSING_SECONDS. Here the window is polled locally (no REST inside
    the scoring loop) and scored as soon as everything is present. Nothing is
    ever scored past the window; at the deadline the real blocking reason — or
    CHECKPOINT_LATE — is recorded.
    """
    now = now or engine.now
    sleep = sleep or time.sleep
    start = target_ms + second * 1000
    deadline = start + 1000
    while True:
        t = now()
        if t >= deadline:
            return engine.fail_closed(target_ms, second,
                                      engine.blocking_reason(target_ms, second, t) or "CHECKPOINT_LATE", t)
        if t >= start and engine.inputs_available(target_ms, second, t):
            return engine.run_checkpoint(target_ms, second, t)
        sleep(POLL_MS / 1000)


def scheduler_loop(engine: Engine) -> None:  # pragma: no cover - timing loop
    fired: set[str] = set()
    while True:
        now = int(time.time() * 1000)
        target = now - now % INTERVAL_MS
        for name, sec in CHECKPOINTS.items():
            key = f"{target}:{name}"
            if key in fired:
                continue
            start = target + sec * 1000
            if start <= now < start + 1000:
                fired.add(key)
                try:
                    run_window(engine, target, sec)
                except Exception as e:  # noqa: BLE001
                    engine.err(f"{name}: {type(e).__name__}")
            elif now >= start + 1000:
                fired.add(key)
                engine.fail_closed(target, sec, "CHECKPOINT_LATE", now)
        if len(fired) > 24:
            fired = {k for k in fired if k.startswith(str(target))}
        time.sleep(0.02)


# --------------------------------------------------------------------------- health
def make_health_handler(engine: Engine):
    class Health(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            path = self.path.split("?")[0]
            # Railway health check path: /healthz (/health and / behave the same).
            if path in ("/healthz", "/health", "/"):
                s = engine.status()
                # Process liveness is reported separately from prediction readiness.
                body = json.dumps({"alive": True, "prediction_ready": s["prediction_ready"], **s},
                                  default=str).encode()
                self.send_response(200)
            elif path == "/checkpoints":
                body = json.dumps(engine.journal.recent(20), default=str).encode()
                self.send_response(200)
            else:
                body = b'{"error":"not found"}'
                self.send_response(404)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):  # noqa: D102
            return

    return Health


def main() -> None:  # pragma: no cover - process entry
    cfg = Config()
    if not cfg.record_url or not cfg.secret:
        raise SystemExit("V2_RECORD_URL and C85_GATEWAY_SECRET are required")
    engine = Engine(cfg)
    sender = Sender(engine)
    threading.Thread(target=HTTPServer(("0.0.0.0", cfg.port), make_health_handler(engine)).serve_forever,
                     daemon=True).start()
    try:
        engine.load_model()
    except Exception as e:  # noqa: BLE001 — stay alive and report; never predict
        engine.err(f"model load failed: {type(e).__name__}")
    engine.check_clock()
    try:
        engine.warm_history()
    except Exception as e:  # noqa: BLE001 — boundary_loop retries the full warmup
        engine.err(f"history warmup failed: {type(e).__name__}")
    engine.reconcile_store()  # recover any intent committed before its journal write
    threading.Thread(target=engine.feed.run_forever, args=(engine.err,), daemon=True).start()
    threading.Thread(target=boundary_loop, args=(engine,), daemon=True).start()
    threading.Thread(target=clock_loop, args=(engine,), daemon=True).start()
    threading.Thread(target=sender.run_forever, daemon=True).start()
    threading.Thread(target=sender.heartbeat_forever, daemon=True).start()
    scheduler_loop(engine)


if __name__ == "__main__":
    main()
