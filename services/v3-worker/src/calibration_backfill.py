"""Verified historical bootstrap; writes no decisions, outbox, or forward results."""
from __future__ import annotations

import gzip
import hashlib
import json
import math
from pathlib import Path

import calibration as C
import reversal as R
from v3core import kalshi_ticker

PACKAGE = Path(__file__).resolve().parent.parent / "calibration_package"
VERSION = "v3-calibration-backfill-r1"


def read_package(package=PACKAGE):
    manifest = json.loads((package / "SHA256.json").read_text())
    data = {}
    for name in ("seed.json.gz", "head.json", "audit.json"):
        raw = (package / name).read_bytes()
        if hashlib.sha256(raw).hexdigest() != manifest.get(name):
            raise C.CalibrationInvalid("CALIBRATION_BACKFILL_HASH")
        data[name] = json.loads(gzip.decompress(raw) if name.endswith(".gz") else raw)
    return data["seed.json.gz"], data["head.json"], data["audit.json"], manifest


def validate(seed, head, audit, now_s):
    start, end = seed["history_start_s"], seed["history_end_s"]
    if (seed.get("version") != VERSION or seed.get("origin") != C.BACKFILL_ORIGIN
            or seed.get("lineage") != C.LIVE_LINEAGE or end != C.week_start(end)
            or end - start != 26 * C.WEEK or end > now_s
            or not end <= seed["reconstructed_at_s"] <= now_s):
        raise C.CalibrationInvalid("CALIBRATION_BACKFILL_IDENTITY")
    C.validate(head, end)
    if (head["valid_from_s"] != end or head["sha256"] != audit["head_sha256"]
            or audit["history_start_s"] != start or audit["history_end_s"] != end):
        raise C.CalibrationInvalid("CALIBRATION_BACKFILL_HEAD")
    records, previous = [], start - C.SLOT
    observations = seed["observations"]
    if not observations or observations[0]["candle_s"] != start:
        raise C.CalibrationInvalid("CALIBRATION_BACKFILL_START")
    for obs in observations:
        c, candidate = obs["candle_s"], obs.get("candidate")
        if (not previous < c < end or c < start or c % C.SLOT
                or obs.get("origin") != C.BACKFILL_ORIGIN
                or obs.get("lineage") != C.LIVE_LINEAGE
                or obs.get("ticker") != kalshi_ticker(c)
                or obs.get("baseline_side") not in (-1, 0, 1)
                or obs.get("result") != dict(status="HISTORICAL", reason="TRAINING_ONLY", direction=0)):
            raise C.CalibrationInvalid("CALIBRATION_BACKFILL_OBSERVATION")
        previous = c
        if candidate is None:
            if obs.get("label") is not None or obs.get("settlement_s") is not None:
                raise C.CalibrationInvalid("CALIBRATION_BACKFILL_NONCANDIDATE_LABEL")
            continue
        if (candidate.get("origin") != C.BACKFILL_ORIGIN
                or candidate.get("lineage") != C.LIVE_LINEAGE
                or candidate.get("side") not in (-1, 1) or obs.get("label") not in (-1, 1)
                or not c + C.SLOT <= obs["settlement_s"] <= seed["reconstructed_at_s"]
                or candidate.get("reconstructed_at_s") != seed["reconstructed_at_s"]
                or candidate.get("evaluated_at_ms") is not None
                or candidate.get("replay_at_ms") != (c + 45) * 1000
                or candidate.get("feature_asof_ms") != (c + 45) * 1000 - 1
                or candidate.get("checkpoint") not in (15, 30)
                or not (.70 if obs["baseline_side"] else .60) <= candidate.get("rank", -1) <= 1
                or (obs["baseline_side"] and obs["baseline_side"] != candidate["side"])):
            raise C.CalibrationInvalid("CALIBRATION_BACKFILL_CANDIDATE")
        rh = seed["risk_heads"][str(R.week_start(c))]
        R.validate(rh, c)
        for ck, hk in (("risk_head_sha256", "sha256"), ("risk_valid_from_s", "valid_from_s"),
                       ("risk_valid_until_s", "valid_until_s"), ("risk_max_settlement_s", "max_settlement_s")):
            if candidate.get(ck) != rh[hk]:
                raise C.CalibrationInvalid("CALIBRATION_BACKFILL_RISK_PROVENANCE")
        x = candidate["risk_features"]
        if len(x) != len(R.FEATURES) or any(v is not None and not math.isfinite(v) for v in x):
            raise C.CalibrationInvalid("CALIBRATION_BACKFILL_FEATURES")
        prob, skip = R.predict(rh, dict(zip(R.FEATURES, x)), c)
        if skip or not math.isfinite(candidate["loss_probability"]) or abs(prob - candidate["loss_probability"]) > 1e-12:
            raise C.CalibrationInvalid("CALIBRATION_BACKFILL_RISK_SCORE")
        records.append(dict(candidate, candle_s=c, label=obs["label"], settlement_s=obs["settlement_s"]))
    if (len(observations) != audit["reconstructed_intervals"]
            or len(records) != audit["settled_union_candidates"]
            or records[-1]["candle_s"] < end - 3 * C.DAY
            or C.fit(records, end, start) != head):
        raise C.CalibrationInvalid("CALIBRATION_BACKFILL_REFIT_PARITY")


def install(store, now_s, package=PACKAGE):
    seed, head, audit, hashes = read_package(package)
    identity = hashes["seed.json.gz"]
    previous = store.meta("calibration_backfill")
    if previous:
        if previous["seed_sha256"] != identity:
            raise C.CalibrationInvalid("CALIBRATION_BACKFILL_ALREADY_DIFFERENT")
        return previous
    validate(seed, head, audit, now_s)
    inserted = 0
    with store.tx() as db:
        # Preserve existing real observations. Any overlap leaves head fitting to
        # the normal background path using the merged, authoritative population.
        for obs in seed["observations"]:
            candidate = obs["candidate"]
            cursor = db.execute("INSERT OR IGNORE INTO calibration_observations VALUES(?,?,?,?,?,?)",
                                (obs["candle_s"], json.dumps(obs, separators=(",", ":"), allow_nan=False),
                                 candidate["side"] if candidate else 0, obs["label"],
                                 obs["settlement_s"], C.LIVE_LINEAGE))
            inserted += cursor.rowcount
        if inserted == len(seed["observations"]) and head["valid_from_s"] <= now_s < head["valid_until_s"]:
            db.execute("INSERT OR IGNORE INTO calibration_heads VALUES(?,?,?)",
                       (head["valid_from_s"], C.LIVE_LINEAGE, json.dumps(head, allow_nan=False)))
        proof = dict(version=VERSION, seed_sha256=identity, installed_at_s=now_s,
                     inserted_rows=inserted, preserved_rows=len(seed["observations"])-inserted,
                     history_start_s=seed["history_start_s"], history_end_s=seed["history_end_s"],
                     settled_candidates=audit["settled_union_candidates"], source_gaps=audit["source_gaps"])
        store.set_meta("calibration_backfill", proof)
    return proof
