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

import json
import os
import re
import shutil
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

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


class LongContextOrderError(RuntimeError):
    """Raised on an out-of-order target or a conflicting label re-settlement."""


class LongContextConflict(RuntimeError):
    """Raised when the same target is re-presented with a different payload."""

    def __init__(self, message: str, *, original: float | None = None) -> None:
        super().__init__(message)
        self.original = original


class LongContextFenceError(RuntimeError):
    """Raised when a staged head update no longer matches the head version."""


class LongContextTrainingRequired(RuntimeError):
    """Raised when a refit is due on the serving path and no fit was staged.

    The original schedule is preserved exactly: the fit that becomes effective
    at a refit position must exist *before* that position is served. Training
    is performed by :meth:`LongContextHead.train_ahead`, off the timed path.
    """

STALE_BOOK_SECONDS = 60


def prepare_external_frame(frame: pd.DataFrame) -> pd.DataFrame:
    """`long_context_model.load_external` lines 53-67, verbatim behaviour.

    The derived feature frame is NOT the model's input frame. Before any
    selection or fitting the original applies three steps that were previously
    missing from this transcription, and that materially change both which rows
    are feature-complete and what the model sees:

    1. every ``book_*`` column is set to NaN on a row whose depth snapshot is
       older than 60 seconds or missing its age entirely (a stale book is not
       evidence about the target),
    2. ``book_fresh_within_60s`` is appended as the indicator of that decision -
       it is the 324th feature of ``T0_LONG_CONTEXT_R1_FREEZE`` and the last
       ``DEPTH`` column, and
    3. infinities become NaN.

    The frame is returned sorted by ``ts`` with a fresh positional index, and
    the input is not mutated.
    """

    frame = frame.rename(columns={"target_ts": "ts"}).copy()
    frame["ts"] = pd.to_datetime(frame.ts, utc=True)
    frame = frame.sort_values("ts").reset_index(drop=True)
    age = frame["book_final_age_seconds"]
    stale_book = age.gt(STALE_BOOK_SECONDS) | age.isna()
    book_columns = [column for column in frame.columns if column.startswith("book_")]
    frame.loc[stale_book, book_columns] = np.nan
    frame["book_fresh_within_60s"] = (~stale_book).astype(float)
    if "binance_label" in frame.columns:
        frame["label"] = pd.to_numeric(frame.binance_label, errors="coerce")
    frame = frame.replace([np.inf, -np.inf], np.nan)
    return frame


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
    pos: int = -1


# A label that has not settled yet is *pending*: bounded, never unbounded.
MAX_PENDING_LABELS = REFIT_EVERY * 4

# The settling candle of target ``T`` is the Spot candle that *begins* at ``T``.
LABEL_CANDLE = pd.Timedelta(minutes=15)
LABEL_SOURCES = frozenset({"binance_spot_1m"})

# The recovered generator is
#     frame["binance_label"] = np.where(contiguous, np.sign(next_close - next_open), np.nan)
# (`build_long_context_features.py`). So the domain is exactly the sign set,
# with 0.0 a genuine PUSH (flat candle, excluded from training by the original's
# ``label != 0`` filter), and NaN reserved for one thing only: the original
# source was NOT contiguous over the settling candle. A label that has simply
# not been received yet is NOT a NaN - it is unresolved, and it blocks the fit.
LABEL_DOMAIN = (-1.0, 0.0, 1.0)


def _payload_digest(values: np.ndarray) -> str:
    import hashlib

    return hashlib.sha256(np.ascontiguousarray(values, dtype=float).tobytes()).hexdigest()


def _sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    import hashlib

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            block = handle.read(chunk)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


@dataclass(frozen=True)
class TrainingSnapshot:
    """The immutable set of inputs one refit boundary is entitled to use.

    A fit is certified for exactly one boundary and exactly one snapshot. If any
    relevant training input changes (a new row, a newly settled or corrected
    label, a schema change), the digest changes and the staged fit is stale: it
    is rejected and rebuilt off the timed path rather than silently activated.

    ``complete`` is the eligibility gate. The boundary's entitled window is
    ``[window_first_position, position)``; the snapshot is complete only when
    every one of those positions is retained AND resolved - resolved meaning
    either a settled in-domain label or an *evidenced* original source gap. A
    label that has merely not arrived yet leaves the snapshot incomplete, and
    an incomplete snapshot may not be fitted or certified "no fit".
    """

    position: int
    grid_origin: tuple[int, int, int]        # (MINIMUM, REFIT_EVERY, WINDOW)
    first_position: int
    last_position: int
    training_rows: int
    cutoff_ts: str | None
    label_watermark: str | None
    unsettled_positions: int
    schema_digest: str
    # Full-window evidence and provenance, all bound into ``digest``.
    window_first_position: int
    window_last_position: int
    expected_positions: int
    retained_positions: int
    resolved_positions: int
    missing_source_positions: int
    push_positions: int
    unresolved_positions: tuple[int, ...]
    provenance_digest: str
    # The effective boundary clock: the instant the boundary at ``position``
    # occurs (the final entitled row's settling candle close). A label whose
    # receipt is dated after this instant was not knowable at the boundary.
    boundary_clock: str | None
    future_known_positions: tuple[int, ...]
    complete: bool
    digest: str


@dataclass
class StagedFit:
    """A fit produced off the serving path for one specific refit position."""

    position: int
    model: Any
    fit_id: str
    training_rows: int
    cutoff_ts: str | None
    snapshot: TrainingSnapshot | None = None



@dataclass
class HeadUpdate:
    """A fully staged head advance. Nothing is mutated until :meth:`commit`."""

    head: "LongContextHead"
    ts: pd.Timestamp
    values: np.ndarray
    complete: bool
    probability: float | None
    expected_version: int
    activate: StagedFit | None = None
    replay: bool = False
    committed: bool = False
    digest: str = ""

    def validate(self) -> None:
        if self.head.version != self.expected_version:
            raise LongContextFenceError(
                f"head moved from version {self.expected_version} to {self.head.version}"
            )

    def commit(self) -> float | None:
        if self.committed:
            raise LongContextFenceError("this head update was already committed")
        self.validate()
        if self.replay:
            self.committed = True
            return self.probability
        self.head._apply(self)
        self.committed = True
        return self.probability

    def rollback(self) -> None:
        """Explicitly discard a staged update. Present for call-site clarity;
        preparation never mutated anything, so this only marks it spent."""

        self.committed = True


@dataclass
class LongContextHead:
    """The same walk-forward head, advanced one target at a time.

    Live ordering, which the batch loop hides:

    * the label of target ``T`` is the Spot candle that *begins* at ``T``, so it
      only exists at ``T+15m``. Every training row a refit can use is at least
      one target old, so the schedule is unaffected - but the caller must call
      :meth:`settle_label` for each target once its candle closes *and* the
      original source has actually published it, and a row whose label never
      settled is simply not trainable (identical to the original's
      ``isfinite(label)`` filter).
    * a refit happens on the target whose position is a multiple of
      ``REFIT_EVERY`` counted from the series start, once ``MINIMUM`` positions
      have passed - exactly the ``range(MINIMUM, n, REFIT_EVERY)`` grid.

    Serving uses :meth:`prepare` / :meth:`HeadUpdate.commit`: the probability is
    computed against a staged fit and a staged row, and the head only moves once
    the downstream decision/checkpoint transaction succeeds. Training itself is
    :meth:`train_ahead`, which runs off the timed path and produces the fit that
    the *next* scheduled refit position will activate - the original schedule and
    effective cutoffs are unchanged, nothing is frozen and nothing is delayed.

    ``probability`` is ``None`` (not 0.5, not a guess) whenever the original
    would have written NaN: no fit yet, or the row is not feature-complete.
    """

    features: list[str]
    buffer: deque[_Row] = field(default_factory=deque)
    position: int = 0
    fit_count: int = 0
    first_fit_ts: str | None = None
    model: Any = None
    fit_id: str | None = None
    version: int = 0
    _labels_by_ts: dict[pd.Timestamp, float] = field(default_factory=dict)
    _label_available_at: dict[pd.Timestamp, str] = field(default_factory=dict)
    # Targets whose label is an *original* NaN: the source was not contiguous
    # over the settling candle. Recorded with evidence, never inferred from a
    # label that simply has not arrived.
    _missing_labels: dict[pd.Timestamp, str] = field(default_factory=dict)
    _last_ts: pd.Timestamp | None = None
    _last_probability: float | None = None
    _last_digest: str | None = None
    _staged_fit: StagedFit | None = None
    # position -> snapshot digest under which "no fit is possible" was observed.
    # Keyed by digest so that a later, richer snapshot re-opens eligibility.
    _no_fit_positions: dict[int, str] = field(default_factory=dict)

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

    def settle_label(
        self,
        ts: pd.Timestamp,
        label: float,
        *,
        available_at: pd.Timestamp,
        as_of: pd.Timestamp | None = None,
        source: str = "binance_spot_1m",
    ) -> None:
        """Record a realised Spot-candle sign that the source has published.

        ``available_at`` is when the original source made the settling candle
        observable; ``as_of`` is the clock the caller is settling at. Accepted
        only when all of the following hold, matching the original's data
        domain rather than merely "a finite number at some timestamp":

        * ``source`` is an original label source (``LABEL_SOURCES``);
        * ``available_at`` is at or after the settling candle's close
          (``ts + 15m``) - the candle simply does not exist before then;
        * ``available_at <= as_of`` - the caller cannot settle from the future;
        * ``ts`` is a target this head actually observed and still retains.

        Idempotent: an *identical* re-settlement is a no-op and does not bump
        the version, so it cannot invalidate an in-flight prepared update. A
        *conflicting* re-settlement is refused rather than silently changing
        training data underneath an already-issued fit.
        """

        ts, available_at, as_of = self._temporal(ts, available_at, as_of)
        if source not in LABEL_SOURCES:
            raise LongContextOrderError(
                f"label source {source!r} is not an original source {sorted(LABEL_SOURCES)}"
            )
        if available_at < ts + LABEL_CANDLE:
            raise LongContextOrderError(
                f"label for {ts.isoformat()} cannot be available at "
                f"{available_at.isoformat()}; its candle closes at "
                f"{(ts + LABEL_CANDLE).isoformat()}"
            )
        if available_at > as_of:
            raise LongContextOrderError(
                f"label for {ts.isoformat()} is not available until "
                f"{available_at.isoformat()} (as_of {as_of.isoformat()})"
            )
        if self._last_ts is None or ts > self._last_ts:
            raise LongContextOrderError(
                f"label for {ts.isoformat()} precedes any observed target; "
                "the original never trains on unobserved rows"
            )
        row = next((r for r in self.buffer if r.ts == ts), None)
        if row is None:
            raise LongContextOrderError(
                f"target {ts.isoformat()} is not a retained observed target; "
                "the original never labels rows outside the trailing window"
            )
        label = float(label)
        if label not in LABEL_DOMAIN:
            raise LongContextOrderError(
                f"label {label!r} for {ts.isoformat()} is outside the recovered "
                f"generator's domain {LABEL_DOMAIN} (sign of the settling candle; "
                "0.0 is a PUSH). A non-contiguous source is settle_missing_label(), "
                "not an arbitrary number"
            )
        if ts in self._missing_labels:
            raise LongContextOrderError(
                f"target {ts.isoformat()} was already recorded as an original source "
                "gap; it cannot also carry a settled label"
            )
        stamp = f"{available_at.isoformat()}|{source}"
        previous = self._labels_by_ts.get(ts)
        if previous is not None and np.isfinite(previous):
            if previous != label:
                raise LongContextOrderError(
                    f"conflicting label for {ts.isoformat()}: {previous} then {label}"
                )
            if self._label_available_at.get(ts) == stamp:
                return  # identical duplicate: no state change, no version bump
        if previous is None and len(self._labels_by_ts) >= MAX_PENDING_LABELS + WINDOW:
            raise LongContextOrderError("pending label map exceeded its bound")
        self._labels_by_ts[ts] = label
        self._label_available_at[ts] = stamp
        row.label = label
        self._prune_labels()
        self.version += 1

    def settle_missing_label(
        self,
        ts: pd.Timestamp,
        *,
        available_at: pd.Timestamp,
        as_of: pd.Timestamp | None = None,
        source: str = "binance_spot_1m",
        reason: str,
    ) -> None:
        """Record an *original* NaN: the source was not contiguous at ``ts``.

        This is the only way a target becomes permanently unlabelled. It needs
        the same temporal evidence as a settled label plus an explicit
        source-completeness reason, so that a label which has merely not been
        received yet can never be mistaken for the original's NaN.
        """

        ts, available_at, as_of = self._temporal(ts, available_at, as_of)
        if source not in LABEL_SOURCES:
            raise LongContextOrderError(
                f"label source {source!r} is not an original source {sorted(LABEL_SOURCES)}"
            )
        if not reason or not str(reason).strip():
            raise LongContextOrderError(
                "an original source gap needs explicit source-completeness evidence"
            )
        if available_at < ts + LABEL_CANDLE:
            raise LongContextOrderError(
                f"the gap at {ts.isoformat()} cannot be evidenced before its candle "
                f"closes at {(ts + LABEL_CANDLE).isoformat()}"
            )
        if available_at > as_of:
            raise LongContextOrderError(
                f"gap evidence for {ts.isoformat()} is dated in the future"
            )
        row = next((r for r in self.buffer if r.ts == ts), None)
        if row is None:
            raise LongContextOrderError(
                f"target {ts.isoformat()} is not a retained observed target"
            )
        settled = self._labels_by_ts.get(ts)
        if settled is not None and np.isfinite(settled):
            raise LongContextOrderError(
                f"target {ts.isoformat()} already settled to {settled}; it cannot "
                "become an original source gap"
            )
        stamp = f"{available_at.isoformat()}|{source}|{reason}"
        if self._missing_labels.get(ts) == stamp:
            return  # identical duplicate
        self._missing_labels[ts] = stamp
        row.label = float("nan")
        self._prune_labels()
        self.version += 1

    @staticmethod
    def _temporal(ts, available_at, as_of):
        """Coerce and validate the three timestamps; NaT is never a timestamp."""

        ts = pd.Timestamp(ts)
        available_at = pd.Timestamp(available_at)
        as_of = pd.Timestamp(as_of) if as_of is not None else available_at
        for name, value in (("ts", ts), ("available_at", available_at), ("as_of", as_of)):
            if value is pd.NaT or pd.isna(value):
                raise LongContextOrderError(f"{name} is NaT; a label needs a real timestamp")
        return ts, available_at, as_of

    def _prune_labels(self) -> None:
        """Keep the label map bounded by the retained window, not by history."""

        if not self.buffer:
            return
        oldest = self.buffer[0].ts
        for key in [k for k in self._labels_by_ts if k < oldest]:
            del self._labels_by_ts[key]
            self._label_available_at.pop(key, None)
        for key in [k for k in self._missing_labels if k < oldest]:
            del self._missing_labels[key]

    # -- serving path (no training, no mutation) ----------------------------
    def refit_due_at(self) -> int | None:
        """The next positional refit boundary of the original grid."""

        if self.position < MINIMUM:
            return MINIMUM
        remainder = self.position % REFIT_EVERY
        return self.position if remainder == 0 else self.position + (REFIT_EVERY - remainder)

    def prepare(self, ts: pd.Timestamp, row: dict[str, Any]) -> HeadUpdate:
        """Stage one target advance without touching any head state."""

        ts = pd.Timestamp(ts)
        values = self._vector(row)
        digest = _payload_digest(values)
        if self._last_ts is not None:
            if ts == self._last_ts:
                if self._last_digest is not None and digest != self._last_digest:
                    raise LongContextConflict(
                        f"target {ts.isoformat()} was re-presented with a different "
                        "feature payload; refusing to reuse the recorded probability",
                        original=self._last_probability,
                    )
                return HeadUpdate(
                    head=self, ts=ts, values=values, complete=bool(np.isfinite(values).all()),
                    probability=self._last_probability, expected_version=self.version,
                    replay=True, digest=digest,
                )
            if ts < self._last_ts:
                raise LongContextOrderError(
                    f"target {ts.isoformat()} precedes the last observed "
                    f"{self._last_ts.isoformat()}; the refit grid is positional"
                )
        complete = bool(np.isfinite(values).all())

        activate: StagedFit | None = None
        model = self.model
        if self.position >= MINIMUM and self.position % REFIT_EVERY == 0:
            snapshot = self.training_snapshot(self.position, copy=False)
            staged = self._staged_fit
            usable = (
                staged is not None
                and staged.position == self.position
                and staged.snapshot is not None
                and staged.snapshot.digest == snapshot.digest
            )
            if not usable:
                if self._no_fit_positions.get(self.position) == snapshot.digest:
                    pass  # certified "no fit possible" for exactly these inputs
                elif staged is not None and staged.position == self.position:
                    raise LongContextTrainingRequired(
                        f"the fit staged for position {self.position} was built from "
                        "different training inputs and is stale; rebuild it with "
                        "train_ahead() off the serving path"
                    )
                else:
                    raise LongContextTrainingRequired(
                        f"refit is due at position {self.position} and no fit was staged; "
                        "call train_ahead() off the serving path"
                    )
            elif staged is not None:
                activate = staged
                model = staged.model


        probability: float | None = None
        if model is not None and complete:
            probability = float(model.predict_proba(values.reshape(1, -1))[0, 1])
        return HeadUpdate(
            head=self, ts=ts, values=values, complete=complete, probability=probability,
            expected_version=self.version, activate=activate, digest=digest,
        )

    def _apply(self, update: HeadUpdate) -> None:
        if update.activate is not None:
            staged = update.activate
            self.model = staged.model
            self.fit_id = staged.fit_id
            self.fit_count += 1
            if self.first_fit_ts is None:
                self.first_fit_ts = update.ts.isoformat()
            self._staged_fit = None
        self.buffer.append(
            _Row(update.ts, update.values, update.complete,
                 float(self._labels_by_ts.get(update.ts, np.nan)), self.position)
        )
        while len(self.buffer) > WINDOW:
            self.buffer.popleft()
        self._prune_labels()
        self.position += 1
        # An eligibility verdict only survives while it is still in the future;
        # it is keyed by snapshot digest, so changed inputs re-open the boundary.
        self._no_fit_positions = {p: d for p, d in self._no_fit_positions.items()
                                  if p >= self.position}
        self._last_ts = update.ts
        self._last_probability = update.probability
        self._last_digest = update.digest
        self.version += 1

    def observe(self, ts: pd.Timestamp, row: dict[str, Any],
                *, allow_inline_training: bool = True) -> float | None:
        """Batch/replay convenience: stage, train inline if the grid demands a
        fit, and commit. The live worker uses :meth:`prepare` instead so that no
        training ever happens inside the timed boundary."""

        try:
            update = self.prepare(ts, row)
        except LongContextTrainingRequired:
            if not allow_inline_training:
                raise
            self.train_ahead()
            update = self.prepare(ts, row)
        return update.commit()

    # -- fitting (off the serving path) -------------------------------------
    def _capture(self, position: int, *, copy: bool = True
                 ) -> tuple[tuple[_Row, ...], TrainingSnapshot]:
        """Capture the boundary's rows ONCE and describe exactly those rows.

        The returned rows are immutable copies. The fit is produced from this
        captured tuple and the digest certifies the same tuple, so a label that
        settles between describing and fitting cannot produce a model whose
        certified snapshot is not the data it saw.
        """

        import hashlib

        captured = tuple(
            _Row(r.ts, np.array(r.values, dtype=float, copy=True), r.complete, r.label, r.pos)
            for r in self.buffer
        ) if copy else tuple(self.buffer)
        window_first = max(0, position - WINDOW)
        window_last = position - 1
        expected = max(0, position - window_first)
        retained = [r for r in captured if window_first <= r.pos <= window_last]
        resolved, unresolved, missing_source, push = [], [], 0, 0
        for r in retained:
            if r.ts in self._missing_labels:
                missing_source += 1
                resolved.append(r)
            elif np.isfinite(r.label):
                resolved.append(r)
                if r.label == 0:
                    push += 1
            else:
                unresolved.append(r.pos)
        # Positions inside the entitled window that are not retained at all.
        held = {r.pos for r in retained}
        gaps = [p for p in range(window_first, position) if p not in held]
        unresolved_all = tuple(sorted(unresolved + gaps))

        # Effective boundary clock: target ``position`` occurs one candle after
        # the final entitled row ``position-1``.
        boundary_clock = (retained[-1].ts + LABEL_CANDLE) if retained else None
        future_known = []
        for r in retained:
            stamp = self._label_available_at.get(r.ts) or self._missing_labels.get(r.ts)
            if not stamp or boundary_clock is None:
                continue
            received = pd.Timestamp(stamp.split("|", 1)[0])
            if received > boundary_clock:
                future_known.append(r.pos)
        future_known_positions = tuple(sorted(future_known))

        rows = tuple(r for r in retained
                     if r.complete and np.isfinite(r.label) and r.label != 0)
        schema_digest = hashlib.sha256("\n".join(self.features).encode()).hexdigest()
        provenance = hashlib.sha256()
        for r in retained:
            stamp = (self._label_available_at.get(r.ts)
                     or self._missing_labels.get(r.ts) or "UNRESOLVED")
            provenance.update(f"{r.pos}|{r.ts.isoformat()}|{r.label}|{stamp}\n".encode())
        provenance_digest = provenance.hexdigest()

        complete = not unresolved_all and len(retained) == min(expected, WINDOW)
        digest = hashlib.sha256()
        digest.update(
            f"{position}|{MINIMUM}|{REFIT_EVERY}|{WINDOW}|{schema_digest}|"
            f"{window_first}|{window_last}|{expected}|{len(retained)}|"
            f"{len(resolved)}|{missing_source}|{push}|{int(complete)}|"
            f"{'' if boundary_clock is None else boundary_clock.isoformat()}|"
            f"{','.join(str(p) for p in future_known_positions)}|"
            f"{','.join(str(p) for p in unresolved_all)}|{provenance_digest}".encode()
        )
        for r in rows:
            digest.update(f"{r.pos}|{r.ts.isoformat()}|{r.label}|".encode())
            digest.update(_payload_digest(r.values).encode())
        settled = [r.ts for r in retained if np.isfinite(r.label)]
        snapshot = TrainingSnapshot(
            position=position,
            grid_origin=(MINIMUM, REFIT_EVERY, WINDOW),
            first_position=rows[0].pos if rows else -1,
            last_position=rows[-1].pos if rows else -1,
            training_rows=len(rows),
            cutoff_ts=rows[-1].ts.isoformat() if rows else None,
            label_watermark=max(settled).isoformat() if settled else None,
            unsettled_positions=len(unresolved_all),
            schema_digest=schema_digest,
            window_first_position=window_first,
            window_last_position=window_last,
            expected_positions=min(expected, WINDOW),
            retained_positions=len(retained),
            resolved_positions=len(resolved),
            missing_source_positions=missing_source,
            push_positions=push,
            unresolved_positions=unresolved_all,
            provenance_digest=provenance_digest,
            boundary_clock=None if boundary_clock is None else boundary_clock.isoformat(),
            future_known_positions=future_known_positions,
            complete=complete,
            digest=digest.hexdigest(),
        )
        return rows, snapshot

    def scheduling_conflict(self, position: int | None = None) -> dict[str, Any]:
        """Measure, never hide, the boundary's label-availability conflict.

        The final row a boundary at ``P`` is entitled to is position ``P-1``,
        whose settling candle closes exactly at the boundary timestamp. So a
        *complete* fit for that boundary cannot begin before the boundary
        itself: this is a property of the original schedule, not something to
        be worked around by dropping the last label.
        """

        position = self.refit_due_at() if position is None else int(position)
        _rows, snapshot = self._capture(position, copy=False)
        last = self.buffer[-1].ts if self.buffer else None
        return {
            "position": position,
            "complete": snapshot.complete,
            "boundary_clock": snapshot.boundary_clock,
            "future_known_positions": list(snapshot.future_known_positions),
            "unresolved_positions": list(snapshot.unresolved_positions),
            "earliest_complete_fit_start": (
                None if last is None else (last + LABEL_CANDLE).isoformat()),
            "boundary_last_target": None if last is None else last.isoformat(),
            "note": ("the label of the boundary's final entitled row publishes at "
                     "that row's ts + 15m, i.e. at the boundary itself; training "
                     "cannot start earlier without shortening the original window"),
        }

    def training_snapshot(self, position: int, *, copy: bool = True) -> TrainingSnapshot:
        """The immutable description of what a fit for ``position`` may use.

        ``copy=False`` only describes the current rows (used on the serving path,
        where cloning the whole trailing window would cost real milliseconds);
        the digest is identical either way. ``train_ahead`` always captures.
        """

        return self._capture(position, copy=copy)[1]

    def train_ahead(self, *, position: int | None = None) -> StagedFit | None:
        """Fit the model that the next scheduled refit position will activate.

        A fit is certified for one boundary only, and only once every training
        input that boundary is entitled to actually exists - i.e. once the head
        stands at that position, so that all rows strictly before it have been
        observed. Training for a boundary that is still several targets away is
        refused: the original never trains on a shorter history than the
        boundary defines, and a fit made early would silently miss the labels
        that settle in between.

        It also requires the boundary's entitled window to be RESOLVED, not
        merely present: every position in ``[position-WINDOW, position)`` must
        be retained and must carry either a settled in-domain label or evidenced
        original source gap. A label that has not arrived yet is not the
        original's NaN, so it fails closed here (``LongContextTrainingRequired``)
        rather than producing a shortened fit or a bogus "no fit" verdict.

        Uses exactly the rows the original would have used at that boundary:
        the retained trailing window, restricted to feature-complete rows with a
        finite non-zero settled label.
        """

        due = self.refit_due_at()
        position = due if position is None else int(position)
        if position is None or position < MINIMUM:
            return None
        if position != self.position:
            raise LongContextTrainingRequired(
                f"a fit for position {position} is not yet eligible: the head is at "
                f"{self.position} and the rows before {position} do not all exist yet"
            )
        rows, snapshot = self._capture(position)
        staged = self._staged_fit
        if (staged is not None and staged.position == position
                and staged.snapshot is not None
                and staged.snapshot.digest == snapshot.digest):
            return staged
        if snapshot.future_known_positions:
            raise LongContextTrainingRequired(
                f"positions {list(snapshot.future_known_positions)[:5]} carry labels "
                f"received after the boundary clock {snapshot.boundary_clock}; the "
                "original fit at this boundary could not have known them"
            )
        if not snapshot.complete:
            missing = list(snapshot.unresolved_positions)
            raise LongContextTrainingRequired(
                f"the training window for position {position} is not resolved: "
                f"{len(missing)} of {snapshot.expected_positions} entitled positions "
                f"have no settled label and no evidenced source gap "
                f"(first {missing[:5]}). Waiting for the original required inputs; "
                "a pending label is not an original NaN"
            )
        if len(rows) < MINIMUM:
            self._no_fit_positions[position] = snapshot.digest
            return None
        target = np.asarray([1 if r.label > 0 else 0 for r in rows], dtype=np.int8)
        if np.unique(target).size != 2:
            self._no_fit_positions[position] = snapshot.digest
            return None
        x = np.vstack([r.values for r in rows])
        weights = day_balanced_weights(pd.Series([r.ts for r in rows]))
        model = _new_model()
        model.fit(x, target, sample_weight=weights)
        staged = StagedFit(
            position=position,
            model=model,
            fit_id=f"{HEAD_ID}:{position}:{rows[-1].ts.isoformat()}",
            training_rows=len(rows),
            cutoff_ts=rows[-1].ts.isoformat(),
            snapshot=snapshot,
        )
        self._staged_fit = staged
        self._no_fit_positions.pop(position, None)
        return staged

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
            "fit_id": self.fit_id,
            "first_fit_ts": self.first_fit_ts,
            "fitted": self.model is not None,
            "version": self.version,
            "staged_fit_position": self._staged_fit.position if self._staged_fit else None,
            "last_ts": self.buffer[-1].ts.isoformat() if self.buffer else None,
        }

    def export_state(self, directory: Path | str) -> dict[str, Any]:
        """Write the complete restart state as an immutable generation.

        ``directory`` becomes a small root holding ``generations/<name>/`` and a
        ``CURRENT`` pointer. Each export writes a fresh generation with its own
        ``MANIFEST.json`` of SHA-256 digests, then activates it by atomically
        replacing the pointer. There is no window in which the active state is
        missing: an interruption before the pointer swap leaves the previous
        generation active, and an interruption after it leaves the new one
        active and complete. The previous known-good generation is retained.
        """

        import joblib
        import uuid

        root = Path(directory)
        generations = root / "generations"
        generations.mkdir(parents=True, exist_ok=True)
        staging = generations / f".staging-{uuid.uuid4().hex}"
        staging.mkdir(parents=True)

        values = (np.vstack([r.values for r in self.buffer]) if self.buffer
                  else np.zeros((0, len(self.features)), dtype=float))
        np.savez(staging / "buffer.npz", values=values,
                 labels=np.asarray([r.label for r in self.buffer], dtype=float),
                 complete=np.asarray([r.complete for r in self.buffer], dtype=bool),
                 positions=np.asarray([r.pos for r in self.buffer], dtype=np.int64))
        staged = self._staged_fit
        meta = {
            "head_id": HEAD_ID,
            "spec": SPEC_NAME,
            "features": self.features,
            "feature_count": len(self.features),
            "position": self.position,
            "fit_count": self.fit_count,
            "fit_id": self.fit_id,
            "first_fit_ts": self.first_fit_ts,
            "version": self.version,
            "last_ts": self._last_ts.isoformat() if self._last_ts is not None else None,
            "last_probability": self._last_probability,
            "last_digest": self._last_digest,
            "buffer_rows": len(self.buffer),
            "buffer_ts": [r.ts.isoformat() for r in self.buffer],
            "pending_labels": {k.isoformat(): v for k, v in self._labels_by_ts.items()},
            "label_availability": {k.isoformat(): v
                                   for k, v in self._label_available_at.items()},
            "missing_labels": {k.isoformat(): v for k, v in self._missing_labels.items()},
            "fitted": self.model is not None,
            # A restart immediately before a scheduled refit must not lose the
            # fit that was already produced off the timed path, nor the
            # eligibility verdicts recorded against specific training inputs.
            "staged_fit": None if staged is None else {
                "position": staged.position,
                "fit_id": staged.fit_id,
                "training_rows": staged.training_rows,
                "cutoff_ts": staged.cutoff_ts,
                "snapshot": None if staged.snapshot is None else {
                    **staged.snapshot.__dict__,
                    "grid_origin": list(staged.snapshot.grid_origin),
                    "unresolved_positions": list(staged.snapshot.unresolved_positions),
                    "future_known_positions": list(staged.snapshot.future_known_positions),
                },
            },
            "no_fit_positions": {str(p): d for p, d in self._no_fit_positions.items()},
        }
        (staging / "state.json").write_text(json.dumps(meta, indent=1))
        if self.model is not None:
            joblib.dump(self.model, staging / "model.joblib")
        if staged is not None:
            joblib.dump(staged.model, staging / "staged_model.joblib")


        manifest = {
            "head_id": HEAD_ID,
            "files": {p.name: {"sha256": _sha256_file(p), "bytes": p.stat().st_size}
                      for p in sorted(staging.iterdir())},
        }
        (staging / "MANIFEST.json").write_text(json.dumps(manifest, indent=1))

        name = f"gen-{self.position:012d}-{uuid.uuid4().hex[:12]}"
        generation = generations / name
        os.replace(staging, generation)

        pointer = root / "CURRENT"
        pointer_tmp = root / f".CURRENT-{uuid.uuid4().hex}"
        previous = pointer.read_text().strip() if pointer.exists() else None
        pointer_tmp.write_text(name)
        os.replace(pointer_tmp, pointer)

        keep = {name} | ({previous} if previous else set())
        for candidate in generations.iterdir():
            if candidate.name not in keep and candidate.is_dir():
                shutil.rmtree(candidate, ignore_errors=True)
        meta["generation"] = name
        return meta

    @classmethod
    def restore_state(cls, directory: Path | str) -> "LongContextHead":
        """Rebuild an identical head. A restart must not restart the grid.

        The manifest is verified in full *before* anything is deserialised, and
        the recovered arrays are checked against the recorded row counts,
        feature count and fit identity.
        """

        import joblib

        root = Path(directory)
        pointer = root / "CURRENT"
        if pointer.exists():
            generation = root / "generations" / pointer.read_text().strip()
            if not generation.is_dir():
                raise LongContextSchemaError(
                    f"CURRENT points at a missing generation: {pointer.read_text().strip()!r}"
                )
        else:
            generation = root

        manifest_path = generation / "MANIFEST.json"
        if not manifest_path.exists():
            raise LongContextSchemaError("state generation has no MANIFEST.json; refusing to load")
        manifest = json.loads(manifest_path.read_text())
        if manifest.get("head_id") != HEAD_ID:
            raise LongContextSchemaError(
                f"manifest belongs to {manifest.get('head_id')!r}, not {HEAD_ID!r}"
            )
        files = manifest.get("files") or {}
        for required in ("state.json", "buffer.npz"):
            if required not in files:
                raise LongContextSchemaError(f"manifest does not cover {required}")
        for filename, entry in files.items():
            if filename == "MANIFEST.json":
                continue
            path = generation / filename
            if not path.exists():
                raise LongContextSchemaError(f"manifest lists a missing file: {filename}")
            if _sha256_file(path) != entry["sha256"]:
                raise LongContextSchemaError(f"digest mismatch for {filename}; refusing to load")

        meta = json.loads((generation / "state.json").read_text())
        if meta.get("head_id") != HEAD_ID:
            raise LongContextSchemaError(
                f"state belongs to {meta.get('head_id')!r}, not {HEAD_ID!r}"
            )
        blob = np.load(generation / "buffer.npz")
        features = list(meta["features"])
        values, labels, complete = blob["values"], blob["labels"], blob["complete"]
        stamps = list(meta["buffer_ts"])
        rows = int(meta.get("buffer_rows", len(stamps)))
        if not (len(stamps) == len(values) == len(labels) == len(complete) == rows):
            raise LongContextSchemaError(
                f"buffer is inconsistent: {len(stamps)} timestamps, {len(values)} rows, "
                f"{len(labels)} labels, {len(complete)} flags, {rows} recorded"
            )
        if values.size and values.shape[1] != len(features):
            raise LongContextSchemaError(
                f"buffer has {values.shape[1]} columns, state declares {len(features)} features"
            )
        if int(meta.get("feature_count", len(features))) != len(features):
            raise LongContextSchemaError("feature_count disagrees with the feature list")
        position = int(meta["position"])
        if "positions" in blob.files:
            positions = [int(p) for p in blob["positions"]]
            if len(positions) != rows:
                raise LongContextSchemaError("buffer positions disagree with the row count")
        else:
            positions = list(range(position - rows, position))
        if rows and (positions[-1] != position - 1
                     or positions != list(range(positions[0], positions[0] + rows))):
            raise LongContextSchemaError(
                "buffer positions are not the contiguous run ending at position-1"
            )

        head = cls(features=features)
        for ts, row, flag, label, pos in zip(stamps, values, complete, labels, positions,
                                             strict=True):
            head.buffer.append(_Row(pd.Timestamp(ts), np.asarray(row, dtype=float),
                                    bool(flag), float(label), int(pos)))
        head.position = position
        head.fit_count = int(meta["fit_count"])
        head.fit_id = meta.get("fit_id")
        head.first_fit_ts = meta["first_fit_ts"]
        head.version = int(meta.get("version", 0))
        head._last_ts = pd.Timestamp(meta["last_ts"]) if meta["last_ts"] else None
        head._last_probability = meta["last_probability"]
        head._last_digest = meta.get("last_digest")
        head._labels_by_ts = {pd.Timestamp(k): float(v)
                              for k, v in meta["pending_labels"].items()}
        head._label_available_at = {pd.Timestamp(k): str(v)
                                    for k, v in (meta.get("label_availability") or {}).items()}
        head._missing_labels = {pd.Timestamp(k): str(v)
                                for k, v in (meta.get("missing_labels") or {}).items()}
        head._no_fit_positions = {int(p): str(d)
                                  for p, d in (meta.get("no_fit_positions") or {}).items()}
        staged_meta = meta.get("staged_fit")
        if staged_meta:
            if "staged_model.joblib" not in files:
                raise LongContextSchemaError(
                    "state claims a staged fit but the manifest does not cover "
                    "staged_model.joblib"
                )
            snap = staged_meta.get("snapshot")
            head._staged_fit = StagedFit(
                position=int(staged_meta["position"]),
                model=joblib.load(generation / "staged_model.joblib"),
                fit_id=str(staged_meta["fit_id"]),
                training_rows=int(staged_meta["training_rows"]),
                cutoff_ts=staged_meta.get("cutoff_ts"),
                snapshot=None if snap is None else TrainingSnapshot(
                    **{**snap,
                       "grid_origin": tuple(snap["grid_origin"]),
                       "unresolved_positions": tuple(snap.get("unresolved_positions", ())),
                       "future_known_positions": tuple(
                           snap.get("future_known_positions", ()))}
                ),
            )
        if meta.get("fitted"):
            if "model.joblib" not in files:
                raise LongContextSchemaError(
                    "state claims a fitted head but the manifest does not cover model.joblib"
                )
            model_path = generation / "model.joblib"
            if not model_path.exists():
                raise LongContextSchemaError(
                    "state claims a fitted head but model.joblib is absent; refusing "
                    "to resume unfitted and silently emit no probabilities"
                )
            head.model = joblib.load(model_path)
        return head




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
            if np.isfinite(float(previous["label"])):
                head.settle_label(
                    previous["ts"], previous["label"],
                    available_at=pd.Timestamp(previous["ts"]) + pd.Timedelta(minutes=15),
                    as_of=pd.Timestamp(record["ts"]),
                )
        value = head.observe(record["ts"], record)
        if value is not None:
            out[index] = value
    return out


def frames_to_records(frame: pd.DataFrame) -> Iterable[dict[str, Any]]:
    return frame.to_dict("records")
