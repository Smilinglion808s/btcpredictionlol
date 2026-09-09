"""The authentic `external_direction` / `external_rank` contract.

Provenance (all paths relative to the recovered upstream tree
``/mnt/documents/.lovable/c85-cache/upx``):

* ``ancestor/source/00b556d1cbfe/long_context_model.py``
  - ``predictions()`` lines 287-291 - the ONLY place in the recovered tree that
    constructs the ``external_direction`` / ``external_rank`` pair:

        direction  = where(isfinite(p), where(p >= 0.5, 1, -1), 0)   # int8
        rank       = rolling_rank(abs(p - 0.5))                      # global
        prediction = where(isfinite(rank) & (rank >= 1 - retain), direction, 0)

  - constants lines 36-39: ``RANK_LOOKBACK = 2880``, ``RANK_MINIMUM = 960``.
* ``ancestor/source/5077be07722c/net_monthly_waterfall_r1.py`` lines 190-205 -
  writes those three arrays to ``t0_long_context_full_predictions.csv``.
* ``ancestor/source/1ce355350069/t0_t5_coverage_bridge_audit_r1.py`` lines
  32/267-274/792 - copies ``external_direction`` / ``external_rank`` from that
  CSV into ``continuous_coverage_ledger.csv``.
* ``.../t0_t5_fee_coverage_frontier_r1.py`` lines 103-108, 258-273 - reads them
  from that ledger; that is how they reach C42 and then C85.
* ``.../long_context_output/T0_LONG_CONTEXT_R1_FREEZE.json`` - the frozen head:
  identity ``T0_LONG_CONTEXT_R1``, policy ``ALL_HGB::CONF_GLOBAL_Q25``,
  ``selected_head = ALL_HGB`` (HistGradientBoosting, 324 features),
  ``retain = 0.25``.
* ``t5_precision_lab.py::rolling_rank`` lines 100-110 - the rank itself.

Three corrections to earlier worker code are encoded here.

1. ``external_direction`` is **signed** ``{-1, +1}``, and ``0`` means "no
   probability for this row" (the downstream ``.fillna(0)`` in every consumer).
   A binary class index (``1``/``0``) is a different quantity and is never
   written into this field.
2. ``p == 0.5`` resolves to ``+1`` (``>=``), not to an abstention. The archived
   ledger happens to contain no exact-0.5 row, so this is taken from the source
   expression, not inferred from data.
3. ``external_rank`` is the **global** ``rolling_rank`` of ``|p - 0.5|`` over
   the trailing 2,880 **rows** - a positional window, from which the non-finite
   entries are dropped only after slicing, so rows without a probability still
   consume a slot - with a 960-row minimum. It is NOT the per-direction
   ``directional_past_rank``. ``directional_past_rank`` (lookback 768, minimum
   96) belongs to the c30/c70 ``map_external_scores`` ranks, a different pair
   of columns.

Parity: ``tests/test_direction_contract.py`` recomputes both columns from the
archived ``external_probability_green`` of ``continuous_coverage_ledger.csv``
(19,780 rows, 2026-02-06T23:00Z..2026-08-31T23:45Z): 0 direction mismatches,
identical rank finiteness, max rank difference 1.11e-16.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

import numpy as np

# long_context_model.py lines 36-39
RANK_LOOKBACK = 2_880
RANK_MINIMUM = 960
# T0_LONG_CONTEXT_R1_FREEZE.json
FREEZE_IDENTITY = "T0_LONG_CONTEXT_R1"
SELECTED_HEAD = "ALL_HGB"
SELECTED_POLICY = "ALL_HGB::CONF_GLOBAL_Q25"
RETAIN = 0.25

# t0_t5_fee_coverage_frontier_r1.py lines 25-26 - the *other* rank family, kept
# here only so the two are never confused again.
DIRECTIONAL_RANK_LOOKBACK = 768
DIRECTIONAL_RANK_MINIMUM = 96

MISSING_DIRECTION = 0


def signed_direction(probability: float | Sequence[float] | np.ndarray) -> Any:
    """`long_context_model.predictions` line 288, scalar- and array-safe.

    Returns ``+1`` when ``p >= 0.5`` (ties included), ``-1`` when ``p < 0.5``
    and ``0`` when ``p`` is missing/non-finite. Never returns a class index.
    """

    scalar = np.isscalar(probability) or probability is None
    values = np.asarray([probability] if scalar else probability, dtype=float)
    out = np.where(
        np.isfinite(values), np.where(values >= 0.5, 1, -1), MISSING_DIRECTION
    ).astype(np.int8)
    return int(out[0]) if scalar else out


def rolling_rank(
    values: Sequence[float] | np.ndarray,
    lookback: int = RANK_LOOKBACK,
    minimum: int = RANK_MINIMUM,
) -> np.ndarray:
    """Verbatim `t5_precision_lab.rolling_rank` lines 100-110.

    Strictly past-only percentile of ``value`` within the trailing ``lookback``
    **rows** (``values[index - lookback:index]``), from which the non-finite
    entries are dropped after slicing - so a row without a value still occupies
    a slot in the window. Ties count half; the result is NaN until ``minimum``
    finite values exist inside that positional window. Non-finite values are
    neither ranked nor counted.
    """

    values = np.asarray(values, dtype=float)
    result = np.full(len(values), np.nan)
    for index, value in enumerate(values):
        if not np.isfinite(value):
            continue
        history = values[max(0, index - lookback):index]
        history = history[np.isfinite(history)]
        if len(history) < minimum:
            continue
        result[index] = (
            np.sum(history < value) + 0.5 * np.sum(history == value)
        ) / len(history)
    return result


def external_prediction(
    direction: np.ndarray, rank: np.ndarray, retain: float = RETAIN
) -> np.ndarray:
    """`long_context_model.predictions` line 290."""

    rank = np.asarray(rank, dtype=float)
    return np.where(
        np.isfinite(rank) & (rank >= 1 - retain), np.asarray(direction), 0
    ).astype(np.int8)


class RankStateError(RuntimeError):
    """Raised when an incremental rank update would break chronological order."""


class RetryConflict(RuntimeError):
    """Raised when a target is re-submitted with a *different* input.

    The committed output of a target is immutable. A retry that carries the
    same input is idempotent and returns the original output; a retry that
    carries a different input is a real inconsistency (two different beliefs
    about one target) and is surfaced rather than silently applied, because
    applying it would mix a new direction with an already-committed rank.
    """

    def __init__(self, message: str, *, original: dict[str, Any] | None = None):
        super().__init__(message)
        self.original = original


class AcquisitionFailure(RuntimeError):
    """Raised when a target could not be processed at all.

    This is *not* the same as the model returning no probability. In the
    original series a row exists - with a NaN probability - whenever the model
    ran and produced nothing; that row consumes a slot in the positional
    window. A target we never managed to process is not such a row: we do not
    know what the original would have contained, so advancing the window for it
    would silently shift every later rank. Fail closed instead.
    """


def _same_value(left: float, right: float) -> bool:
    """NaN-aware equality, so a retry of a missing value is still idempotent."""

    if np.isnan(left) and np.isnan(right):
        return True
    return bool(left == right)


@dataclass
class RankUpdate:
    """A *prepared*, not yet applied, rank for one target.

    Two-phase on purpose. Leaf evaluation can fail after the rank is computed
    (another required key is missing, the packet is rejected downstream), and a
    rank that was applied by a failed evaluation would corrupt every later row
    while the target itself was never emitted. So ``prepare`` mutates nothing
    and ``commit`` is called only once the whole evaluation has succeeded and
    the orchestrator is ready to persist.
    """

    state: "RollingRankState"
    key: int
    value: float
    rank: float
    duplicate: bool = False
    committed: bool = False

    def commit(self) -> float:
        if self.committed:
            return self.rank
        self.committed = True
        if not self.duplicate:
            self.state._apply(self.key, self.value, self.rank)
        return self.rank


@dataclass
class RollingRankState:
    """Incremental, serialisable, idempotent form of :func:`rolling_rank`.

    The original computes the whole column at once with the slice
    ``values[index - lookback:index]``. That window is **positional**: it spans
    the previous ``lookback`` *rows* of the chronological series and only then
    drops the non-finite ones. A window of the last ``lookback`` finite values
    is a different (and wrong) quantity whenever the series contains gaps - on
    the archived ledger, which has 2,935 rows without a probability, the two
    disagree on 64.7% of rows. So this state keeps ``(position, value)`` pairs
    and prunes by row position.

    Consequence for callers: a target must be submitted for **every** row of
    the series, including rows where the model produced no probability (submit
    ``nan``). Skipping such a row shifts the window. A row that was never
    processed at all is a different case - see :class:`AcquisitionFailure`.

    Semantics preserved: strictly past-only, ties count half, NaN until
    ``minimum`` finite values exist inside the positional window, non-finite
    values are neither ranked nor stored (but their row still advances the
    position).

    Idempotence: re-submitting the same ``key`` with the same value returns the
    committed rank and applies nothing. Re-submitting it with a different value
    raises :class:`RetryConflict`. An older key raises :class:`RankStateError`.
    """

    lookback: int = RANK_LOOKBACK
    minimum: int = RANK_MINIMUM
    window: deque[tuple[int, float]] | None = None
    position: int = 0
    last_key: int | None = None
    last_value: float | None = None
    last_rank: float | None = None

    def __post_init__(self) -> None:
        if self.window is None:
            self.window = deque()
        elif not isinstance(self.window, deque):
            self.window = deque(tuple(entry) for entry in self.window)

    def _prune(self, index: int) -> None:
        oldest = index - self.lookback
        while self.window and self.window[0][0] < oldest:
            self.window.popleft()

    # -- two-phase update ---------------------------------------------------
    def prepare(self, key: int, value: float) -> RankUpdate:
        """Compute the rank for ``key`` without mutating any state."""

        key = int(key)
        value = float(value)
        if self.last_key is not None:
            if key == self.last_key:
                if not _same_value(float(self.last_value), value):
                    raise RetryConflict(
                        f"target {key} was already committed with value "
                        f"{self.last_value!r}; retry carries {value!r}"
                    )
                return RankUpdate(
                    self, key, value,
                    float("nan") if self.last_rank is None else self.last_rank,
                    duplicate=True,
                )
            if key < self.last_key:
                raise RankStateError(
                    f"out-of-order rank update: {key} <= last committed {self.last_key}"
                )
        index = self.position
        self._prune(index)
        rank = float("nan")
        if np.isfinite(value):
            if len(self.window) >= self.minimum:
                observed = np.fromiter((v for _, v in self.window), dtype=float)
                rank = float(
                    (np.sum(observed < value) + 0.5 * np.sum(observed == value))
                    / len(observed)
                )
        return RankUpdate(self, key, value, rank)

    def _apply(self, key: int, value: float, rank: float) -> None:
        index = self.position
        self._prune(index)
        if np.isfinite(value):
            self.window.append((index, float(value)))
        self.position = index + 1
        self.last_key = key
        self.last_value = value
        self.last_rank = rank

    def observe(self, key: int, value: float) -> float:
        """``prepare`` + ``commit``, for callers with nothing to roll back."""

        return self.prepare(key, value).commit()

    # -- serialisation ------------------------------------------------------
    def to_dict(self) -> dict[str, Any]:
        return {
            "lookback": self.lookback,
            "minimum": self.minimum,
            "window": [[int(i), float(v)] for i, v in self.window],
            "position": int(self.position),
            "last_key": self.last_key,
            # NaN is written as null and restored as NaN when `last_key` is
            # set, so the payload stays strict JSON.
            "last_value": None if self.last_value is None or not np.isfinite(self.last_value)
            else float(self.last_value),
            "last_rank": None if self.last_rank is None or not np.isfinite(self.last_rank)
            else float(self.last_rank),
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "RollingRankState":
        state = cls(
            lookback=int(payload["lookback"]),
            minimum=int(payload["minimum"]),
            window=deque(
                (int(i), float(v)) for i, v in payload.get("window", ())
            ),
            position=int(payload.get("position", 0)),
            last_key=None if payload.get("last_key") is None else int(payload["last_key"]),
        )
        raw = payload.get("last_rank")
        state.last_rank = float("nan") if raw is None else float(raw)
        raw_value = payload.get("last_value")
        state.last_value = float("nan") if raw_value is None else float(raw_value)
        if payload.get("last_key") is None:
            state.last_rank = None
            state.last_value = None
        return state


def directional_past_rank(
    values: Sequence[float] | np.ndarray,
    directions: Sequence[int] | np.ndarray,
    *,
    lookback: int = DIRECTIONAL_RANK_LOOKBACK,
    minimum: int = DIRECTIONAL_RANK_MINIMUM,
) -> np.ndarray:
    """Verbatim `t0_t5_fee_coverage_frontier_r1.directional_past_rank` (lines
    74-100). Kept alongside the global rank so the two families stay distinct;
    this one ranks ``p_correct`` within its own ``+1``/``-1`` bucket and never
    ranks direction ``0``."""

    values = np.asarray(values, dtype=float)
    directions = np.asarray(directions)
    result = np.full(len(values), np.nan)
    history: dict[int, deque[float]] = {
        -1: deque(maxlen=lookback),
        1: deque(maxlen=lookback),
    }
    for index, value in enumerate(values):
        direction = int(directions[index])
        if direction not in history or not np.isfinite(value):
            continue
        prior = history[direction]
        if len(prior) >= minimum:
            observed = np.fromiter(prior, dtype=float)
            result[index] = (
                np.sum(observed < value) + 0.5 * np.sum(observed == value)
            ) / len(observed)
        prior.append(float(value))
    return result


def iter_incremental_ranks(
    keys: Iterable[int],
    values: Iterable[float],
    state: RollingRankState | None = None,
) -> tuple[np.ndarray, RollingRankState]:
    """Chronological convenience wrapper used by the parity tests."""

    state = state or RollingRankState()
    out = [state.observe(k, v) for k, v in zip(keys, values)]
    return np.asarray(out, dtype=float), state


@dataclass
class LongContextLeafProducer:
    """Turns one long-context probability into the C85 leaf pair, incrementally.

    This is the *only* sanctioned producer of the `external_direction` and
    `external_rank` leaf keys. It carries the contract of
    ``long_context_model.predictions`` (lines 287-291) target by target:

    * ``external_direction`` = +1 / -1 by :func:`signed_direction`, 0 when the
      head returned no finite probability;
    * ``external_rank``      = the strictly past-only positional rolling rank of
      ``abs(p - 0.5)`` over 2,880 rows with a 960-row minimum, ties half.

    It does *not* own the head. A target must be submitted for every row in
    chronological order - including rows where the head produced no
    probability, submitted as ``status=MODEL_NO_PROBABILITY``, because the
    original window is positional and skipping a row shifts it. A row that
    could not be processed at all is submitted as ``status=ACQUISITION_FAILED``
    and is *rejected*: it is not a row of the original series, and advancing
    the window for it would shift every later rank.

    Updates are two-phase (:meth:`prepare` then :meth:`commit`) so a leaf
    evaluation that fails after this point leaves no state behind. The
    committed output for a target is immutable: an identical retry returns it
    unchanged, a conflicting retry raises :class:`RetryConflict` carrying the
    original.
    """

    rank_state: RollingRankState | None = None
    last_key: int | None = None
    last_output: dict[str, Any] | None = None

    def __post_init__(self) -> None:
        if self.rank_state is None:
            self.rank_state = RollingRankState()

    def prepare(self, key: int, probability: float | None,
                *, status: str = MODEL_SCORED) -> "LeafUpdate":
        """Compute the leaf pair for one target without mutating state."""

        key = int(key)
        if status == ACQUISITION_FAILED:
            raise AcquisitionFailure(
                f"target {key} was never processed (status={status!r}); refusing to "
                "advance the positional rank window for a row that is not part of "
                "the original series"
            )
        if status not in (MODEL_SCORED, MODEL_NO_PROBABILITY):
            raise ValueError(f"unknown long-context status {status!r}")
        if status == MODEL_NO_PROBABILITY:
            value = float("nan")
        else:
            if probability is None:
                raise ValueError(
                    "status=MODEL_SCORED requires a probability; use "
                    "MODEL_NO_PROBABILITY for a row the head could not score"
                )
            value = float(probability)

        if self.last_key is not None and key == self.last_key:
            previous = float(self.last_output["external_probability_green"])
            if not _same_value(previous, value):
                raise RetryConflict(
                    f"target {key} already produced probability {previous!r}; retry "
                    f"carries {value!r}. The committed output is immutable.",
                    original=dict(self.last_output),
                )
            return LeafUpdate(self, key, dict(self.last_output), None, duplicate=True)

        rank_update = self.rank_state.prepare(
            key, abs(value - 0.5) if np.isfinite(value) else float("nan")
        )
        output = {
            "external_probability_green": value,
            "external_direction": int(signed_direction(value)),
            "external_rank": rank_update.rank,
            "external_status": status,
        }
        return LeafUpdate(self, key, output, rank_update)

    def observe(self, key: int, probability: float | None,
                *, status: str = MODEL_SCORED) -> dict[str, Any]:
        """``prepare`` + ``commit``, for callers with nothing to roll back."""

        if probability is None and status == MODEL_SCORED:
            status = MODEL_NO_PROBABILITY
        return self.prepare(key, probability, status=status).commit()

    def _apply(self, key: int, output: dict[str, Any]) -> None:
        self.last_key = key
        self.last_output = dict(output)

    def to_dict(self) -> dict[str, Any]:
        output = None
        if self.last_output is not None:
            output = {
                k: (None if isinstance(v, float) and not np.isfinite(v) else v)
                for k, v in self.last_output.items()
            }
        return {
            "rank_state": self.rank_state.to_dict(),
            "last_key": self.last_key,
            "last_output": output,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "LongContextLeafProducer":
        output = payload.get("last_output")
        if output is not None:
            output = dict(output)
            for field_name in ("external_probability_green", "external_rank"):
                if output.get(field_name) is None:
                    output[field_name] = float("nan")
        last_key = payload.get("last_key")
        return cls(
            rank_state=RollingRankState.from_dict(payload["rank_state"]),
            last_key=None if last_key is None else int(last_key),
            last_output=output,
        )


@dataclass
class LeafUpdate:
    """A prepared external leaf pair, applied only on :meth:`commit`."""

    producer: LongContextLeafProducer
    key: int
    output: dict[str, Any]
    rank_update: RankUpdate | None
    duplicate: bool = False
    committed: bool = False

    def commit(self) -> dict[str, Any]:
        if self.committed:
            return dict(self.output)
        self.committed = True
        if not self.duplicate:
            if self.rank_update is not None:
                self.rank_update.commit()
            self.producer._apply(self.key, self.output)
        return dict(self.output)
