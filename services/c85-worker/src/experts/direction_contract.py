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
   the trailing 2,880 finite observations (minimum 960), NOT the per-direction
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
    *finite* prior observations; ties count half; NaN until ``minimum`` prior
    finite observations exist. Non-finite values are neither ranked nor stored.
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
    and prunes by position.

    Consequence for callers: ``observe`` must be called for **every** target in
    the series, including targets whose probability is missing (pass ``nan``).
    Skipping them shifts the window.

    Semantics preserved: strictly past-only, ties count half, NaN until
    ``minimum`` finite observations exist inside the positional window,
    non-finite values are neither ranked nor stored.

    Idempotence: re-submitting the same ``key`` (the target timestamp) returns
    the previously computed rank and does not advance the window. Submitting an
    older key raises rather than silently corrupting the window.
    """

    lookback: int = RANK_LOOKBACK
    minimum: int = RANK_MINIMUM
    window: deque[tuple[int, float]] | None = None
    position: int = 0
    last_key: int | None = None
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

    def observe(self, key: int, value: float) -> float:
        """Rank ``value`` for ``key`` against the prior positional window."""

        key = int(key)
        if self.last_key is not None:
            if key == self.last_key:
                return float("nan") if self.last_rank is None else self.last_rank
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
            self.window.append((index, float(value)))
        self.position = index + 1
        self.last_key = key
        self.last_rank = rank
        return rank

    # -- serialisation ------------------------------------------------------
    def to_dict(self) -> dict[str, Any]:
        return {
            "lookback": self.lookback,
            "minimum": self.minimum,
            "window": [[int(i), float(v)] for i, v in self.window],
            "position": int(self.position),
            "last_key": self.last_key,
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
        if payload.get("last_key") is None:
            state.last_rank = None
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
