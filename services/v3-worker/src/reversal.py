"""Timestamp-safe reversal skip gate. No networking or order execution.

Recipe ported from the T45 research: C=.01, 8 weeks, 24h settlement
embargo, training-only median + StandardScaler, training Q75 cutoff.
V3 uses its own selected side/rank and settled call population. It is an
explicit V3 adaptation, NOT the original T45 strategy or its performance.
"""
from __future__ import annotations

import hashlib
import json
import warnings
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
from scipy.special import expit
from sklearn.exceptions import ConvergenceWarning
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

VERSION = "v3-reversal-risk-t45-r1"
SOURCE_VERSION = "v3-pf-e008-r1"
FEATURE_SCHEMA = "reversal50-v3-side-rank-t45-r1"
FEATURES = [
    "ret_45s_bps", "last15_ret_bps", "return_accel_15_45_bps",
    "close_location_45s", "path_efficiency_45s", "realized_vol_45s_bps",
    "return_sign_changes", "quote_flow_45s", "quote_flow_15s",
    "quote_volume_last15_share", "trade_count_last15_share", "aligned_snr",
    "confidence_rank", "vwap_distance96_atr", "rsi14", "mfi14", "adx14",
    "atr14_bps", "relative_volume20", "bb_percent_b20", "taker_imbalance4",
    "flow_price_decoupling20", "anchor_recross_rate20", "variance_ratio4_96",
    "sign_entropy96", "amihud96", "late_move_fraction", "late_flow_change",
    "impulse_over_atr", "wick_fraction", "prior_ret_1m", "prior_flow_1m",
    "prior_ret_3m", "prior_flow_3m", "prior_ret_5m", "prior_flow_5m",
    "prior_ret_15m", "prior_flow_15m", "prior_ret_60m", "prior_flow_60m",
    "resistance_distance_15m_atr", "resistance_distance_60m_atr",
    "resistance_distance_240m_atr", "prior_rejection_wick", "prior_vol_60m",
    "prior_1m_volume_relative", "prior_5m_volume_relative", "opening_snr_priorvol",
    "extension_5m_atr", "prior_deceleration",
]
DAY = 86400
WEEK = 7 * DAY
# Match the backtest's fixed seven-day UTC intervals, anchored Monday 06Z.
# This deliberately does not change with Boise DST.
ANCHOR = 1779084000  # 2026-05-18T06:00:00Z


class RiskInvalid(ValueError):
    pass


def week_start(candle_s: int) -> int:
    return ANCHOR + ((candle_s - ANCHOR) // WEEK) * WEEK


def fingerprint(value: dict) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def fit(rows: list[dict], boundary: int, source_version=SOURCE_VERSION,
        feature_schema=FEATURE_SCHEMA) -> dict:
    if boundary != week_start(boundary):
        raise RiskInvalid("RISK_BAD_WEEK_BOUNDARY")
    cutoff = boundary - DAY
    records = sorted([r for r in rows
                      if boundary - 8 * WEEK <= r["candle_s"] < cutoff
                      and r.get("settlement_s") is not None and r["settlement_s"] < cutoff
                      and r.get("label") in (-1, 1) and r.get("side") in (-1, 1)],
                     key=lambda r: r["candle_s"])
    if len(records) < 500 or len({r["candle_s"] for r in records}) != len(records):
        raise RiskInvalid("RISK_INSUFFICIENT_OR_DUPLICATE_TRAINING")
    if any(len(r["features"]) != len(FEATURES) for r in records):
        raise RiskInvalid("RISK_TRAINING_SHAPE")
    x = np.asarray([r["features"] for r in records], float)
    if np.isinf(x).any():
        raise RiskInvalid("RISK_INFINITE_TRAINING")
    y = np.array([int(r["side"] != r["label"]) for r in records])
    if len(np.unique(y)) != 2:
        raise RiskInvalid("RISK_SINGLE_CLASS")
    im = SimpleImputer(strategy="median", keep_empty_features=True)
    sc = StandardScaler()
    z = sc.fit_transform(im.fit_transform(x))
    lr = LogisticRegression(C=.01, max_iter=1500, solver="lbfgs")
    with warnings.catch_warnings():
        warnings.simplefilter("error", ConvergenceWarning)
        lr.fit(z, y)
    body = {"version": VERSION, "source_version": source_version,
            "feature_schema": feature_schema, "feature_order": FEATURES,
            "valid_from_s": boundary, "valid_until_s": boundary + WEEK,
            "training_cutoff_s": cutoff, "training_first_s": records[0]["candle_s"],
            "training_last_s": records[-1]["candle_s"],
            "max_settlement_s": max(r["settlement_s"] for r in records),
            "training_rows": len(records), "median": im.statistics_.tolist(),
            "mean": sc.mean_.tolist(), "scale": sc.scale_.tolist(),
            "coef": lr.coef_[0].tolist(), "intercept": float(lr.intercept_[0]),
            "threshold": float(np.quantile(lr.predict_proba(z)[:, 1], .75)),
            "recipe": {"C": .01, "lookback_weeks": 8, "embargo_s": DAY,
                       "skip_quantile": .75, "min_rows": 500}}
    body["sha256"] = fingerprint(body)
    return body


def validate(head: dict, candle_s: int, source_version=SOURCE_VERSION,
             feature_schema=FEATURE_SCHEMA) -> None:
    body = {k: v for k, v in head.items() if k != "sha256"}
    if head.get("sha256") != fingerprint(body):
        raise RiskInvalid("RISK_ARTIFACT_HASH")
    if (head.get("version") != VERSION or head.get("source_version") != source_version
            or head.get("feature_schema") != feature_schema or head.get("feature_order") != FEATURES):
        raise RiskInvalid("RISK_ARTIFACT_IDENTITY")
    if not head["valid_from_s"] <= candle_s < head["valid_until_s"]:
        raise RiskInvalid("RISK_ARTIFACT_EXPIRED")
    if (head["valid_from_s"] != week_start(candle_s)
            or head["valid_until_s"] != head["valid_from_s"] + WEEK
            or head["training_cutoff_s"] != head["valid_from_s"] - DAY
            or head["training_last_s"] >= head["training_cutoff_s"]
            or head["max_settlement_s"] >= head["training_cutoff_s"]
            or head["training_first_s"] < head["valid_from_s"] - 8 * WEEK
            or head["training_rows"] < 500):
        raise RiskInvalid("RISK_ARTIFACT_LOOKAHEAD")
    if any(len(head[k]) != len(FEATURES) or not np.isfinite(head[k]).all()
           for k in ("median", "mean", "scale", "coef")):
        raise RiskInvalid("RISK_ARTIFACT_VECTOR")
    if (not np.all(np.array(head["scale"]) > 0) or not np.isfinite(head["intercept"])
            or not 0 <= head["threshold"] <= 1):
        raise RiskInvalid("RISK_ARTIFACT_NUMBER")


def predict(head: dict, values: dict, candle_s: int, source_version=SOURCE_VERSION,
            feature_schema=FEATURE_SCHEMA) -> tuple[float, bool]:
    validate(head, candle_s, source_version, feature_schema)
    # Missing keys are wiring failures; explicit nulls are research missingness.
    if set(values) != set(FEATURES):
        raise RiskInvalid("RISK_FEATURE_KEYS")
    x = np.asarray([values[k] for k in FEATURES], float)
    if np.isinf(x).any() or np.isnan(x).all():
        raise RiskInvalid("RISK_FEATURE_INVALID")
    x = np.where(np.isnan(x), head["median"], x)
    z = (x - head["mean"]) / head["scale"]
    p = float(expit(z @ np.asarray(head["coef"]) + head["intercept"]))
    return p, p >= head["threshold"]
