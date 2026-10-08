"""Fair, durable retries for official Kalshi outcomes; never invent a label."""
from __future__ import annotations

import json
from datetime import datetime

import httpx

from v3core import kalshi_ticker

SCHEMA = """
CREATE TABLE IF NOT EXISTS settlement_retries(
 consumer TEXT NOT NULL, candle_s INTEGER NOT NULL, attempts INTEGER NOT NULL,
 next_retry_s REAL NOT NULL, last_attempt_s REAL NOT NULL, reason TEXT NOT NULL,
 PRIMARY KEY(consumer,candle_s));
"""
BASE_DELAY = 60
MAX_DELAY = 3600
BATCH_SIZE = 20


class SettlementUnavailable(ValueError):
    pass


def official_outcome(market, candle_s, now_s):
    if not isinstance(market, dict) or market.get("ticker") != kalshi_ticker(candle_s):
        raise SettlementUnavailable("SETTLEMENT_IDENTITY")
    if market.get("status") != "finalized" or market.get("result") not in ("yes", "no"):
        raise SettlementUnavailable("SETTLEMENT_NOT_FINAL")
    raw = market.get("settlement_ts")
    if not isinstance(raw, str):
        raise SettlementUnavailable("SETTLEMENT_TIME_MISSING")
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.utcoffset() is None:
            raise ValueError("timezone required")
        settled_s = dt.timestamp()
    except (ValueError, OverflowError):
        raise SettlementUnavailable("SETTLEMENT_TIME_FORMAT") from None
    if not candle_s + 900 <= settled_s <= now_s:
        raise SettlementUnavailable("SETTLEMENT_TIME_RANGE")
    return (1 if market["result"] == "yes" else -1), settled_s


class SettlementQueue:
    def __init__(self, store, consumer, lineage=None):
        if consumer == "reversal":
            self.table, self.where, self.args = "reversal_rows", "1=1", ()
        elif consumer == "calibration" and lineage:
            self.table = "calibration_observations"
            self.where, self.args = "p.side<>0 AND p.lineage=?", (lineage,)
        else:
            raise ValueError("Unknown settlement consumer")
        self.s, self.consumer = store, consumer
        self.s.db.executescript(SCHEMA)
        self.last_batch = None

    def poll(self, market, now_s):
        # New rows first, then least-recently attempted: >20 missing markets
        # cannot monopolize successive batches. Retry state survives restarts.
        pending = self.s.q(
            f"SELECT p.candle_s,COALESCE(r.attempts,0) FROM {self.table} p "
            "LEFT JOIN settlement_retries r ON r.consumer=? AND r.candle_s=p.candle_s "
            f"WHERE p.label IS NULL AND p.candle_s+900<=? AND {self.where} "
            "AND (r.next_retry_s IS NULL OR r.next_retry_s<=?) "
            "ORDER BY COALESCE(r.last_attempt_s,0),p.candle_s LIMIT ?",
            (self.consumer, now_s, *self.args, now_s, BATCH_SIZE))
        batch = dict(asof_s=now_s, attempted=len(pending), settled=0, deferred=0, reasons={})
        for c, attempts in pending:
            try:
                response = market.settled_market(kalshi_ticker(c))
            except httpx.HTTPStatusError as exc:
                reason = f"HTTP_{exc.response.status_code}"
            except httpx.RequestError as exc:
                reason = type(exc).__name__
            except (json.JSONDecodeError, KeyError):
                reason = "SETTLEMENT_RESPONSE_FORMAT"
            else:
                try:
                    label, settled_s = official_outcome(response, c, now_s)
                except SettlementUnavailable as exc:
                    reason = str(exc)
                else:
                    with self.s.tx():
                        self.s.q(f"UPDATE {self.table} SET label=?,settlement_s=? "
                                 "WHERE candle_s=? AND label IS NULL", (label, settled_s, c))
                        self.s.q("DELETE FROM settlement_retries WHERE consumer=? AND candle_s=?",
                                 (self.consumer, c))
                    batch["settled"] += 1
                    continue
            delay = min(MAX_DELAY, BASE_DELAY * 2 ** min(attempts, 6))
            self.s.q("INSERT INTO settlement_retries VALUES(?,?,?,?,?,?) "
                     "ON CONFLICT(consumer,candle_s) DO UPDATE SET attempts=excluded.attempts, "
                     "next_retry_s=excluded.next_retry_s,last_attempt_s=excluded.last_attempt_s,reason=excluded.reason",
                     (self.consumer, c, attempts + 1, now_s + delay, now_s, reason))
            batch["deferred"] += 1
            batch["reasons"][reason] = batch["reasons"].get(reason, 0) + 1
        self.last_batch = batch
        if pending:
            print(json.dumps(dict(event="v3_settlement_batch", consumer=self.consumer, **batch)), flush=True)
        return batch

    def health(self):
        count, oldest, next_retry = self.s.q(
            "SELECT COUNT(*),MIN(candle_s),MIN(next_retry_s) FROM settlement_retries WHERE consumer=?",
            (self.consumer,))[0]
        return dict(deferred=count, oldest_candle_s=oldest, next_retry_s=next_retry, last_batch=self.last_batch)
