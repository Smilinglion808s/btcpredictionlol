"""Durable R3 candidate capture/refits. Live and proxy calibration never mix."""
from __future__ import annotations

import json
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo
import calibration as C
import reversal as R
import reversal_features as F
from settlement_retry import SettlementQueue

SCHEMA = """
CREATE TABLE IF NOT EXISTS calibration_observations(
 candle_s INTEGER PRIMARY KEY, body TEXT NOT NULL, side INTEGER NOT NULL,
 label INTEGER, settlement_s REAL, lineage TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS calibration_heads(
 week_s INTEGER NOT NULL, lineage TEXT NOT NULL, body TEXT NOT NULL,
 PRIMARY KEY(week_s,lineage));
"""


class CalibrationRuntime:
    def __init__(self, engine, risk, market):
        self.engine, self.s, self.risk, self.market = engine, engine.s, risk, market
        self.s.db.executescript(SCHEMA)
        self.settlements = SettlementQueue(self.s, "calibration", C.LIVE_LINEAGE)
        self.tracking = None

    def head(self, c):
        rows = self.s.q("SELECT body FROM calibration_heads WHERE week_s=? AND lineage=?",
                        (C.week_start(c), C.LIVE_LINEAGE))
        if not rows:
            raise C.CalibrationInvalid("CALIBRATION_HEAD_MISSING")
        h = json.loads(rows[0][0]); C.validate(h, c)
        return h

    def _lower_candidate(self, c, audit):
        for cp in (15, 30):
            a = audit.get(f"t{cp}")
            if not a or not (c + cp) * 1000 <= a.get("at_ms", 0) < (c + cp + 1) * 1000:
                raise C.CalibrationInvalid("CALIBRATION_CHECKPOINT_NOT_OBSERVED")
            reason = a.get("reason")
            if reason:
                if reason.startswith("DATA_INVALID:"):
                    continue
                raise C.CalibrationInvalid("CALIBRATION_CHECKPOINT_INVALID")
            rank, p = a.get("rank"), a.get("probability")
            if rank is None or p is None or not 0 <= rank <= 1 or not 0 <= p <= 1:
                raise C.CalibrationInvalid("CALIBRATION_CHECKPOINT_VALUES")
            if rank >= C.LOWER_RANK:
                h = self.engine.head(cp, c - c % C.DAY)
                if not h:
                    raise C.CalibrationInvalid("CALIBRATION_CORE_HEAD_MISSING")
                return dict(side=1 if p >= .5 else -1, rank=rank, checkpoint=cp,
                            decision_ms=a["at_ms"], fit_version=self.engine.fit_version(h))
        return None

    def score(self, c, bars, now_ms, feed_ok=True, clock_ok=True):
        # No delivery or network inside this transaction. Restart/retry cannot change an intent.
        with self.s.tx():
            previous = self.s.q("SELECT body FROM calibration_observations WHERE candle_s=?", (c,))
            if previous:
                return json.loads(previous[0][0])["result"]
            result = dict(version=C.VERSION, lineage=C.LIVE_LINEAGE, evaluated_at_ms=now_ms,
                          mode=self.engine.calibration_mode, status="INVALID")
            observation = {"candle_s": c, "lineage": C.LIVE_LINEAGE, "candidate": None}
            try:
                if not (c + 45) * 1000 <= now_ms < (c + 46) * 1000:
                    raise C.CalibrationInvalid("CALIBRATION_CHECKPOINT_TIMING")
                if not feed_ok or not clock_ok:
                    raise C.CalibrationInvalid("CALIBRATION_FEED_OR_CLOCK")
                rows = self.s.q("SELECT status,reason,checkpoint,direction,rank,decision_ms,fit_version,audit "
                                "FROM decisions WHERE candle_s=?", (c,))
                if not rows:
                    raise C.CalibrationInvalid("CALIBRATION_DECISION_MISSING")
                st, reason, cp, side, rank, dms, fv, raw = rows[0]
                audit = json.loads(raw)
                if st not in ("SELECTED", "NO_CALL"):
                    raise C.CalibrationInvalid("CALIBRATION_BASELINE_UNAVAILABLE")
                original_risk = audit.get("reversal_risk") or {}
                baseline = side if st == "SELECTED" and original_risk.get("status") == "PASS" else 0
                if st == "SELECTED" and not baseline:
                    raise C.CalibrationInvalid("CALIBRATION_BASELINE_RISK_MISSING")
                observation["baseline"] = dict(status=st, reason=reason, checkpoint=cp, side=side,
                                               rank=rank, decision_ms=dms, fit_version=fv,
                                               reversal_risk=original_risk)
                result.update(original_selected_side=side, original_selected_checkpoint=cp,
                              original_risk_status=original_risk.get("status"))
                candidate = (dict(side=side, rank=rank, checkpoint=cp, decision_ms=dms, fit_version=fv)
                             if baseline else self._lower_candidate(c, audit))
                result["baseline_side"] = baseline
                if candidate:
                    if not self.risk:
                        raise C.CalibrationInvalid("CALIBRATION_RISK_RUNTIME_MISSING")
                    with self.risk.lock:
                        context = self.risk.context
                    if context is None:
                        raise C.CalibrationInvalid("CALIBRATION_CONTEXT_MISSING")
                    values = F.build(bars, context, c, candidate["side"], candidate["rank"])
                    rh = self.risk.head(c)
                    prob, skip = R.predict(rh, values, c)
                    if baseline and (skip or rh["sha256"] != original_risk.get("head_sha256")
                                     or abs(prob - original_risk["loss_probability"]) > 1e-12):
                        raise C.CalibrationInvalid("CALIBRATION_BASELINE_RISK_PARITY")
                    if skip:
                        candidate = None
                    else:
                        candidate.update(loss_probability=prob, evaluated_at_ms=now_ms,
                                         lineage=C.LIVE_LINEAGE, risk_head_sha256=rh["sha256"],
                                         risk_valid_from_s=rh["valid_from_s"], risk_valid_until_s=rh["valid_until_s"],
                                         risk_max_settlement_s=rh["max_settlement_s"],
                                         risk_audit=dict(version=R.VERSION, feature_schema=R.FEATURE_SCHEMA,
                                                         evaluated_at_ms=now_ms, status="PASS", loss_probability=prob,
                                                         threshold=rh["threshold"], head_sha256=rh["sha256"],
                                                         feature_asof_ms=(c+45)*1000-1))
                observation["candidate"] = candidate
                if not candidate:
                    result.update(status="NO_CANDIDATE", direction=0, reason="NO_RISK_PASSED_CANDIDATE")
                else:
                    # Persist the virtual population even while calibration is warming up.
                    result["candidate_side"] = candidate["side"]
                    result["candidate_checkpoint"] = candidate["checkpoint"]
                    result["candidate_rank"] = candidate["rank"]
                    h = self.head(c)
                    p = C.predict(h, candidate["loss_probability"], c)
                    direction, action = C.route(baseline, candidate["side"], p)
                    result.update(status="PASS" if direction else "SKIP", direction=direction,
                                  reason=action, p_correct=p, head_sha256=h["sha256"],
                                  valid_until_s=h["valid_until_s"], feature_asof_ms=(c+45)*1000-1)
            except Exception as exc:
                result.update(status="INVALID", direction=0,
                              reason=str(exc)[:160] if isinstance(exc, (C.CalibrationInvalid, R.RiskInvalid))
                              else type(exc).__name__)
            observation["result"] = result
            candidate = observation["candidate"]
            self.s.q("INSERT INTO calibration_observations VALUES(?,?,?,NULL,NULL,?)",
                     (c, json.dumps(observation, allow_nan=False), candidate["side"] if candidate else 0, C.LIVE_LINEAGE))
            self.engine._audit(c, {"calibration_filter": result})
            if self.engine.calibration_mode == "enforce":
                self._apply(c, candidate, observation.get("baseline"), result, now_ms)
            return result

    def _apply(self, c, candidate, baseline, result, now_ms):
        if self.s.q("SELECT 1 FROM outbox WHERE candle_s=?", (c,)):
            raise C.CalibrationInvalid("CALIBRATION_OUTBOX_ALREADY_FROZEN")
        if result["status"] == "PASS":
            self.engine._set_decision(c, "SELECTED", result["reason"], candidate["checkpoint"],
                                      candidate["side"], candidate["rank"], candidate["decision_ms"],
                                      candidate["fit_version"], {"calibration_filter": result,
                                                               "baseline_before_calibration": baseline,
                                                               "reversal_risk": candidate["risk_audit"]})
        elif result["status"] in ("SKIP", "INVALID"):
            self.s.q("UPDATE decisions SET status=?,reason=?,updated_ms=? WHERE candle_s=?",
                     ("NO_CALL" if result["status"] == "SKIP" else "FAIL_CLOSED",
                      result["reason"], now_ms, c))

    def settle_and_refit(self, now_s):
        self.settlements.poll(self.market, now_s)
        start = self.s.q("SELECT MIN(candle_s) FROM calibration_observations WHERE lineage=?", (C.LIVE_LINEAGE,))[0][0]
        b = C.week_start(now_s)
        for boundary in (b, b + C.WEEK):
            if now_s < boundary - C.DAY or self.s.q("SELECT 1 FROM calibration_heads WHERE week_s=? AND lineage=?",
                                                   (boundary, C.LIVE_LINEAGE)):
                continue
            if start is None or start > boundary - 26 * C.WEEK:
                self.engine.faults["calibration_warmup"] = "CALIBRATION_26_WEEK_HISTORY_REQUIRED"
                continue
            rows = self.s.q("SELECT candle_s,body,label,settlement_s FROM calibration_observations "
                            "WHERE lineage=? AND side<>0 AND candle_s>=? AND candle_s<? AND settlement_s<? "
                            "ORDER BY candle_s", (C.LIVE_LINEAGE, boundary-26*C.WEEK, boundary-C.DAY, boundary-C.DAY))
            records = [dict(json.loads(body)["candidate"], candle_s=c, label=y, settlement_s=st) for c, body, y, st in rows]
            if not records or records[-1]["candle_s"] < boundary - 3*C.DAY:
                raise C.CalibrationInvalid("CALIBRATION_TRAINING_STALE")
            # Fit outside the store lock; checkpoint/sender loops can continue.
            h = C.fit(records, boundary, start)
            self.s.q("INSERT OR IGNORE INTO calibration_heads VALUES(?,?,?)",
                     (boundary, C.LIVE_LINEAGE, json.dumps(h, allow_nan=False)))
            self.engine.faults.pop("calibration_warmup", None)

    def refresh_tracking(self, now_s):
        """Official forward results, computed on the background refit thread."""
        zone = ZoneInfo("America/Boise")
        day = datetime.fromtimestamp(now_s, zone).date()
        start = datetime.combine(day, time.min, zone).timestamp()
        end = datetime.combine(day + timedelta(days=1), time.min, zone).timestamp()
        keys = ("observations", "scored", "calls", "kept", "added", "skipped", "wins", "losses", "pending")
        query = """WITH r AS (
          SELECT candle_s,label,json_extract(body,'$.result.status') st,
            json_extract(body,'$.result.reason') reason,
            json_extract(body,'$.result.direction') direction
          FROM calibration_observations WHERE lineage=?
            AND COALESCE(json_extract(body,'$.origin'),'forward')<>'historical_reconstruction')
          SELECT COUNT(*),COALESCE(SUM(st IN ('PASS','SKIP')),0),COALESCE(SUM(st='PASS'),0),
            COALESCE(SUM(st='PASS' AND reason='KEEP_BASELINE'),0),
            COALESCE(SUM(st='PASS' AND reason='ADD_LOWER60'),0),COALESCE(SUM(st='SKIP'),0),
            COALESCE(SUM(st='PASS' AND label=direction),0),
            COALESCE(SUM(st='PASS' AND label IS NOT NULL AND label<>direction),0),
            COALESCE(SUM(st='PASS' AND label IS NULL),0)
          FROM r WHERE candle_s>=? AND candle_s<?"""
        def tally(lo, hi):
            out = dict(zip(keys, self.s.q(query, (C.LIVE_LINEAGE, lo, hi))[0]))
            n = out["wins"] + out["losses"]
            out.update(net=out["wins"]-out["losses"], win_rate=out["wins"]/n if n else None)
            return out
        recent = self.s.q("SELECT candle_s,body FROM calibration_observations WHERE lineage=? "
                          "AND COALESCE(json_extract(body,'$.origin'),'forward')<>'historical_reconstruction' "
                          "ORDER BY candle_s DESC LIMIT 1", (C.LIVE_LINEAGE,))
        latest = None
        if recent:
            c, body = recent[0]; r = json.loads(body)["result"]
            latest = dict(candle_s=c, **{k:r.get(k) for k in
                          ("status", "reason", "p_correct", "direction", "candidate_side", "candidate_checkpoint")})
        self.tracking = dict(asof_s=now_s, boise_day=day.isoformat(), total=tally(0, now_s+1),
                             today=tally(start, end), latest=latest)

    def health(self, c):
        n, settled, start, backfilled = self.s.q("SELECT COUNT(*),SUM(CASE WHEN label IS NOT NULL THEN 1 ELSE 0 END),MIN(candle_s), "
                                    "COALESCE(SUM(json_extract(body,'$.origin')='historical_reconstruction'),0) "
                                    "FROM calibration_observations WHERE lineage=?", (C.LIVE_LINEAGE,))[0]
        out = {"calibration_mode": self.engine.calibration_mode, "calibration_ready": False,
               "calibration_observations": n, "calibration_settled_candidates": settled or 0,
               "calibration_history_start_s": start, "calibration_lineage": C.LIVE_LINEAGE,
               "calibration_backfilled_observations": backfilled,
               "calibration_forward_observations": n-backfilled,
               "calibration_tracking": self.tracking}
        try:
            h = self.head(c)
            out.update(calibration_ready=True, calibration_head_sha256=h["sha256"],
                       calibration_training_rows=h["training_rows"],
                       calibration_valid_until_s=h["valid_until_s"])
        except C.CalibrationInvalid as exc:
            out["calibration_not_ready_reason"] = str(exc)
            if str(exc) == "CALIBRATION_HEAD_MISSING" and (start is None or start > C.week_start(c)-26*C.WEEK):
                out["calibration_not_ready_reason"] = "CALIBRATION_26_WEEK_HISTORY_REQUIRED"
        return out
