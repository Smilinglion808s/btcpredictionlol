"""V2 Final R1 recording worker (v2-final-r1). Recording only.

Pipeline per 15m candle: Binance spot BTCUSDT 1s/15m klines -> T+8 and T+45
checkpoints -> frozen joblib bundles (Direction8 > Fade8 > Direction45) ->
durable local SQLite journal -> signed outbox delivery to the site's
/api/public/hooks/v2-record.

EXECUTION IS OFF. This module holds no order, exchange-trading or betting
credentials and contains no code path that submits orders. The only outbound
writes are the signed recording endpoint (and, once its contract arrives, the
record-only btc-trader v2-record receiver — see docs/v2-live-handoff.md).

Model equations are NOT implemented here: the frozen package supplies them in
src/model_package/ (see README). Without it the worker reports model_valid=false
and records nothing but heartbeats.
"""
from __future__ import annotations

import hashlib, hmac, json, os, sqlite3, threading, time, traceback, uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import httpx

MODEL_VERSION = "v2-final-r1"
SLEEVES = ("v2-direction8-r1", "v2-fade8-r1", "v2-direction45-r1")
CHECKPOINT_S = {"T8": 8, "T45": 45}
INTERVAL_MS = 900_000
EXECUTION = "OFF"

if os.environ.get("V2_MODE", "record") != "record":
    raise SystemExit("V2_MODE must be 'record'; execution is unconditionally off in this release")

RECORD_URL = os.environ.get("V2_RECORD_URL", "")
SECRET = os.environ.get("C85_GATEWAY_SECRET", "").encode()
WORKER_ID = os.environ.get("V2_WORKER_ID", "v2-worker-1")
DATA_DIR = Path(os.environ.get("V2_DATA_DIR", "/data/v2"))
ARTIFACT_DIR = Path(os.environ.get("V2_ARTIFACT_DIR", str(Path(__file__).resolve().parent.parent / "artifacts")))
BINANCE_REST = os.environ.get("V2_BINANCE_REST", "https://data-api.binance.vision")

STATE: dict = {"errors": [], "features_ready": None, "model_valid": None, "feed_age_ms": None,
               "last_checkpoint": None, "outbox_pending": 0}


def err(msg: str) -> None:
    STATE["errors"] = ([f"{time.strftime('%H:%M:%S', time.gmtime())} {msg}"] + STATE["errors"])[:10]


# -- durable journal + outbox ------------------------------------------------
class Journal:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.lock = threading.Lock()
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS checkpoints(
          candle_open TEXT, checkpoint TEXT, sleeve TEXT, body TEXT NOT NULL,
          created_ms INTEGER NOT NULL, PRIMARY KEY(candle_open, checkpoint, sleeve));
        CREATE TABLE IF NOT EXISTS outbox(
          key TEXT PRIMARY KEY, target TEXT NOT NULL, body TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
          last_status TEXT, updated_ms INTEGER NOT NULL);
        """)

    def record(self, cp: dict) -> bool:
        """Insert-once. Returns False if this checkpoint was already journaled."""
        key = f"{cp['candle_open']}|{cp['checkpoint']}|{cp['sleeve']}"
        body = json.dumps(cp, separators=(",", ":"), allow_nan=False)
        now = int(time.time() * 1000)
        with self.lock:
            try:
                self.db.execute("BEGIN IMMEDIATE")
                self.db.execute("INSERT INTO checkpoints VALUES(?,?,?,?,?)",
                                (cp["candle_open"], cp["checkpoint"], cp["sleeve"], body, now))
                self.db.execute("INSERT INTO outbox(key,target,body,updated_ms) VALUES(?,?,?,?)",
                                (key, "site", body, now))
                self.db.execute("COMMIT")
                return True
            except sqlite3.IntegrityError:
                self.db.execute("ROLLBACK")
                return False

    def pending(self, max_age_ms: int = INTERVAL_MS) -> list[tuple]:
        cutoff = int(time.time() * 1000) - max_age_ms
        with self.lock:
            rows = self.db.execute("SELECT key,target,body FROM outbox WHERE state='PENDING' AND updated_ms>=? ORDER BY updated_ms",
                                   (cutoff,)).fetchall()
            STATE["outbox_pending"] = len(rows)
            return rows

    def mark(self, key: str, state: str, status: str) -> None:
        with self.lock:
            self.db.execute("UPDATE outbox SET state=?,attempts=attempts+1,last_status=?,updated_ms=? WHERE key=?",
                            (state, status[:200], int(time.time() * 1000), key))

    def prune(self, keep_days: int = 7) -> None:
        cutoff = int(time.time() * 1000) - keep_days * 86_400_000
        with self.lock:
            self.db.execute("DELETE FROM outbox WHERE updated_ms<? AND state!='PENDING'", (cutoff,))


# -- signed transport ----------------------------------------------------------
_http = httpx.Client(timeout=4.0)


def signed_post(op: str, **payload) -> httpx.Response:
    body = json.dumps({"op": op, "nonce": uuid.uuid4().hex, "worker_id": WORKER_ID,
                       "model_version": MODEL_VERSION, **payload},
                      separators=(",", ":"), allow_nan=False, default=str)
    ts = str(int(time.time() * 1000))
    sig = hmac.new(SECRET, f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()
    return _http.post(RECORD_URL, content=body,
                      headers={"content-type": "application/json", "x-c85-timestamp": ts, "x-c85-signature": sig})


def deliver(journal: Journal) -> None:
    for key, target, body in journal.pending():
        if target != "site":
            continue
        try:
            r = signed_post("record", checkpoint=json.loads(body))
        except httpx.HTTPError as e:  # transport: stays PENDING, retried with fresh nonce (server idempotent on natural key)
            err(f"deliver transport {type(e).__name__}")
            continue
        if r.is_success:
            journal.mark(key, "DELIVERED", str(r.status_code))
        elif r.status_code >= 500:
            err(f"deliver {r.status_code}")
        else:  # 4xx (e.g. NOT_CURRENT_INTERVAL) is terminal — never retried into a later candle
            journal.mark(key, "REJECTED", f"{r.status_code} {r.text[:120]}")
            err(f"rejected {r.status_code} {r.text[:80]}")


# -- market data ---------------------------------------------------------------
def klines(interval: str, start_ms: int, end_ms: int, limit: int = 1000) -> list[list]:
    r = _http.get(f"{BINANCE_REST}/api/v3/klines",
                  params={"symbol": "BTCUSDT", "interval": interval, "startTime": start_ms, "endTime": end_ms - 1, "limit": limit})
    r.raise_for_status()
    return r.json()


# -- model package --------------------------------------------------------------
def load_model():
    """Import the frozen package. Returns None (model_valid=false) when absent."""
    try:
        from model_package import predictor  # type: ignore  # supplied by the frozen ZIP
        m = predictor.load(ARTIFACT_DIR)
        STATE["model_valid"] = True
        return m
    except Exception as e:  # noqa: BLE001
        STATE["model_valid"] = False
        err(f"model package unavailable: {type(e).__name__}")
        return None


def run_checkpoint(model, journal: Journal, open_ms: int, checkpoint: str) -> None:
    cut = open_ms + CHECKPOINT_S[checkpoint] * 1000
    one_s = klines("1s", open_ms, cut)
    hist = klines("15m", open_ms - 200 * INTERVAL_MS, open_ms)
    feed_last = int(one_s[-1][6]) if one_s else None
    STATE["feed_age_ms"] = (int(time.time() * 1000) - feed_last) if feed_last else None
    # The frozen package owns features, readiness and routing; it must return
    # one dict per sleeve evaluated at this checkpoint.
    outputs = model.evaluate(checkpoint=checkpoint, open_ms=open_ms, one_second=one_s, fifteen_minute=hist)
    for out in outputs:
        if out["sleeve"] not in SLEEVES:
            raise ValueError("unknown sleeve from package")
        ready = bool(out.get("features_ready"))
        STATE["features_ready"] = ready
        side = out.get("side")
        cp = {
            "candle_open": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(open_ms / 1000)),
            "checkpoint": checkpoint, "sleeve": out["sleeve"],
            "side": side if side in (-1, 0, 1) else None,
            "probability": out.get("probability"),
            "eligible": bool(out.get("eligible")) and ready and side in (-1, 1),
            "features_ready": ready, "reason": out.get("reason"),
            "decision_at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + f".{int(time.time()*1000)%1000:03d}Z",
            "payload": {"inputs_hash": out.get("inputs_hash"), "model_hash": out.get("model_hash"), "execution": EXECUTION},
        }
        journal.record(cp)
    STATE["last_checkpoint"] = f"{checkpoint}@{open_ms}"


def scheduler(journal: Journal) -> None:
    model = load_model()
    done: set[str] = set()
    while True:
        now = int(time.time() * 1000)
        open_ms = now - now % INTERVAL_MS
        for name, sec in CHECKPOINT_S.items():
            key = f"{open_ms}:{name}"
            if model and key not in done and now >= open_ms + sec * 1000 + 300 and now < open_ms + INTERVAL_MS:
                done.add(key)
                try:
                    run_checkpoint(model, journal, open_ms, name)
                except Exception as e:  # noqa: BLE001 — skipped checkpoint, never back-filled
                    err(f"{name} skipped: {type(e).__name__}: {str(e)[:80]}")
                    traceback.print_exc()
        deliver(journal)
        if len(done) > 20:
            done = {k for k in done if k.startswith(str(open_ms))}
        time.sleep(0.2)


def heartbeat() -> None:
    while True:
        try:
            signed_post("heartbeat", status={k: STATE[k] for k in STATE})
        except Exception as e:  # noqa: BLE001
            err(f"heartbeat {type(e).__name__}")
        time.sleep(30)


class Health(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        body = json.dumps({"ok": True, "model_version": MODEL_VERSION, "execution": EXECUTION,
                           "model_valid": STATE["model_valid"], "outbox_pending": STATE["outbox_pending"]}).encode()
        self.send_response(200 if self.path == "/healthz" else 404)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


def main() -> None:
    if not RECORD_URL or not SECRET:
        raise SystemExit("V2_RECORD_URL and C85_GATEWAY_SECRET are required")
    journal = Journal(DATA_DIR / "journal.sqlite")
    threading.Thread(target=heartbeat, daemon=True).start()
    threading.Thread(target=scheduler, args=(journal,), daemon=True).start()
    HTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Health).serve_forever()


if __name__ == "__main__":
    main()
