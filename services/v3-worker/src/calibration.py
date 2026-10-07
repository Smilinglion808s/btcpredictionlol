"""R3 calibrated-risk policy. Pure math; no network or delivery operations."""
from __future__ import annotations

import hashlib
import json
import math
import warnings
import numpy as np
from scipy.special import expit, logit
from sklearn.exceptions import ConvergenceWarning
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

VERSION = "v3-calibrated-risk-r3-r1"
FEATURE_SCHEMA = "risk-survival-logit-r1"
LIVE_LINEAGE = "v3-okx-core-kalshi-official-r1"
PROXY_LINEAGE = "v3-binance-index-proxy-r3"
DAY, WEEK, SLOT = 86400, 604800, 900
ANCHOR = 345600  # Monday 1970-01-05 00Z; distinct from reversal's Monday06Z.
KEEP_MIN, ADD_MIN, LOWER_RANK = .55, .64, .60
RECIPE = {"C": .1, "lookback_weeks": 26, "embargo_s": DAY,
          "min_rows": 500, "keep_min": KEEP_MIN, "add_min": ADD_MIN,
          "lower_rank": LOWER_RANK, "baseline_rank": .70}


class CalibrationInvalid(ValueError):
    pass


def week_start(candle_s):
    return ANCHOR + ((int(candle_s) - ANCHOR) // WEEK) * WEEK


def fingerprint(body):
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":"),
                                    allow_nan=False).encode()).hexdigest()


def feature(loss_probability):
    p = float(loss_probability)
    if not math.isfinite(p) or not 0 <= p <= 1:
        raise CalibrationInvalid("CALIBRATION_RISK_PROBABILITY")
    return float(logit(np.clip(1 - p, .001, .999)))


def fit(rows, boundary, history_start_s, lineage=LIVE_LINEAGE):
    if boundary != week_start(boundary):
        raise CalibrationInvalid("CALIBRATION_WEEK_BOUNDARY")
    if lineage not in (LIVE_LINEAGE, PROXY_LINEAGE):
        raise CalibrationInvalid("CALIBRATION_LINEAGE")
    lo, cutoff = boundary - 26 * WEEK, boundary - DAY
    if history_start_s is None or history_start_s > lo:
        raise CalibrationInvalid("CALIBRATION_26_WEEK_HISTORY_REQUIRED")
    records = sorted((r for r in rows if lo <= r["candle_s"] < cutoff
                      and r.get("settlement_s") is not None and r["settlement_s"] < cutoff),
                     key=lambda r: r["candle_s"])
    if len(records) < 500 or len({r["candle_s"] for r in records}) != len(records):
        raise CalibrationInvalid("CALIBRATION_INSUFFICIENT_OR_DUPLICATE_ROWS")
    for r in records:
        c = r["candle_s"]
        if (c % SLOT or r.get("lineage") != lineage or r.get("side") not in (-1, 1)
                or r.get("label") not in (-1, 1) or r["settlement_s"] < c + SLOT
                or not (c + 45) * 1000 <= r.get("evaluated_at_ms", 0) < (c + 46) * 1000
                or not r.get("risk_valid_from_s", c + 1) <= c < r.get("risk_valid_until_s", c)
                or r.get("risk_max_settlement_s", c) >= r.get("risk_valid_from_s", c) - DAY
                or len(r.get("risk_head_sha256", "")) != 64):
            raise CalibrationInvalid("CALIBRATION_TRAINING_PROVENANCE")
    x = np.array([[feature(r["loss_probability"])] for r in records])
    y = np.array([int(r["side"] == r["label"]) for r in records])
    if len(np.unique(y)) != 2:
        raise CalibrationInvalid("CALIBRATION_SINGLE_CLASS")
    im = SimpleImputer(strategy="median", keep_empty_features=True)
    sc = StandardScaler()
    z = sc.fit_transform(im.fit_transform(x))
    lr = LogisticRegression(C=.1, max_iter=1500, random_state=104)
    with warnings.catch_warnings():
        warnings.simplefilter("error", ConvergenceWarning)
        lr.fit(z, y)
    h = {"version": VERSION, "feature_schema": FEATURE_SCHEMA, "lineage": lineage,
         "feature_order": ["risk_survival_logit"], "recipe": RECIPE.copy(),
         "valid_from_s": boundary, "valid_until_s": boundary + WEEK,
         "history_start_s": int(history_start_s), "training_cutoff_s": cutoff,
         "training_first_s": records[0]["candle_s"], "training_last_s": records[-1]["candle_s"],
         "max_settlement_s": max(r["settlement_s"] for r in records), "training_rows": len(records),
         "median": im.statistics_.tolist(), "mean": sc.mean_.tolist(), "scale": sc.scale_.tolist(),
         "coef": lr.coef_[0].tolist(), "intercept": float(lr.intercept_[0])}
    h["sha256"] = fingerprint(h)
    return h


def validate(h, candle_s, lineage=LIVE_LINEAGE):
    try:
        body = {k: v for k, v in h.items() if k != "sha256"}
        if h.get("sha256") != fingerprint(body):
            raise CalibrationInvalid("CALIBRATION_HEAD_HASH")
        if (h["version"] != VERSION or h["feature_schema"] != FEATURE_SCHEMA
                or h["lineage"] != lineage or h["recipe"] != RECIPE
                or h["feature_order"] != ["risk_survival_logit"]):
            raise CalibrationInvalid("CALIBRATION_HEAD_IDENTITY")
        b = h["valid_from_s"]
        if not b <= candle_s < h["valid_until_s"] or b != week_start(candle_s):
            raise CalibrationInvalid("CALIBRATION_HEAD_EXPIRED")
        if (h["valid_until_s"] != b + WEEK or h["training_cutoff_s"] != b - DAY
                or h["history_start_s"] > b - 26 * WEEK
                or not b - 26 * WEEK <= h["training_first_s"] <= h["training_last_s"] < b - DAY
                or h["max_settlement_s"] >= b - DAY or h["training_rows"] < 500):
            raise CalibrationInvalid("CALIBRATION_HEAD_LOOKAHEAD")
        for k in ("median", "mean", "scale", "coef"):
            if len(h[k]) != 1 or not np.isfinite(h[k]).all():
                raise CalibrationInvalid("CALIBRATION_HEAD_VECTOR")
        if h["scale"][0] <= 0 or not math.isfinite(h["intercept"]):
            raise CalibrationInvalid("CALIBRATION_HEAD_NUMBER")
    except (KeyError, TypeError, OverflowError) as e:
        raise CalibrationInvalid("CALIBRATION_HEAD_SHAPE") from e


def predict(h, loss_probability, candle_s, lineage=LIVE_LINEAGE):
    validate(h, candle_s, lineage)
    z = (feature(loss_probability) - h["mean"][0]) / h["scale"][0]
    return float(expit(z * h["coef"][0] + h["intercept"]))


def route(baseline_side, candidate_side, p_correct):
    """Baseline is preferred in the union. Ties at .55/.64 are retained/admitted."""
    if baseline_side not in (-1, 0, 1) or candidate_side not in (-1, 0, 1):
        raise CalibrationInvalid("CALIBRATION_SIDE")
    if baseline_side and candidate_side != baseline_side:
        raise CalibrationInvalid("CALIBRATION_BASELINE_SIDE_CHANGED")
    if not candidate_side:
        return 0, "NO_CANDIDATE"
    if p_correct is None or not math.isfinite(p_correct) or not 0 <= p_correct <= 1:
        raise CalibrationInvalid("CALIBRATION_PROBABILITY")
    if baseline_side:
        return (baseline_side, "KEEP_BASELINE") if p_correct >= KEEP_MIN else (0, "SKIP_BASELINE")
    return (candidate_side, "ADD_LOWER60") if p_correct >= ADD_MIN else (0, "DECLINE_LOWER60")
