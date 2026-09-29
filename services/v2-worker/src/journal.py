"""Durable checkpoint journal + at-least-once outbox.

Every checkpoint attempt — call, abstention, fail-closed error — is written
here before any network call, so a restart never loses a decision. Transport is
at-least-once: a row may be re-sent after a crash or timeout, and the receiver
deduplicates on the natural key (candle_open, checkpoint, sleeve). A candle can
still only ever produce one intent.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path

INTERVAL_MS = 900_000


class Journal:
    def __init__(self, path: Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None, timeout=30)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.lock = threading.Lock()
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS checkpoints(
          candle_open TEXT, checkpoint TEXT, sleeve TEXT, body TEXT NOT NULL,
          created_ms INTEGER NOT NULL, PRIMARY KEY(candle_open, checkpoint, sleeve));
        CREATE TABLE IF NOT EXISTS outbox(
          key TEXT PRIMARY KEY, body TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'PENDING',
          attempts INTEGER NOT NULL DEFAULT 0, last_status TEXT, created_ms INTEGER NOT NULL,
          updated_ms INTEGER NOT NULL);
        """)

    # -- writes ---------------------------------------------------------------
    def record(self, cp: dict) -> bool:
        """Insert-once; False when this checkpoint was already journaled."""
        key = f"{cp['candle_open']}|{cp['checkpoint']}|{cp['sleeve']}"
        body = json.dumps(cp, separators=(",", ":"), allow_nan=False)
        now = int(time.time() * 1000)
        with self.lock:
            try:
                self.db.execute("BEGIN IMMEDIATE")
                self.db.execute("INSERT INTO checkpoints VALUES(?,?,?,?,?)",
                                (cp["candle_open"], cp["checkpoint"], cp["sleeve"], body, now))
                self.db.execute("INSERT INTO outbox(key,body,created_ms,updated_ms) VALUES(?,?,?,?)",
                                (key, body, now, now))
                self.db.execute("COMMIT")
                return True
            except sqlite3.IntegrityError:
                self.db.execute("ROLLBACK")
                return False

    def mark(self, key: str, state: str, status: str) -> None:
        with self.lock:
            self.db.execute("UPDATE outbox SET state=?,attempts=attempts+1,last_status=?,updated_ms=? WHERE key=?",
                            (state, str(status)[:200], int(time.time() * 1000), key))

    def has_pending(self, candle_open: str, checkpoint: str) -> bool:
        """True while a checkpoint of this candle is still waiting to be delivered."""
        with self.lock:
            row = self.db.execute("SELECT COUNT(*) FROM outbox WHERE state='PENDING' AND key LIKE ?",
                                  (f"{candle_open}|{checkpoint}|%",)).fetchone()
        return bool(row[0])

    # -- reads ----------------------------------------------------------------

    def pending(self, max_age_ms: int = INTERVAL_MS) -> list[tuple[str, dict]]:
        """Undelivered rows still inside their own candle. Stale rows expire, never replay."""
        cutoff = int(time.time() * 1000) - max_age_ms
        with self.lock:
            rows = self.db.execute(
                "SELECT key,body FROM outbox WHERE state='PENDING' AND created_ms>=? ORDER BY created_ms", (cutoff,)
            ).fetchall()
        return [(k, json.loads(b)) for k, b in rows]

    def pending_count(self) -> int:
        with self.lock:
            return int(self.db.execute("SELECT COUNT(*) FROM outbox WHERE state='PENDING'").fetchone()[0])

    def expire_stale(self, max_age_ms: int = INTERVAL_MS) -> int:
        cutoff = int(time.time() * 1000) - max_age_ms
        with self.lock:
            cur = self.db.execute(
                "UPDATE outbox SET state='EXPIRED',updated_ms=? WHERE state='PENDING' AND created_ms<?",
                (int(time.time() * 1000), cutoff))
            return cur.rowcount or 0

    def recent(self, limit: int = 20) -> list[dict]:
        with self.lock:
            rows = self.db.execute("SELECT body FROM checkpoints ORDER BY created_ms DESC LIMIT ?", (limit,)).fetchall()
        return [json.loads(r[0]) for r in rows]

    def prune(self, keep_days: int = 30) -> None:
        cutoff = int(time.time() * 1000) - keep_days * 86_400_000
        with self.lock:
            self.db.execute("DELETE FROM outbox WHERE updated_ms<? AND state!='PENDING'", (cutoff,))
            self.db.execute("DELETE FROM checkpoints WHERE created_ms<?", (cutoff,))

    def close(self) -> None:
        self.db.close()
