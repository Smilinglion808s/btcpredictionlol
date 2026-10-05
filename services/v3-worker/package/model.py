"""Frozen PF-E008 model. No network, account, order or stake logic."""
from __future__ import annotations

import math
import warnings

import numpy as np
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import RobustScaler

MODEL_VERSION = "v3-pf-e008-r1"
FEATURES = {
    15: ["ret_5s_bps", "ret_15s_bps", "range_15s_bps", "quote_flow_5s", "quote_flow_15s"],
    30: ["ret_5s_bps", "ret_15s_bps", "range_15s_bps", "quote_flow_5s", "quote_flow_15s",
         "ret_30s_bps", "range_30s_bps", "quote_flow_30s"],
}


def prefix_features(bars: list[dict], checkpoint: int, candle_ms: int) -> list[float]:
    """Only final, contiguous Binance GLOBAL spot seconds 0..checkpoint-1.

    Quote flow uses actual quote/taker-buy-quote volume, NOT base-volume proxies.
    Receipt/deadline checks belong to the runtime, before this pure function.
    """
    if checkpoint not in FEATURES or len(bars) != checkpoint:
        raise ValueError("incomplete_prefix")
    ordered = sorted(bars, key=lambda b: b["open_ms"])
    for i, bar in enumerate(ordered):
        if bar["open_ms"] != candle_ms + 1000 * i or bar["close_ms"] != bar["open_ms"] + 999:
            raise ValueError("noncontiguous_prefix")
        if bar.get("is_final") is not True:
            raise ValueError("nonfinal_bar")
        for key in ("open", "high", "low", "close", "quote_volume", "taker_buy_quote_volume"):
            if not math.isfinite(bar[key]):
                raise ValueError("nonfinite_bar")
        if min(bar[k] for k in ("open", "high", "low", "close")) <= 0:
            raise ValueError("invalid_price")
        if not (bar["low"] <= min(bar["open"], bar["close"]) <= max(bar["open"], bar["close"]) <= bar["high"]):
            raise ValueError("invalid_ohlc")
        if not 0 <= bar["taker_buy_quote_volume"] <= bar["quote_volume"]:
            raise ValueError("invalid_quote_volume")
    base = ordered[0]["open"]
    values = {}
    for n in (5, 15, 30):
        if n > checkpoint:
            continue
        prefix = ordered[:n]
        q = sum(b["quote_volume"] for b in prefix)
        if q <= 0:
            raise ValueError("zero_quote_volume")
        values[f"ret_{n}s_bps"] = math.log(prefix[-1]["close"] / base) * 10000
        values[f"range_{n}s_bps"] = (max(b["high"] for b in prefix) - min(b["low"] for b in prefix)) / base * 10000
        values[f"quote_flow_{n}s"] = 2 * sum(b["taker_buy_quote_volume"] for b in prefix) / q - 1
    return [values[name] for name in FEATURES[checkpoint]]


def fit_head(stamps, x, labels, utc_day_s: int, checkpoint: int) -> dict:
    """90 scheduled days, closed OKX labels, equal total weight per UTC day."""
    stamps, x, labels = np.asarray(stamps), np.asarray(x, dtype=float), np.asarray(labels)
    if utc_day_s % 86400 or checkpoint not in FEATURES:
        raise ValueError("bad_fit_boundary")
    if x.shape != (len(stamps), len(FEATURES[checkpoint])) or len(labels) != len(stamps):
        raise ValueError("bad_training_shape")
    if len(np.unique(stamps)) != len(stamps) or np.any(stamps % 900):
        raise ValueError("bad_training_timestamps")
    mask = ((stamps >= utc_day_s - 8640 * 900) & (stamps + 900 <= utc_day_s)
            & np.isfinite(x).all(axis=1) & np.isin(labels, [-1, 1]))
    idx = np.flatnonzero(mask)
    idx = idx[np.argsort(stamps[idx])]
    if len(idx) < 2688 or len(np.unique(labels[idx])) != 2:
        raise ValueError("insufficient_training")
    scaler = RobustScaler(quantile_range=(10, 90))
    transformed = scaler.fit_transform(x[idx])
    _, inverse, counts = np.unique(stamps[idx] // 86400, return_inverse=True, return_counts=True)
    weights = 1 / counts[inverse]
    weights *= len(weights) / weights.sum()
    estimator = LogisticRegression(C=.001, solver="lbfgs", max_iter=500, tol=1e-8)
    with warnings.catch_warnings():
        warnings.simplefilter("error", ConvergenceWarning)
        estimator.fit(transformed, (labels[idx] > 0).astype(int), sample_weight=weights)
    return {"model_version": MODEL_VERSION, "checkpoint": checkpoint,
            "valid_from_s": utc_day_s, "valid_until_s": utc_day_s + 86400,
            "feature_order": FEATURES[checkpoint], "label_source": "OKX confirmed BTC-USDT 15m direction",
            "training_rows": len(idx), "training_first_s": int(stamps[idx[0]]),
            "training_last_s": int(stamps[idx[-1]]), "scaler_center": scaler.center_.tolist(),
            "scaler_scale": scaler.scale_.tolist(), "coefficients": estimator.coef_[0].tolist(),
            "intercept": float(estimator.intercept_[0]), "iterations": int(estimator.n_iter_[0])}


def predict(head: dict, x, candle_s: int):
    if (head["model_version"] != MODEL_VERSION or head["feature_order"] != FEATURES[head["checkpoint"]]
            or not head["valid_from_s"] <= candle_s < head["valid_until_s"]):
        raise ValueError("wrong_or_expired_model")
    x = np.asarray(x, dtype=float)
    if x.shape[-1] != len(head["feature_order"]) or not np.isfinite(x).all():
        raise ValueError("invalid_features")
    z = ((x - np.array(head["scaler_center"])) / np.array(head["scaler_scale"])) @ np.array(head["coefficients"]) + head["intercept"]
    from scipy.special import expit
    return expit(z)


def rank_before_append(probability: float, prior: list[float]) -> float | None:
    if not math.isfinite(probability) or not 0 <= probability <= 1:
        raise ValueError("invalid_probability")
    if any(not math.isfinite(v) or v < 0 or v > .5 for v in prior):
        raise ValueError("invalid_confidence_history")
    history = prior[-768:]
    return None if len(history) < 192 else sum(v <= abs(probability - .5) for v in history) / len(history)


def select(t15: dict | None, t30: dict | None) -> dict | None:
    """T15 wins precedence. BOTH learner histories must still be updated."""
    for checkpoint, result in ((15, t15), (30, t30)):
        if result is not None and result.get("rank") is not None and result["rank"] >= .70:
            return {"checkpoint": checkpoint, "direction": 1 if result["probability"] >= .5 else -1}
    return None
