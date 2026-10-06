"""V3 PF-E008 runtime core: durable state, history, daily fits, decisions, outbox.

Pure of network I/O: every clock and data source is injected so the same code
paths run in production and in tests. The frozen math lives only in
package/model.py and is imported, never re-implemented.

Rules (INTEGRATION.md):
  * A head's confidence history advances exactly once per candle with valid
    features, in candle order, ranked against strictly earlier values first,
    including when the other head already qualified.
  * T15 rank >= .70 freezes direction; otherwise T30 may qualify. No T45, no
    second signal. A T15 that was never validly attempted (outage, late, missing
    seconds) fails the candle closed; it is not treated as "below threshold".
  * Daily UTC fit from prior 8640 scheduled slots, closed OKX labels only.
  * At T48 the exact body is persisted once; retries reuse the same bytes; hard
    expiry at T49. Delivery is OFF unless explicitly enabled.
"""
from __future__ import annotations

import gzip
import hashlib
import hmac
import json
import math
import sqlite3
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
PACKAGE = ROOT / "package"
sys.path.insert(0, str(PACKAGE))
import model as M  # noqa: E402  frozen reference, byte-identical to the handoff

MODEL_VERSION = M.MODEL_VERSION
SCHEMA_VERSION = "v3-signal/1"          # legacy t48-r1 body (unchanged bytes)
SCHEMA_VERSION_ASAP = "v3-signal/2"     # asap-r1 body
DELIVERY_POLICIES = ("t48-r1", "asap-r1")
DEFAULT_DELIVERY_POLICY = "t48-r1"
LEG = "V3"
SLOT = 900
DAY = 86400
WINDOW_SLOTS = 8640
CHECKPOINTS = (15, 30)
GRACE_MS = 1000           # operational tolerance after T15/T30, logged separately
ENTRY_MS, EXPIRY_MS = 48_000, 49_000
RANK_GATE = 0.70
# Feature failures that are data facts (research missingness): the other head may still qualify.
DATA_INVALID = {"zero_quote_volume", "invalid_price", "invalid_ohlc", "invalid_quote_volume", "nonfinite_bar"}
# Never allowed as a V3 destination (V1.2 receivers, V2 receiver).
FORBIDDEN_URL_PARTS = ("/functions/v1/v12-", "v2-bet-signal", "/place-trade", "/api/public/hooks/v12-", "/api/public/hooks/v2-")
ET = ZoneInfo("America/New_York")


class FailClosed(Exception):
    pass


# ----------------------------------------------------------------- identities
def iso_ms(ms: int) -> str:
    """Same text as JS Date.toISOString() (used by the shared interval key)."""
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{ms % 1000:03d}Z"


def kalshi_ticker(candle_s: int) -> str:
    """KXBTC15M-<YY><MON><DD><HHMM>-<MM> of the candle CLOSE in New York time."""
    t = datetime.fromtimestamp(candle_s + SLOT, tz=timezone.utc).astimezone(ET)
    return f"KXBTC15M-{t:%y}{t.strftime('%b').upper()}{t:%d%H%M}-{t:%M}"


def interval_key(candle_s: int, ticker: str | None = None) -> str:
    """Byte-for-byte the repository's intervalKey(ticker, open). Outbound bodies pass the VERIFIED ticker."""
    return f"v12:{ticker or kalshi_ticker(candle_s)}:{iso_ms(candle_s * 1000)}"


KALSHI_SERIES = "KXBTC15M"


def sign(secret: bytes, raw: bytes) -> str:
    return "sha256=" + hmac.new(secret, raw, hashlib.sha256).hexdigest()


def url_allowed(url: str) -> bool:
    return url.startswith("https://") and not any(p in url for p in FORBIDDEN_URL_PARTS)


def verify_package(package: Path = PACKAGE) -> dict:
    try:
        manifest = json.loads((package / "SHA256.json").read_text())
        if not isinstance(manifest, dict) or not manifest:
            raise ValueError("empty")
    except Exception as e:  # noqa: BLE001 - missing/malformed manifest fails closed, never crashes
        raise FailClosed("PACKAGE_MANIFEST_INVALID") from e
    for name, digest in manifest.items():
        try:
            got = hashlib.sha256((package / name).read_bytes()).hexdigest()
        except OSError as e:
            raise FailClosed(f"PACKAGE_FILE_MISSING:{name}") from e
        if got != digest:
            raise FailClosed(f"PACKAGE_HASH_MISMATCH:{name}")
    return manifest


def feature_row(values: dict, checkpoint: int) -> list[float]:
    out = []
    for name in M.FEATURES[checkpoint]:
        v = values.get(name)
        out.append(float("nan") if v is None else float(v))
    return out


def predict_exact(head: dict, x: list[float], candle_s: int) -> float:
    """Frozen M.predict on a 96-row batch (one research day), row 0.

    numpy's matmul result for a single row can differ by 1 ULP from the batched
    path the research used; batches of >=4 identical rows reproduce the replay
    fixture bit-for-bit (tests/test_v3.py::Parity).
    """
    import numpy as np
    return float(M.predict(head, np.tile(np.asarray(x, dtype=float), (96, 1)), candle_s)[0])


def finite(xs) -> bool:
    return all(math.isfinite(v) for v in xs)


# ---------------------------------------------------------------------- store
SCHEMA = """
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rows(candle_s INTEGER PRIMARY KEY, feats TEXT NOT NULL DEFAULT '{}',
  s15 TEXT NOT NULL DEFAULT 'pending', s30 TEXT NOT NULL DEFAULT 'pending', label INTEGER, src TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS heads(checkpoint INTEGER, day_s INTEGER, body TEXT NOT NULL, source TEXT NOT NULL,
  PRIMARY KEY(checkpoint, day_s));
CREATE TABLE IF NOT EXISTS hist(checkpoint INTEGER, candle_s INTEGER, probability REAL, confidence REAL NOT NULL,
  rank REAL, fit_day_s INTEGER, PRIMARY KEY(checkpoint, candle_s));
CREATE TABLE IF NOT EXISTS decisions(candle_s INTEGER PRIMARY KEY, status TEXT NOT NULL, reason TEXT,
  checkpoint INTEGER, direction INTEGER, rank REAL, decision_ms INTEGER, fit_version TEXT,
  audit TEXT NOT NULL DEFAULT '{}', updated_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS outbox(event_id TEXT PRIMARY KEY, candle_s INTEGER UNIQUE NOT NULL, body BLOB NOT NULL,
  status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, prepared_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL, delivered_ms INTEGER);
CREATE TABLE IF NOT EXISTS markets(candle_s INTEGER PRIMARY KEY, ticker TEXT NOT NULL, series TEXT NOT NULL,
  close_ms INTEGER NOT NULL, fetched_ms INTEGER NOT NULL);
"""


class Store:
    def __init__(self, path: str | Path) -> None:
        self.db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript(SCHEMA)
        self.lock = threading.RLock()
        self.depth = 0  # re-entrant transaction depth (same thread, guarded by lock)

    def q(self, sql: str, args=()):
        with self.lock:
            return self.db.execute(sql, args).fetchall()

    def tx(self):
        return _Tx(self)

    def meta(self, k: str, default=None):
        r = self.q("SELECT v FROM meta WHERE k=?", (k,))
        return json.loads(r[0][0]) if r else default

    def set_meta(self, k: str, v) -> None:
        self.q("INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, json.dumps(v)))


class _Tx:
    def __init__(self, s: Store) -> None:
        self.s = s

    """Re-entrant: nested tx() joins the outer transaction; only the outermost commits/rolls back.
    Holding it serialises compound state transitions across threads, not just single statements."""

    def __enter__(self):
        self.s.lock.acquire()
        try:
            if self.s.depth == 0:
                self.s.db.execute("BEGIN IMMEDIATE")
            self.s.depth += 1
        except BaseException:
            self.s.lock.release()
            raise
        return self.s.db

    def __exit__(self, et, ev, tb):
        try:
            self.s.depth -= 1
            if self.s.depth == 0:
                self.s.db.execute("ROLLBACK" if et else "COMMIT")
        finally:
            self.s.lock.release()
        return False


# --------------------------------------------------------------------- engine
class Engine:
    def __init__(self, store: Store, now_ms=None, delivery_enabled: bool = False, mode: str = "shadow",
                 delivery_policy: str = DEFAULT_DELIVERY_POLICY) -> None:
        if delivery_policy not in DELIVERY_POLICIES:
            raise FailClosed(f"UNKNOWN_DELIVERY_POLICY:{delivery_policy}")
        self.delivery_policy = delivery_policy
        import time
        self.s = store
        self.now_ms = now_ms or (lambda: int(time.time() * 1000))
        self.delivery_enabled = bool(delivery_enabled)
        self.mode = mode if mode in ("shadow", "live") else "shadow"
        self.faults: dict[str, str] = {}

    # ---------------------------------------------------------------- seeding
    def load_seed(self, seed_path: Path = PACKAGE / "seed.json.gz") -> None:
        """Idempotent. Seed rows keep explicit missingness; nothing is filled."""
        digest = hashlib.sha256(seed_path.read_bytes()).hexdigest()
        loaded = self.s.meta("seed_sha256")
        if loaded is not None:
            if loaded != digest:
                raise FailClosed("SEED_CHANGED_AFTER_LOAD")
            return
        try:
            seed = json.loads(gzip.decompress(seed_path.read_bytes()))
        except Exception as e:  # noqa: BLE001
            raise FailClosed("SEED_CORRUPT") from e
        end = int(seed["through_exclusive_s"])
        if seed.get("model_version") != MODEL_VERSION or end % DAY:
            raise FailClosed("SEED_IDENTITY")
        names = M.FEATURES[30]
        with self.s.tx() as db:
            for r in seed["rows"]:
                c = int(r["candle_s"])
                if c % SLOT or c >= end:
                    raise FailClosed("SEED_ROW_OUT_OF_RANGE")
                feats = {n: r.get(n) for n in names}
                st = {cp: "valid" if finite(feature_row(feats, cp)) else "invalid:seed_missing" for cp in CHECKPOINTS}
                db.execute("INSERT INTO rows(candle_s,feats,s15,s30,label,src) VALUES(?,?,?,?,?,'seed')",
                           (c, json.dumps(feats), st[15], st[30], r.get("label")))
            for cp in CHECKPOINTS:
                head = seed["heads"][str(cp)]
                if head["valid_from_s"] != end or head["checkpoint"] != cp:
                    raise FailClosed("SEED_HEAD_MISMATCH")
                db.execute("INSERT INTO heads VALUES(?,?,?,?)", (cp, end, json.dumps(head), "seed"))
                hist = seed["rank_histories"][str(cp)]
                if len(hist) != 768 or hist[-1]["candle_s"] >= end:
                    raise FailClosed("SEED_HISTORY_MISMATCH")
                for h in hist:
                    db.execute("INSERT INTO hist(checkpoint,candle_s,confidence,fit_day_s) VALUES(?,?,?,?)",
                               (cp, h["candle_s"], h["confidence"], h.get("fit_day_s")))
            for k, v in (("seed_sha256", digest), ("seed_end_s", end), ("hist_wm_15", end - SLOT),
                         ("hist_wm_30", end - SLOT), ("label_wm", end - SLOT)):
                db.execute("INSERT INTO meta(k,v) VALUES(?,?)", (k, json.dumps(v)))

    @property
    def seed_end(self) -> int:
        v = self.s.meta("seed_end_s")
        if v is None:
            raise FailClosed("SEED_NOT_LOADED")
        return int(v)

    # ------------------------------------------------------------------ heads
    def head(self, cp: int, day_s: int) -> dict | None:
        r = self.s.q("SELECT body FROM heads WHERE checkpoint=? AND day_s=?", (cp, day_s))
        return json.loads(r[0][0]) if r else None

    @staticmethod
    def fit_version(head: dict) -> str:
        day = datetime.fromtimestamp(head["valid_from_s"], tz=timezone.utc).strftime("%Y-%m-%d")
        h = hashlib.sha256(json.dumps(head, sort_keys=True).encode()).hexdigest()[:12]
        return f"{MODEL_VERSION}:t{head['checkpoint']}:{day}:{h}"

    def labels_complete_through(self, last_candle_s: int) -> bool:
        """Every scheduled post-seed slot up to last_candle_s has a confirmed OKX label AND a terminal
        feature status for BOTH heads ('valid' or finalised 'invalid:*'). 'pending' is never missingness."""
        lo = self.seed_end
        if last_candle_s < lo:
            return True
        need = (last_candle_s - lo) // SLOT + 1
        got = self.s.q("SELECT COUNT(*) FROM rows WHERE candle_s BETWEEN ? AND ? AND label IS NOT NULL "
                       "AND s15<>'pending' AND s30<>'pending'", (lo, last_candle_s))[0][0]
        return got == need

    def ensure_fit(self, day_s: int) -> bool:
        """Fit both heads for UTC day_s if every input closed before day_s is terminal. Cutoff = day_s only
        (never the live clock). Both heads are fitted outside locks, then persisted in ONE transaction."""
        if all(self.head(cp, day_s) for cp in CHECKPOINTS):
            return True
        if not self.labels_complete_through(day_s - SLOT):
            return False
        lo = day_s - WINDOW_SLOTS * SLOT
        rows = self.s.q("SELECT candle_s,feats,label FROM rows WHERE candle_s>=? AND candle_s<? "
                        "ORDER BY candle_s", (lo, day_s))
        stamps = [r[0] for r in rows]
        labels = [0 if r[2] is None else r[2] for r in rows]
        new = {}
        for cp in CHECKPOINTS:
            if self.head(cp, day_s):
                continue
            x = [feature_row(json.loads(r[1]), cp) for r in rows]
            head = M.fit_head(stamps, x, labels, day_s, cp)
            head["fit_cutoff_s"] = day_s
            head["training_source"] = "seed+binance_spot_1s_rest/ws+okx_15m_confirmed"
            new[cp] = head
        with self.s.tx() as db:
            for cp, head in new.items():
                db.execute("INSERT OR IGNORE INTO heads VALUES(?,?,?,?)", (cp, day_s, json.dumps(head), "refit"))
        return True

    def first_unfitted_day(self) -> int:
        """Earliest UTC day (after the seed) where EITHER head is missing; partial days are retried."""
        have: dict[int, int] = {}
        for (d,) in self.s.q("SELECT day_s FROM heads"):
            have[d] = have.get(d, 0) + 1
        day = self.seed_end
        while have.get(day, 0) >= len(CHECKPOINTS):
            day += DAY
        return day

    # ---------------------------------------------------------------- history
    def advance_history(self, cp: int, upto_candle_s: int | None = None) -> int:
        """Score pending rows in candle order with each day's own fit; stop at the first gap."""
        n = 0
        wm_key = f"hist_wm_{cp}"
        while True:
            # One row per transaction: watermark read, scoring and append are a single serialised step,
            # so concurrent callers (catch-up vs live) can never score the same row twice.
            with self.s.tx() as db:
                wm = int(self.s.meta(wm_key))
                c = wm + SLOT
                if upto_candle_s is not None and c > upto_candle_s:
                    return n
                r = self.s.q(f"SELECT feats,s{cp} FROM rows WHERE candle_s=?", (c,))
                if not r or r[0][1] == "pending":
                    return n
                if r[0][1] == "valid":
                    head = self.head(cp, c - c % DAY)
                    if head is None:
                        return n
                    x = feature_row(json.loads(r[0][0]), cp)
                    p = predict_exact(head, x, c)
                    prior = [v for (v,) in self.s.q(
                        "SELECT confidence FROM hist WHERE checkpoint=? AND candle_s<? ORDER BY candle_s DESC LIMIT 768",
                        (cp, c))][::-1]
                    rank = M.rank_before_append(p, prior)
                    db.execute("INSERT INTO hist VALUES(?,?,?,?,?,?)", (cp, c, p, abs(p - .5), rank, head["valid_from_s"]))
                db.execute("UPDATE meta SET v=? WHERE k=?", (json.dumps(c), wm_key))
            n += 1

    def hist_entry(self, cp: int, c: int) -> dict | None:
        r = self.s.q("SELECT probability,rank,fit_day_s FROM hist WHERE checkpoint=? AND candle_s=?", (cp, c))
        return {"probability": r[0][0], "rank": r[0][1], "fit_day_s": r[0][2]} if r else None

    # ------------------------------------------------------------- live path
    def readiness(self, c: int, cp: int, feed_ok: bool, clock_ok: bool) -> str | None:
        if self.faults.get("package"):
            return "PACKAGE_INVALID"
        if not clock_ok:
            return "CLOCK_SKEW"
        if not feed_ok:
            return "FEED_STALE"
        if self.head(cp, c - c % DAY) is None:
            return "FIT_EXPIRED"
        wm = self.s.meta(f"hist_wm_{cp}")
        if wm is None:
            return "PACKAGE_INVALID"
        if int(wm) != c - SLOT:
            return "CATCHUP_GAP"
        return None

    def _decision(self, c: int):
        r = self.s.q("SELECT status,checkpoint,direction FROM decisions WHERE candle_s=?", (c,))
        return r[0] if r else None

    def _set_decision(self, c: int, status: str, reason=None, cp=None, direction=None, rank=None,
                      decision_ms=None, fit_version=None, audit=None) -> None:
        self.s.q("INSERT INTO decisions(candle_s,status,reason,checkpoint,direction,rank,decision_ms,fit_version,audit,updated_ms) "
                 "VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(candle_s) DO UPDATE SET status=excluded.status,"
                 "reason=excluded.reason,checkpoint=excluded.checkpoint,direction=excluded.direction,rank=excluded.rank,"
                 "decision_ms=excluded.decision_ms,fit_version=excluded.fit_version,"
                 "audit=json_patch(decisions.audit, excluded.audit),updated_ms=excluded.updated_ms",
                 (c, status, reason, cp, direction, rank, decision_ms, fit_version, json.dumps(audit or {}), self.now_ms()))

    def _audit(self, c: int, patch: dict) -> None:
        self.s.q("UPDATE decisions SET audit=json_patch(audit,?), updated_ms=? WHERE candle_s=?",
                 (json.dumps(patch), self.now_ms(), c))

    def checkpoint(self, c: int, cp: int, bars: list[dict], feed_ok: bool = True, clock_ok: bool = True) -> dict:
        """Score head cp for candle c exactly once. bars = final 1s bars received before the deadline."""
        # Whole transition (row -> history -> decision) is one serialised transaction: catch-up cannot
        # consume the live row in between, and a crash leaves either everything or nothing.
        with self.s.tx():
            return self._checkpoint(c, cp, bars, feed_ok, clock_ok)

    def _checkpoint(self, c: int, cp: int, bars: list[dict], feed_ok: bool, clock_ok: bool) -> dict:
        now = self.now_ms()
        start, deadline = (c + cp) * 1000, (c + cp) * 1000 + GRACE_MS
        prior = self._decision(c)
        selectable = (cp == 15 and prior is None) or (cp == 30 and prior is not None and prior[0] == "AWAIT_T30")
        if cp == 30 and prior is None:
            self._set_decision(c, "FAIL_CLOSED", "T15_NOT_ATTEMPTED")
            selectable = False
        if self.hist_entry(cp, c) is not None:
            return {"status": "DUPLICATE"}
        reason = None
        if now < start or now >= deadline:
            reason = "CHECKPOINT_LATE" if now >= deadline else "CHECKPOINT_EARLY"
        reason = reason or self.readiness(c, cp, feed_ok, clock_ok)
        feats = None
        if reason is None:
            try:
                feats = M.prefix_features(bars, cp, c * 1000)
            except ValueError as e:
                reason = ("DATA_INVALID:" if str(e) in DATA_INVALID else "MISSING_SECONDS:") + str(e)
        result = None
        if feats is not None:
            row = self.s.q("SELECT feats FROM rows WHERE candle_s=?", (c,))
            merged = json.loads(row[0][0]) if row else {}
            merged.update(dict(zip(M.FEATURES[cp], feats)))
            self.s.q(f"INSERT INTO rows(candle_s,feats,src,s{cp}) VALUES(?,?,'live','valid') "
                     f"ON CONFLICT(candle_s) DO UPDATE SET feats=excluded.feats, s{cp}='valid'", (c, json.dumps(merged)))
            self.advance_history(cp, c)
            result = self.hist_entry(cp, c)
        elif reason and reason.startswith("DATA_INVALID"):
            self.s.q(f"INSERT INTO rows(candle_s,src,s{cp}) VALUES(?,'live',?) "
                     f"ON CONFLICT(candle_s) DO UPDATE SET s{cp}=excluded.s{cp}", (c, "invalid:" + reason[13:]))
            self.advance_history(cp, c)
        audit = {f"t{cp}": {"reason": reason, "at_ms": now, "late_grace_used": now >= start + 1000 - GRACE_MS and now < deadline,
                            "probability": result and result["probability"], "rank": result and result["rank"]}}
        if not selectable:
            self._audit(c, audit)
            return {"status": "HISTORY_ONLY", "reason": reason, **(result or {})}
        data_invalid = reason is not None and reason.startswith("DATA_INVALID")
        if reason is not None and not data_invalid:
            self._set_decision(c, "FAIL_CLOSED", f"T{cp}_{reason}", audit=audit)
            return {"status": "FAIL_CLOSED", "reason": reason}
        t = None if result is None else {"probability": result["probability"], "rank": result["rank"]}
        sel = M.select(t, None) if cp == 15 else M.select(None, t)
        if sel:
            head = self.head(cp, c - c % DAY)
            self._set_decision(c, "SELECTED", None, cp, sel["direction"], result["rank"], now, self.fit_version(head), audit)
            return {"status": "SELECTED", **sel}
        self._set_decision(c, "AWAIT_T30" if cp == 15 else "NO_CALL", reason, audit=audit)
        return {"status": "AWAIT_T30" if cp == 15 else "NO_CALL"}

    # ------------------------------------------------------------- catch-up
    def missing_feature_candles(self, closed_before_s: int, limit: int = 200) -> list[int]:
        """Closed candles after the seed with no row or a pending head (oldest first)."""
        out, c = [], self.seed_end
        have = {r[0]: (r[1], r[2]) for r in self.s.q(
            "SELECT candle_s,s15,s30 FROM rows WHERE candle_s>=?", (self.seed_end,))}
        while c + SLOT <= closed_before_s and len(out) < limit:
            st = have.get(c)
            if st is None or "pending" in st:
                out.append(c)
            c += SLOT
        return out

    def apply_backfill(self, c: int, bars: list[dict], final: bool) -> None:
        """REST 1s bars for a closed candle. Missing seconds become invalid only once data is final."""
        row = self.s.q("SELECT feats,s15,s30 FROM rows WHERE candle_s=?", (c,))
        feats = json.loads(row[0][0]) if row else {}
        states = {15: row[0][1] if row else "pending", 30: row[0][2] if row else "pending"}
        for cp in CHECKPOINTS:
            if states[cp] != "pending":
                continue
            prefix = [b for b in bars if c * 1000 <= b["open_ms"] < (c + cp) * 1000]
            try:
                vals = M.prefix_features(prefix, cp, c * 1000)
                for k, v in zip(M.FEATURES[cp], vals):
                    feats.setdefault(k, v)
                states[cp] = "valid"
            except ValueError as e:
                if str(e) in DATA_INVALID or final:
                    states[cp] = "invalid:" + str(e)
        self.s.q("INSERT INTO rows(candle_s,feats,s15,s30,src) VALUES(?,?,?,?,'rest') ON CONFLICT(candle_s) DO UPDATE SET "
                 "feats=excluded.feats,s15=excluded.s15,s30=excluded.s30", (c, json.dumps(feats), states[15], states[30]))

    def apply_labels(self, labels: dict[int, int]) -> None:
        for c, lab in labels.items():
            if lab not in (-1, 0, 1) or c < self.seed_end:
                continue
            self.s.q("INSERT INTO rows(candle_s,label,src) VALUES(?,?,'okx') ON CONFLICT(candle_s) DO UPDATE "
                     "SET label=COALESCE(rows.label, excluded.label)", (c, lab))

    def catchup_step(self, now_s: int) -> dict:
        """Fits and history in order; call after feeding backfill/labels. Off the scoring thread."""
        today = now_s - now_s % DAY
        day = self.first_unfitted_day()
        fitted = []
        while day <= today:
            for cp in CHECKPOINTS:
                self.advance_history(cp, day - SLOT)
            try:
                if not self.ensure_fit(day):
                    break
            except ValueError as e:
                self.faults["fit"] = f"{iso_ms(day * 1000)[:10]}:{e}"
                break
            self.faults.pop("fit", None)
            fitted.append(day)
            day += DAY
        moved = {cp: self.advance_history(cp) for cp in CHECKPOINTS}
        return {"fitted": fitted, "history": moved}

    # ---------------------------------------------------------------- markets
    def record_markets(self, markets: list[dict], series: str) -> int:
        """Store public Kalshi metadata fetched OFF the scoring thread. A market is accepted only when the
        series is KXBTC15M, its close is a 15m boundary, and its ticker is the one for that close. This is
        market identity only; it never filters on price and never affects model selection."""
        n = 0
        if series != KALSHI_SERIES:
            return 0
        for m in markets:
            try:
                ticker = str(m["ticker"])
                close_ms = int(datetime.fromisoformat(str(m["close_time"]).replace("Z", "+00:00")).timestamp() * 1000)
            except Exception:  # noqa: BLE001
                continue
            ev = str(m.get("event_ticker") or "")
            if close_ms % (SLOT * 1000) or not ticker.startswith(KALSHI_SERIES + "-") or \
                    (ev and not ev.startswith(KALSHI_SERIES + "-")):
                continue
            c = close_ms // 1000 - SLOT
            if ticker != kalshi_ticker(c):
                self.faults["market"] = f"TICKER_MISMATCH:{ticker}"
                continue
            self.s.q("INSERT INTO markets VALUES(?,?,?,?,?) ON CONFLICT(candle_s) DO NOTHING",
                     (c, ticker, series, close_ms, self.now_ms()))
            n += 1
        return n

    def verified_market(self, c: int) -> str | None:
        r = self.s.q("SELECT ticker FROM markets WHERE candle_s=? AND series=? AND close_ms=?",
                     (c, KALSHI_SERIES, (c + SLOT) * 1000))
        return r[0][0] if r else None

    # ----------------------------------------------------------------- outbox
    def body_for(self, c: int, prepared_ms: int, ticker: str) -> bytes:
        d = self.s.q("SELECT checkpoint,direction,rank,decision_ms,fit_version FROM decisions WHERE candle_s=?", (c,))[0]
        key = interval_key(c, ticker)
        asap = self.delivery_policy == "asap-r1"
        entry_ms = d[3] if asap else c * 1000 + ENTRY_MS
        body = {
            "schema_version": SCHEMA_VERSION_ASAP if asap else SCHEMA_VERSION, "model_version": MODEL_VERSION, "leg": LEG,
            "event_id": f"{key}:{LEG}", "interval_key": key, "market": ticker,
            "prediction": "YES" if d[1] == 1 else "NO",
            "candle_starts_at": iso_ms(c * 1000), "decision_at": iso_ms(d[3]), "checkpoint_seconds": d[0],
            "entry_at": iso_ms(entry_ms), "expires_at": iso_ms(c * 1000 + EXPIRY_MS),
            "sent_at": iso_ms(prepared_ms), "confidence_rank": d[2], "fit_version": d[4], "mode": self.mode,
        }
        if asap:
            body["delivery_policy"] = "asap-r1"
        return json.dumps(body, separators=(",", ":"), allow_nan=False).encode()

    def prepare_due(self) -> list[str]:
        """Persist the exact body once when eligible: t48-r1 at T48; asap-r1 as soon as the selection
        is stored (entry_at = decision_at). Past T49 a selection is expired, never sent late."""
        now, out = self.now_ms(), []
        for (c, dms) in self.s.q("SELECT d.candle_s,d.decision_ms FROM decisions d LEFT JOIN outbox o ON o.candle_s=d.candle_s "
                                 "WHERE d.status='SELECTED' AND o.event_id IS NULL"):
            expiry = c * 1000 + EXPIRY_MS
            entry = dms if self.delivery_policy == "asap-r1" and dms is not None else c * 1000 + ENTRY_MS
            ticker = self.verified_market(c)
            if now >= expiry:
                self._set_decision_status(c, "EXPIRED_UNSENT")
                if ticker is None:
                    self._audit(c, {"no_send": "NO_VERIFIED_MARKET"})
            elif now >= entry and ticker is None:
                continue  # explicit no-send until a verified market exists; never invent a ticker
            elif now >= entry:
                raw = self.body_for(c, now, ticker)
                eid = json.loads(raw)["event_id"]
                status = "PENDING" if self.delivery_enabled else "DISABLED"
                self.s.q("INSERT OR IGNORE INTO outbox(event_id,candle_s,body,status,prepared_ms,expires_ms) VALUES(?,?,?,?,?,?)",
                         (eid, c, raw, status, now, expiry))
                out.append(eid)
        self.s.q("UPDATE outbox SET status='EXPIRED' WHERE status IN ('PENDING','RETRY') AND expires_ms<=?", (now,))
        return out

    def _set_decision_status(self, c: int, status: str) -> None:
        self.s.q("UPDATE decisions SET status=?, updated_ms=? WHERE candle_s=?", (status, self.now_ms(), c))

    def deliverable(self) -> list[tuple[str, bytes]]:
        if not self.delivery_enabled:
            return []
        return [(e, bytes(b)) for e, b in self.s.q(
            "SELECT event_id,body FROM outbox WHERE status IN ('PENDING','RETRY') AND expires_ms>? ORDER BY candle_s",
            (self.now_ms(),))]

    def expires_ms(self, event_id: str) -> int | None:
        r = self.s.q("SELECT expires_ms FROM outbox WHERE event_id=?", (event_id,))
        return r[0][0] if r else None

    def record_attempt(self, event_id: str, status_code: int | None, error: str | None) -> str:
        if error == "EXPIRED_BEFORE_SEND":
            self.s.q("UPDATE outbox SET status='EXPIRED', last_error=? WHERE event_id=? AND status IN ('PENDING','RETRY')",
                     (error, event_id))
            return "EXPIRED"
        if status_code is not None and 200 <= status_code < 300:
            st = "DELIVERED"
        elif status_code is not None and 400 <= status_code < 500 and status_code not in (408, 429):
            st = "REJECTED"
        else:
            st = "RETRY"
        self.s.q("UPDATE outbox SET status=?, attempts=attempts+1, last_error=?, delivered_ms=? WHERE event_id=? "
                 "AND status IN ('PENDING','RETRY')",
                 (st, error or (None if st == "DELIVERED" else f"HTTP_{status_code}"),
                  self.now_ms() if st == "DELIVERED" else None, event_id))
        return st

    # ----------------------------------------------------------------- status
    def status(self) -> dict:
        now = self.now_ms()
        c = (now // 1000) - (now // 1000) % SLOT
        heads = {cp: self.head(cp, c - c % DAY) is not None for cp in CHECKPOINTS}
        raw_wm = {cp: self.s.meta(f"hist_wm_{cp}") for cp in CHECKPOINTS}
        if any(v is None for v in raw_wm.values()):  # uninitialised / invalid seed: report, never crash
            return {"model_version": MODEL_VERSION, "fit_today": heads, "latest_fit_day": None,
                    "history_watermark": None, "caught_up": False, "faults": dict(self.faults),
                    "delivery_enabled": self.delivery_enabled, "delivery_policy": self.delivery_policy,
                    "mode": self.mode, "outbox": {},
                    "recent_decisions": []}
        wms = {cp: int(v) for cp, v in raw_wm.items()}
        latest = self.s.q("SELECT MAX(day_s) FROM heads")[0][0]
        counts = dict(self.s.q("SELECT status,COUNT(*) FROM outbox GROUP BY status"))
        last = self.s.q("SELECT candle_s,status,reason,checkpoint,direction FROM decisions ORDER BY candle_s DESC LIMIT 5")
        return {"model_version": MODEL_VERSION, "fit_today": heads, "latest_fit_day": iso_ms(latest * 1000) if latest else None,
                "history_watermark": {cp: iso_ms(w * 1000) for cp, w in wms.items()},
                "caught_up": all(w >= c - SLOT for w in wms.values()), "faults": dict(self.faults),
                "delivery_enabled": self.delivery_enabled, "delivery_policy": self.delivery_policy,
                "mode": self.mode, "outbox": counts,
                "recent_decisions": [dict(zip(("candle", "status", "reason", "checkpoint", "direction"),
                                              (iso_ms(r[0] * 1000),) + tuple(r[1:]))) for r in last]}
