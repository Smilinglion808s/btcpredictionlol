"""T0_LONG_CONTEXT_R1 (`ALL_HGB`) - the real producer of the long-context
probability that feeds `external_direction` / `external_rank`.

Source of truth (recovered, unmodified):
  external_research/long_context_model.py   - the head, schedule and splits
  external_research/build_long_context_features.py - the 543-column frame
  external_research/long_context_feature_audit.json - identity
      T0_LONG_EXTERNAL_CONTEXT_R1, 23,328 rows, 545 columns (543 features),
      2026-01-01T00:15Z .. 2026-09-01T00:00Z,
      feature_pickle_sha256 8618768fbdc0e776d8eadb7b0feb2c33625363edc8e8bf30b3f91633371fe1ca

What is transcribed here, verbatim from `long_context_model.py`:

* `feature_columns` - `feature_sets()` (lines 68-176) restricted to the
  ``ALL_HGB`` spec, i.e. ``PRICE + DEPTH + METRICS`` in that order, with the
  PRICE ordering, the `qlib_compact` filter, the DEPTH exclusion set and the
  20-bps band exclusion, and the METRICS filter all reproduced exactly.
* `day_balanced_weights` - `t5_precision_lab.day_balanced_weights` (93-97).
* `HGB_PARAMS` - `walk_forward_hgb` (lines 222-256): learning_rate 0.025,
  max_iter 70, max_leaf_nodes 7, min_samples_leaf 256, l2_regularization 50.0,
  random_state 0. Nothing here is tuned, searched or defaulted.
* `walk_forward_probability` - the batch loop itself, unchanged: refit every
  ``REFIT_EVERY = 96`` targets from ``MINIMUM = 5_760``, trailing
  ``WINDOW = 17_280`` targets, training rows restricted to feature-complete
  rows with a finite non-zero label, prediction only on feature-complete rows,
  NaN everywhere else. Those NaN rows are exactly the rows that reach the leaf
  contract as `MODEL_NO_PROBABILITY`.
* `LongContextHead` - the same computation driven one target at a time, so the
  live worker never rebuilds history. `test_long_context_head.py` pins the
  incremental head against the batch loop row for row.

What is NOT here, and is the remaining blocker for live probabilities:

* the fitted state itself. There is no recovered `T0_LONG_CONTEXT_R1` fitted
  artifact and no recovered `long_context_features.pkl`; the frame is rebuilt
  only from `external_research/binance_context_2026/` (spot_1m, futures_1m,
  mark_1m, index_1m, premium_1m, bookDepth, metrics), which is absent from the
  recovered tree. See `docs/long_context_reconstruction.md` for the exact
  files, ranges and acquisition route.

So `LongContextHead` refuses to emit a probability until it has been fitted
from real rows, and the leaf keys stay fail-closed. This module never
substitutes the c30/c70 `BINANCE_HYPERLIQUID` probability, which is a
different producer over different features.
"""
from __future__ import annotations

import re
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

import numpy as np
import pandas as pd

HEAD_ID = "T0_LONG_CONTEXT_R1"
SPEC_NAME = "ALL_HGB"

# long_context_model.py lines 33-39 - frozen, not configurable.
WINDOW = 17_280      # trailing 180 days of 15-minute opportunities
MINIMUM = 5_760      # at least 60 days
REFIT_EVERY = 96

HGB_PARAMS: dict[str, Any] = {
    "learning_rate": 0.025,
    "max_iter": 70,
    "max_leaf_nodes": 7,
    "min_samples_leaf": 256,
    "l2_regularization": 50.0,
    "random_state": 0,
}

_QLIB_COMPACT_PREFIXES = (
    "qlib_k", "qlib_beta_", "qlib_rsqr_", "qlib_resi_", "qlib_rank_", "qlib_rsv_",
    "qlib_imxd_", "qlib_cord_", "qlib_cntd_", "qlib_sumd_", "qlib_vstd_", "qlib_wvma_",
)
_DEPTH_EXCLUDED = {
    "book_snapshot_count",
    "book_negative_coherence",
    "book_positive_coherence",
    "book_bid_inner_share",
    "book_ask_inner_share",
    "book_negative_band_count",
    "book_mean_imbalance",
    "book_imbalance_dispersion",
}
_METRICS_EXCLUDED = {"metric_ts", "metric_age_at_target_seconds"}


class LongContextNotFitted(RuntimeError):
    """Raised when a probability is requested before any real fit exists."""


class LongContextSchemaError(RuntimeError):
    """Raised when the incoming frame/packet does not carry the exact schema."""


def feature_sets(columns: Sequence[str]) -> dict[str, list[str]]:
    """`long_context_model.feature_sets`, taking the column list directly."""

    columns = list(columns)
    qlib = [c for c in columns if c.startswith("qlib_")]
    qlib_compact = [
        c
        for c in qlib
        if c.startswith(_QLIB_COMPACT_PREFIXES)
        and (not c.rsplit("_", 1)[-1].isdigit() or int(c.rsplit("_", 1)[-1]) in {5, 20, 60})
    ]
    price: list[str] = []
    for prefix in ("spot", "fut"):
        for window in (1, 3, 5, 10, 15):
            price.extend(
                [
                    f"{prefix}_ret_{window}m_bps",
                    f"{prefix}_range_{window}m_bps",
                    f"{prefix}_rv_{window}m_bps",
                    f"{prefix}_efficiency_{window}m",
                    f"{prefix}_close_location_{window}m",
                    f"{prefix}_slope_{window}m_bps",
                    f"{prefix}_linearity_{window}m",
                    f"{prefix}_residual_{window}m_bps",
                    f"{prefix}_flow_{window}m",
                    f"{prefix}_log_quote_{window}m",
                    f"{prefix}_log_trades_{window}m",
                ]
            )
        price.extend(
            [
                f"{prefix}_body_range",
                f"{prefix}_return_autocorr_1",
                f"{prefix}_sign_balance",
                f"{prefix}_late_quote_share_5m",
                f"{prefix}_flow_delta_3_15",
            ]
        )
    for window in (1, 3, 5, 10, 15):
        price.extend(
            [
                f"cross_ret_spot_minus_fut_{window}m",
                f"cross_ret_spot_fut_agreement_{window}m",
                f"cross_flow_spot_minus_fut_{window}m",
                f"cross_flow_spot_fut_agreement_{window}m",
            ]
        )
    price.extend(
        [
            "cross_futures_basis_bps",
            "cross_mark_index_basis_bps",
            "cross_spot_mark_basis_bps",
            "cross_premium_close",
            "cross_basis_delta_1",
            "cross_mark_index_delta_1",
            "premium_mean_15m",
            "premium_std_15m",
            "premium_delta_1m",
            "premium_delta_5m",
            "premium_delta_15m",
            "premium_slope_15m",
            "premium_linearity_15m",
            "premium_residual_15m",
            "premium_positive_share_15m",
            "mark_ret_1m_bps",
            "mark_ret_5m_bps",
            "mark_ret_15m_bps",
            "index_ret_1m_bps",
            "index_ret_5m_bps",
            "index_ret_15m_bps",
            "session_sin_external",
            "session_cos_external",
            "dow_sin_external",
            "dow_cos_external",
            *qlib_compact,
        ]
    )
    depth = [
        c
        for c in columns
        if c.startswith("book_")
        and c not in _DEPTH_EXCLUDED
        and re.search(r"(?:^|_)20(?:_|$)", c) is None
    ]
    metrics = [
        c for c in columns if c.startswith("metric_") and c not in _METRICS_EXCLUDED
    ]
    sets = {
        "PRICE": list(dict.fromkeys(price)),
        "DEPTH": depth,
        "METRICS": metrics,
    }
    for name, chosen in sets.items():
        missing = sorted(set(chosen) - set(columns))
        if missing:
            raise LongContextSchemaError(f"Missing {name} features: {missing}")
    return sets


def feature_columns(columns: Sequence[str]) -> list[str]:
    """The ``ALL_HGB`` feature order: PRICE, then DEPTH, then METRICS."""

    sets = feature_sets(columns)
    return [*sets["PRICE"], *sets["DEPTH"], *sets["METRICS"]]


def day_balanced_weights(timestamps: pd.Series) -> np.ndarray:
    """`t5_precision_lab.day_balanced_weights` lines 93-97, verbatim."""

    dates = timestamps.dt.strftime("%Y-%m-%d")
    counts = dates.value_counts()
    weights = dates.map(1.0 / counts).to_numpy(float)
    return weights / weights.mean()


def _new_model():
    from sklearn.ensemble import HistGradientBoostingClassifier

    return HistGradientBoostingClassifier(**HGB_PARAMS)


def walk_forward_probability(
    frame: pd.DataFrame, features: Sequence[str]
) -> tuple[np.ndarray, int, str | None]:
    """`long_context_model.walk_forward_hgb`, unchanged.

    ``frame`` needs ``ts`` and ``label`` plus every feature column. NaN is
    returned for every row that is not feature-complete and for every row
    before the first fit.
    """

    features = list(features)
    x = frame[features].to_numpy(float)
    label = frame.label.to_numpy(float)
    target = (label > 0).astype(np.int8)
    complete = np.isfinite(x).all(axis=1)
    probability = np.full(len(frame), np.nan)
    fitted = None
    fit_count = 0
    first_fit: str | None = None
    for block_start in range(MINIMUM, len(frame), REFIT_EVERY):
        start = max(0, block_start - WINDOW)
        train = np.arange(start, block_start)
        train = train[complete[train] & np.isfinite(label[train]) & (label[train] != 0)]
        if len(train) >= MINIMUM and np.unique(target[train]).size == 2:
            fitted = _new_model()
            fitted.fit(
                x[train], target[train], sample_weight=day_balanced_weights(frame.ts.iloc[train])
            )
            fit_count += 1
            if first_fit is None:
                first_fit = frame.ts.iloc[block_start].isoformat()
        if fitted is None:
            continue
        end = min(block_start + REFIT_EVERY, len(frame))
        predict = np.arange(block_start, end)
        predict = predict[complete[predict]]
        if len(predict):
            probability[predict] = fitted.predict_proba(x[predict])[:, 1]
    return probability, fit_count, first_fit


@dataclass
class _Row:
    ts: pd.Timestamp
    values: np.ndarray
    complete: bool
    label: float


@dataclass
class LongContextHead:
    """The same walk-forward head, advanced one target at a time.

    Live ordering, which the batch loop hides:

    * the label of target ``T`` is the Spot candle that *begins* at ``T``, so it
      only exists at ``T+15m``. Every training row a refit can use is at least
      one target old, so the schedule is unaffected - but the caller must call
      :meth:`settle_label` for each target once its candle closes, and a row
      whose label never settled is simply not trainable (identical to the
      original's ``isfinite(label)`` filter).
    * a refit happens on the target whose position is a multiple of
      ``REFIT_EVERY`` counted from the series start, once ``MINIMUM`` positions
      have passed - exactly the ``range(MINIMUM, n, REFIT_EVERY)`` grid.

    ``probability(...)`` returns ``None`` (not 0.5, not a guess) whenever the
    original would have written NaN: no fit yet, or the row is not
    feature-complete.
    """

    features: list[str]
    buffer: deque[_Row] = field(default_factory=deque)
    position: int = 0
    fit_count: int = 0
    first_fit_ts: str | None = None
    model: Any = None
    _labels_by_ts: dict[pd.Timestamp, float] = field(default_factory=dict)
    _last_ts: pd.Timestamp | None = None
    _last_probability: float | None = None

    def __post_init__(self) -> None:
        self.features = list(self.features)
        if not self.features:
            raise LongContextSchemaError("LongContextHead requires the ALL_HGB feature list")

    # -- inputs -------------------------------------------------------------
    def _vector(self, row: dict[str, Any]) -> np.ndarray:
        missing = [f for f in self.features if f not in row]
        if missing:
            raise LongContextSchemaError(
                f"packet is missing {len(missing)} ALL_HGB features, first: {missing[:5]}"
            )
        return np.asarray([float(row[f]) if row[f] is not None else np.nan
                           for f in self.features], dtype=float)

    def settle_label(self, ts: pd.Timestamp, label: float) -> None:
        """Record the realised Spot-candle sign for an already-observed target.

        Idempotent by timestamp. A *conflicting* re-settlement is refused rather
        than silently changing training data underneath an already-issued fit.
        """

        ts = pd.Timestamp(ts)
        label = float(label)
        previous = self._labels_by_ts.get(ts)
        if previous is not None and np.isfinite(previous) and previous != label:
            raise LongContextOrderError(
                f"conflicting label for {ts.isoformat()}: {previous} then {label}"
            )
        self._labels_by_ts[ts] = label
        for row in self.buffer:
            if row.ts == ts:
                row.label = label
                break
        self._prune_labels()

    def _prune_labels(self) -> None:
        """Keep the label map bounded by the retained window, not by history."""

        if not self.buffer:
            return
        oldest = self.buffer[0].ts
        for key in [k for k in self._labels_by_ts if k < oldest]:
            del self._labels_by_ts[key]

    def observe(self, ts: pd.Timestamp, row: dict[str, Any]) -> float | None:
        """Advance one target: refit when due, then score this row.

        Returns the probability, or ``None`` where the original writes NaN.

        Ordering is enforced, because the walk-forward grid is positional: an
        out-of-order target would silently shift every future refit boundary. A
        repeat of the current target is treated as a retry and replays the
        recorded probability without advancing the grid or duplicating the row.
        """

        ts = pd.Timestamp(ts)
        if self._last_ts is not None:
            if ts == self._last_ts:
                return self._last_probability
            if ts < self._last_ts:
                raise LongContextOrderError(
                    f"target {ts.isoformat()} precedes the last observed "
                    f"{self._last_ts.isoformat()}; the refit grid is positional"
                )
        values = self._vector(row)
        complete = bool(np.isfinite(values).all())

        if self.position >= MINIMUM and self.position % REFIT_EVERY == 0:
            self._refit(ts)

        self.buffer.append(
            _Row(ts, values, complete, float(self._labels_by_ts.get(ts, np.nan)))
        )
        while len(self.buffer) > WINDOW:
            self.buffer.popleft()
        self._prune_labels()
        self.position += 1
        self._last_ts = ts

        if self.model is None or not complete:
            self._last_probability = None
            return None
        self._last_probability = float(self.model.predict_proba(values.reshape(1, -1))[0, 1])
        return self._last_probability


    # -- fitting ------------------------------------------------------------
    def _refit(self, ts: pd.Timestamp) -> None:
        rows = [
            r for r in self.buffer
            if r.complete and np.isfinite(r.label) and r.label != 0
        ]
        if len(rows) < MINIMUM:
            return
        target = np.asarray([1 if r.label > 0 else 0 for r in rows], dtype=np.int8)
        if np.unique(target).size != 2:
            return
        x = np.vstack([r.values for r in rows])
        weights = day_balanced_weights(pd.Series([r.ts for r in rows]))
        model = _new_model()
        model.fit(x, target, sample_weight=weights)
        self.model = model
        self.fit_count += 1
        if self.first_fit_ts is None:
            self.first_fit_ts = ts.isoformat()

    # -- serialisation ------------------------------------------------------
    def state_summary(self) -> dict[str, Any]:
        """Restart-relevant counters. The fitted model is exported separately
        by the release builder; this is deliberately not a pickle dump."""

        return {
            "head_id": HEAD_ID,
            "spec": SPEC_NAME,
            "feature_count": len(self.features),
            "position": self.position,
            "buffered_rows": len(self.buffer),
            "fit_count": self.fit_count,
            "first_fit_ts": self.first_fit_ts,
            "fitted": self.model is not None,
            "last_ts": self.buffer[-1].ts.isoformat() if self.buffer else None,
        }


def head_from_frame(frame: pd.DataFrame) -> LongContextHead:
    """Build a head for the exact schema of a recovered feature frame."""

    return LongContextHead(features=feature_columns(list(frame.columns)))


def replay(head: LongContextHead, frame: pd.DataFrame) -> np.ndarray:
    """Drive ``head`` chronologically over a frame, settling labels causally."""

    out = np.full(len(frame), np.nan)
    records: list[dict[str, Any]] = frame.to_dict("records")
    for index, record in enumerate(records):
        if index >= 1:
            previous = records[index - 1]
            head.settle_label(previous["ts"], previous["label"])
        value = head.observe(record["ts"], record)
        if value is not None:
            out[index] = value
    return out


def frames_to_records(frame: pd.DataFrame) -> Iterable[dict[str, Any]]:
    return frame.to_dict("records")
