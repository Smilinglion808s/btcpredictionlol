"""C51 expert: faithful transcription of the frozen research decision path.

Source of truth (recovered research archive, not modifiable):
  research_c51/acquire_c51_target_native_data_r1.py
  research_c51/build_c51_target_native_rebase_r1.py
Frozen identity: C51_TARGET_NATIVE_REBASE_R1
Frozen primary variant shipped as "c51_prediction"/"c51_reliability_rank":
  PRIMARY = "C51_PRIMARY_C42_OR_DIRECT_META_Q58"

C51 is NOT a stateless single-row classifier. It is a two-stage walk-forward
pipeline:

  Stage A (direction head, "DIRECTION_WITH_POLY_BOOK"):
    A daily-refit (every REFIT_ROWS=96 rows, i.e. once per day, and only on a
    UTC-midnight boundary) L2-regularised logistic regression trained on the
    trailing WINDOW=8_640 rows (<=90 days) of 15-minute candles (minimum
    MINIMUM=2_688 rows with both classes present), predicting P(next candle
    up) from 45 causal features (Binance spot+perp micro-flow/return/volume
    features across four 5s windows, 15-minute and 5-minute basis windows,
    cross-venue agreement/gap fields, and 5 Polymarket pre-open book fields),
    after per-fold median imputation and RobustScaler(10,90) standardisation,
    fit with day-balanced sample weights.

  Proposal: c42_prediction if nonzero, else sign(direction probability - 0.5).

  Stage B (reliability/meta head, "META_PRIMARY_C42_OR_DIRECT"):
    A second identically-refit logistic regression trained to predict
    P(proposal is correct) from a meta feature vector built from the Stage A
    probability, the proposal's agreement with a dozen upstream directional
    signals (C30/C36/C37/external/R4/C42), Polymarket book alignment, raw
    micro-flow features aligned to the proposal sign, and centred rank
    features from R4/mean_135/external.

  Reliability rank: for each side (+1/-1) independently, a trailing
    RANK_HISTORY=768-value empirical percentile (with 0.5-tie handling) of the
    Stage-B probability among that side's most recent RANK_MINIMUM=192+
    proposals -- NOT the raw probability itself.

  Decision rule: c51_prediction = proposal if reliability_rank >= 0.58
  (PRIMARY_THRESHOLD) else 0. c51_reliability_rank is that same rank value
  (0.0 when the rank history has not reached RANK_MINIMUM, matching the
  original NaN -> "no call" behaviour).

Because every one of these quantities depends on a specific point in a
90-day-deep, continuously-refit walk-forward replay, C51 cannot be evaluated
from a single candle packet in isolation. There is no way to "fabricate" a
fitted coefficient vector or a rank-history deque without replaying history --
doing so would violate the faithfulness requirement. This module therefore
implements the exact training/replay protocol (`C51WalkForward`) so that
fitted state (model coefficients, imputation medians, scaler quantiles, and
per-side rank-history deques) can be produced by replaying real history, and
a thin stateless `C51Expert.evaluate` that fails closed unless it is handed
that fitted state plus the current candle's raw features.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Any, Iterable

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import RobustScaler

# ---------------------------------------------------------------------------
# Frozen constants (verbatim from build_c51_target_native_rebase_r1.py)
# ---------------------------------------------------------------------------

IDENTITY = "C51_TARGET_NATIVE_REBASE_R1"
PRIMARY_IDENTITY = "C51_PRIMARY_C42_OR_DIRECT_META_Q58"

WINDOW = 8_640
MINIMUM = 2_688
REFIT_ROWS = 96
C_VALUE = 0.003
RANK_HISTORY = 768
RANK_MINIMUM = 192
PRIMARY_THRESHOLD = 0.58

VENUES = ("binance_spot", "binance_um")
T5_WINDOWS = ("w001", "w002", "w003", "w005")
CROSS_FIELDS = (
    "binance_cross_t5_flow_agreement_5s",
    "binance_cross_t5_flow_gap_5s",
    "binance_cross_t5_return_agreement_5s",
    "binance_cross_t5_return_gap_5s",
)
POLY_FIELDS = (
    "pm_mid_centered",
    "pm_abs_skew",
    "pm_book_disagreement",
    "pm_staleness_sec",
    "pm_valid",
)
TIME_FEATURES = ("utc_time_sin", "utc_time_cos", "utc_dow_sin", "utc_dow_cos")

# Direction feature schema (frozen at 45 columns; verified below).
DIRECTION_FEATURES: list[str] = []
for _venue in VENUES:
    for _window in T5_WINDOWS:
        for _field in ("return_bps", "flow_imbalance"):
            DIRECTION_FEATURES.append(f"{_venue}_t5_{_window}_{_field}")
        DIRECTION_FEATURES.append(f"log1p_{_venue}_t5_{_window}_quote_volume")
    for _field in ("range_bps", "price_flow_alignment"):
        DIRECTION_FEATURES.append(f"{_venue}_t5_w005_{_field}")
    for _field in ("return_bps", "flow_imbalance"):
        DIRECTION_FEATURES.append(f"{_venue}_t0_w900_{_field}")
DIRECTION_FEATURES.extend(CROSS_FIELDS)
DIRECTION_FEATURES.extend(POLY_FIELDS)
DIRECTION_FEATURES.extend(TIME_FEATURES)
if len(DIRECTION_FEATURES) != 45:
    raise RuntimeError(f"C51 direction schema drift: {len(DIRECTION_FEATURES)} != 45")

# Raw fields required to build the direction feature matrix and the meta
# feature matrix for a single candle. Anything missing here is a hard,
# fail-closed error at decision time.
RAW_BINANCE_FIELDS: list[str] = []
for _venue in VENUES:
    for _window in T5_WINDOWS:
        RAW_BINANCE_FIELDS.extend(
            [
                f"{_venue}_t5_{_window}_return_bps",
                f"{_venue}_t5_{_window}_flow_imbalance",
                f"log1p_{_venue}_t5_{_window}_quote_volume",
            ]
        )
    RAW_BINANCE_FIELDS.extend(
        [
            f"{_venue}_t5_w005_range_bps",
            f"{_venue}_t5_w005_price_flow_alignment",
            f"{_venue}_t0_w900_return_bps",
            f"{_venue}_t0_w900_flow_imbalance",
        ]
    )
RAW_BINANCE_FIELDS.extend(CROSS_FIELDS)
RAW_BINANCE_FIELDS = list(dict.fromkeys(RAW_BINANCE_FIELDS))

RAW_UPSTREAM_PREDICTION_FIELDS = (
    "c42_prediction",
    "c30_prediction",
    "c36_prediction",
    "c37_prediction",
    "external_direction",
    "r4_prediction",
)
RAW_UPSTREAM_RANK_FIELDS = (
    "r4_probability_correct",
    "r4_directional_rank",
    "external_rank",
    "mean_135_rank",
)

REQUIRED_RAW_FIELDS = tuple(
    dict.fromkeys(
        [
            *RAW_BINANCE_FIELDS,
            *TIME_FEATURES,
            *RAW_UPSTREAM_PREDICTION_FIELDS,
            *RAW_UPSTREAM_RANK_FIELDS,
            "binance_complete",
            "c42_stage",
        ]
    )
)

# Polymarket pre-open book fields are LIVE EXTERNAL DATA. They are consumed
# with a graceful-missing fallback identical to the original merge (`how="left"`
# then fillna(0.0)/pm_valid=False), so their absence degrades rather than
# blocks a decision -- but it does mean any packet without them cannot be
# bit-identical to a fully-fed historical replay. See report.
OPTIONAL_POLY_FIELDS = POLY_FIELDS


class C51InputError(Exception):
    """Raised when a packet is missing a raw input or fitted state C51 needs."""


# ---------------------------------------------------------------------------
# Stage math (verbatim transcription)
# ---------------------------------------------------------------------------


def _sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-z))


def _apply_fitted_linear(
    x_row: np.ndarray, imputation: np.ndarray, center: np.ndarray, scale: np.ndarray,
    coef: np.ndarray, intercept: float,
) -> float:
    """RobustScaler(10,90) transform + logistic sigmoid, single row.

    Reproduces model.predict_proba(scaler.transform(x))[:, 1] exactly for a
    scikit-learn LogisticRegression / RobustScaler pair, given their fitted
    parameters (center = median, scale = P90-P10 per RobustScaler
    convention, with 0 replaced by 1.0 as sklearn does internally).
    """
    x = np.where(np.isfinite(x_row), x_row, imputation)
    safe_scale = np.where(scale == 0, 1.0, scale)
    scaled = (x - center) / safe_scale
    z = float(np.dot(scaled, coef) + intercept)
    return float(_sigmoid(np.array([z]))[0])


def direction_from_probability(probability: float) -> int:
    if not np.isfinite(probability):
        return 0
    return 1 if probability >= 0.5 else -1


def directional_rank_update(
    history: dict[int, deque], side: int, value: float
) -> float | None:
    """Empirical percentile of `value` among trailing per-side history.

    Returns None (no rank -> no call) below RANK_MINIMUM prior observations,
    matching directional_rank() in the frozen script. The caller is
    responsible for appending `value` to history[side] AFTER reading the
    rank (the original loop ranks against *prior* history only).
    """
    if side not in (1, -1) or not np.isfinite(value):
        return None
    prior = np.asarray(history.get(side, ()), dtype=float)
    if len(prior) < RANK_MINIMUM:
        return None
    return float((np.sum(prior < value) + 0.5 * np.sum(prior == value)) / len(prior))


def build_meta_feature_row(raw: dict[str, Any], direct_probability: float, proposal: int) -> dict[str, float]:
    """Single-row transcription of meta_matrix() in the frozen script."""
    direct_direction = direction_from_probability(direct_probability)
    row: dict[str, float] = {}
    row["direct_confidence"] = abs(direct_probability - 0.5) if np.isfinite(direct_probability) else 0.0
    row["proposal_direct_agreement"] = float(proposal * direct_direction)

    pm_mid_centered = float(raw.get("pm_mid_centered", 0.0) or 0.0)
    pm_valid = float(raw.get("pm_valid", 0.0) or 0.0)
    pm_abs_skew = float(raw.get("pm_abs_skew", 0.0) or 0.0)
    poly_sign = float(np.sign(pm_mid_centered))
    row["preopen_proposal_alignment"] = proposal * poly_sign * pm_valid
    row["pm_abs_skew"] = pm_abs_skew

    for venue in VENUES:
        for window in ("w001", "w003", "w005"):
            for f in ("return_bps", "flow_imbalance"):
                key = f"{venue}_t5_{window}_{f}"
                row[f"aligned_{key}"] = proposal * float(raw.get(key, 0.0) or 0.0)
        row[f"{venue}_t5_w005_range_bps"] = float(raw.get(f"{venue}_t5_w005_range_bps", 0.0) or 0.0)
        row[f"log1p_{venue}_t5_w005_quote_volume"] = float(
            raw.get(f"log1p_{venue}_t5_w005_quote_volume", 0.0) or 0.0
        )
    for column in CROSS_FIELDS:
        row[column] = float(raw.get(column, 0.0) or 0.0)

    c42_pred = int(raw.get("c42_prediction", 0) or 0)
    c42_stage = str(raw.get("c42_stage", "") or "")
    called = c42_pred != 0
    row["c42_called"] = float(called)
    row["c42_t0"] = float(called and "t0" in c42_stage.lower())
    row["c42_t5"] = float(called and "t5" in c42_stage.lower())
    # Verbatim column order from meta_matrix() in
    # build_c51_target_native_rebase_r1.py (c30, c36, c37, r4, external).
    for column in (
        "c30_prediction",
        "c36_prediction",
        "c37_prediction",
        "r4_prediction",
        "external_direction",
    ):
        row[f"proposal_agreement_{column}"] = float(proposal * int(raw.get(column, 0) or 0))


    for name in RAW_UPSTREAM_RANK_FIELDS:
        value = raw.get(name)
        available = value is not None and np.isfinite(value)
        row[f"{name}_centered"] = (float(value) if available else 0.5) - 0.5
        row[f"{name}_available"] = float(available)

    for key, value in row.items():
        if not np.isfinite(value):
            row[key] = 0.0
    return row


META_FEATURE_ORDER: list[str] = list(
    build_meta_feature_row(
        {name: 0.0 for name in REQUIRED_RAW_FIELDS}, direct_probability=0.5, proposal=0
    ).keys()
)


# ---------------------------------------------------------------------------
# Fitted state container
# ---------------------------------------------------------------------------


@dataclass
class FittedLinearHead:
    feature_order: list[str]
    imputation: np.ndarray
    center: np.ndarray
    scale: np.ndarray
    coef: np.ndarray
    intercept: float

    def predict_proba(self, feature_row: dict[str, float]) -> float:
        x = np.array([float(feature_row.get(name, np.nan)) for name in self.feature_order], dtype=float)
        return _apply_fitted_linear(x, self.imputation, self.center, self.scale, self.coef, self.intercept)


@dataclass
class C51FittedState:
    """Everything C51Expert.evaluate needs beyond the current candle.

    Produced by replaying history through C51WalkForward (below); never
    fabricated. `rank_history[+1]` / `rank_history[-1]` hold up to the last
    RANK_HISTORY meta-probabilities observed for calls proposing that side.
    """

    direction_head: FittedLinearHead
    meta_head: FittedLinearHead
    rank_history: dict[int, deque] = field(
        default_factory=lambda: {1: deque(maxlen=RANK_HISTORY), -1: deque(maxlen=RANK_HISTORY)}
    )


# ---------------------------------------------------------------------------
# Live, stateless-per-call expert
# ---------------------------------------------------------------------------


class C51Expert:
    """Live decision path for C51 (PRIMARY = C42-or-direct meta @ 0.58 rank)."""

    def evaluate(self, packet: dict) -> dict:
        raw = packet.get("raw")
        fitted_state: C51FittedState | None = packet.get("fitted_state")
        if raw is None:
            raise C51InputError("C51 packet missing 'raw' candle features")
        if fitted_state is None:
            raise C51InputError(
                "C51 packet missing 'fitted_state' (walk-forward direction/meta "
                "heads and rank history) -- C51 has no static fitted parameters "
                "and cannot be evaluated without a replayed model. See "
                "C51WalkForward for the training protocol."
            )
        missing = [f for f in REQUIRED_RAW_FIELDS if f not in raw or raw[f] is None]
        if missing:
            raise C51InputError(f"C51 packet missing required raw fields: {missing}")
        if not bool(raw.get("binance_complete", False)):
            # The frozen script never predicts direction on an incomplete
            # Binance packet (direction_predict eligibility gate).
            return {"c51_prediction": 0, "c51_reliability_rank": 0.0}

        missing_poly = [f for f in OPTIONAL_POLY_FIELDS if f not in raw]
        if missing_poly:
            # Faithful degraded fallback identical to the original left-join
            # behaviour for a missing pre-open book row.
            for f in OPTIONAL_POLY_FIELDS:
                raw.setdefault(f, 0.0)
            raw["pm_valid"] = 0.0

        direction_features_row = np.array(
            [float(raw.get(name, np.nan)) for name in DIRECTION_FEATURES], dtype=float
        )
        direct_probability = _apply_fitted_linear(
            direction_features_row,
            fitted_state.direction_head.imputation,
            fitted_state.direction_head.center,
            fitted_state.direction_head.scale,
            fitted_state.direction_head.coef,
            fitted_state.direction_head.intercept,
        )
        direct_side = direction_from_probability(direct_probability)
        c42_pred = int(raw.get("c42_prediction", 0) or 0)
        proposal = c42_pred if c42_pred != 0 else direct_side
        if proposal == 0:
            return {"c51_prediction": 0, "c51_reliability_rank": 0.0}

        meta_row = build_meta_feature_row(raw, direct_probability, proposal)
        probability_correct = fitted_state.meta_head.predict_proba(meta_row)

        rank = directional_rank_update(fitted_state.rank_history, proposal, probability_correct)
        # Update rank history AFTER reading rank, matching the frozen
        # sequential loop ordering.
        fitted_state.rank_history[proposal].append(probability_correct)

        if rank is not None and rank >= PRIMARY_THRESHOLD:
            prediction = int(proposal)
        else:
            prediction = 0
        return {
            "c51_prediction": prediction,
            "c51_reliability_rank": float(rank) if rank is not None else 0.0,
        }


# ---------------------------------------------------------------------------
# Training / replay protocol (produces fitted state; also used for parity
# testing against historical ledgers). This is a direct transcription of
# walk_forward_probability / fit_meta / build_prediction in
# build_c51_target_native_rebase_r1.py, restructured to also emit the fitted
# FittedLinearHead for each daily refit boundary.
# ---------------------------------------------------------------------------


def day_balanced_weights(timestamps: pd.Series) -> np.ndarray:
    days = timestamps.dt.strftime("%Y-%m-%d")
    counts = days.value_counts()
    weights = days.map(1.0 / counts).to_numpy(float)
    return weights / weights.mean()


class C51WalkForward:
    """Replays the frozen walk-forward protocol over a historical frame.

    `frame` must contain: ts (tz-aware, 15-min grid), label (in {-1,0,1} or
    NaN), binance_complete, c42_prediction/c42_stage, all DIRECTION_FEATURES,
    and all RAW_UPSTREAM_* fields. Polymarket POLY_FIELDS are optional and
    zero-filled/pm_valid=False when absent (see report: this makes any
    result for a frame lacking real Polymarket history a documented
    approximation of the frozen ledger, not a guaranteed bit-match).
    """

    def __init__(self, frame: pd.DataFrame):
        self.frame = frame.reset_index(drop=True)
        for col in POLY_FIELDS:
            if col not in self.frame.columns:
                self.frame[col] = 0.0
        self.frame["pm_valid"] = pd.to_numeric(self.frame["pm_valid"], errors="coerce").fillna(0.0)
        for col in POLY_FIELDS[:-1]:
            self.frame[col] = pd.to_numeric(self.frame[col], errors="coerce").fillna(0.0)
        if "c42_stage" not in self.frame.columns:
            self.frame["c42_stage"] = ""
        self.frame["c42_stage"] = self.frame["c42_stage"].fillna("").astype(str)

    def _walk_forward_probability(self, matrix: pd.DataFrame, target: np.ndarray,
                                   train_eligible: np.ndarray, predict_eligible: np.ndarray) -> np.ndarray:
        frame = self.frame
        x = matrix.to_numpy(float)
        x[~np.isfinite(x)] = np.nan
        target = np.asarray(target, dtype=float)
        probability = np.full(len(frame), np.nan)

        for block_start in range(0, len(frame), REFIT_ROWS):
            train_start = max(0, block_start - WINDOW)
            train_index = np.arange(train_start, block_start)
            keep = train_eligible[train_index] & np.isfinite(target[train_index])
            train_index = train_index[keep]
            if len(train_index) < MINIMUM:
                continue
            y = target[train_index].astype(np.int8)
            if set(np.unique(y)) != {0, 1}:
                continue
            train_x = x[train_index].copy()
            imputation = np.nanmedian(train_x, axis=0)
            imputation[~np.isfinite(imputation)] = 0.0
            train_x = np.where(np.isfinite(train_x), train_x, imputation)
            scaler = RobustScaler(quantile_range=(10, 90))
            train_scaled = scaler.fit_transform(train_x)
            model = LogisticRegression(C=C_VALUE, solver="lbfgs", max_iter=5_000, random_state=51)
            model.fit(train_scaled, y, sample_weight=day_balanced_weights(frame["ts"].iloc[train_index]))
            block_end = min(block_start + REFIT_ROWS, len(frame))
            predict_index = np.arange(block_start, block_end)
            predict_index = predict_index[predict_eligible[predict_index]]
            if len(predict_index):
                predict_x = x[predict_index].copy()
                predict_x = np.where(np.isfinite(predict_x), predict_x, imputation)
                probability[predict_index] = model.predict_proba(scaler.transform(predict_x))[:, 1]
        return probability

    def run(self) -> pd.DataFrame:
        frame = self.frame
        label = frame["label"].to_numpy(float)
        direction_target = np.where(np.isin(label, [-1, 1]), (label > 0).astype(float), np.nan)
        binance_complete = frame["binance_complete"].to_numpy(bool)
        direction_train = binance_complete & np.isin(label, [-1, 1])
        direction_predict = binance_complete

        direction_matrix = frame[list(DIRECTION_FEATURES)].astype(float).replace([np.inf, -np.inf], np.nan)
        direct_probability = self._walk_forward_probability(
            direction_matrix, direction_target, direction_train, direction_predict
        )
        direct_side = np.where(np.isfinite(direct_probability), np.where(direct_probability >= 0.5, 1, -1), 0).astype(np.int8)
        c42 = frame["c42_prediction"].to_numpy(np.int8)
        proposal = np.where(c42 != 0, c42, direct_side).astype(np.int8)

        meta_rows = [
            build_meta_feature_row(frame.iloc[i].to_dict(), direct_probability[i], int(proposal[i]))
            for i in range(len(frame))
        ]
        meta_matrix = pd.DataFrame(meta_rows, columns=META_FEATURE_ORDER)
        meta_target = np.where(
            np.isin(label, [-1, 1]) & (proposal != 0), (proposal == label).astype(float), np.nan
        )
        meta_eligible = binance_complete & np.isfinite(direct_probability) & (proposal != 0)
        probability_correct = self._walk_forward_probability(meta_matrix, meta_target, meta_eligible, meta_eligible)

        rank = np.full(len(frame), np.nan)
        history: dict[int, deque] = {1: deque(maxlen=RANK_HISTORY), -1: deque(maxlen=RANK_HISTORY)}
        for i, (value, side) in enumerate(zip(probability_correct, proposal)):
            side = int(side)
            r = directional_rank_update(history, side, value)
            if r is not None:
                rank[i] = r
            if side in (1, -1) and np.isfinite(value):
                history[side].append(float(value))

        prediction = np.where(np.isfinite(rank) & (rank >= PRIMARY_THRESHOLD), proposal, 0).astype(np.int8)
        return pd.DataFrame(
            {
                "ts": frame["ts"],
                "direct_probability": direct_probability,
                "proposal": proposal,
                "probability_correct": probability_correct,
                "c51_reliability_rank": np.where(np.isfinite(rank), rank, 0.0),
                "c51_prediction": prediction,
            }
        )
