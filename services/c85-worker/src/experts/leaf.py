"""Live decision path for the C30 / C36 / C37 / R4 / external-direction ancestors.

STATUS: PARTIAL TRANSCRIPTION -- STILL FAILS CLOSED FOR ALL NINE OUTPUT KEYS,
but the reason is now "not yet transcribed", NOT "source missing".

Correction (2026-09-07). An earlier revision of this docstring asserted that
`evaluate_external_direction_r1.py`, `t0_t5_win_containment_deep_dive_r1.py`,
`t0_t5_fee_coverage_frontier_r1.py`, `c37_balanced_maturation_r1.py`,
`c30_c70_lab_manager_r2.py`, `r5_lab_manager.py`, `htf_structure_r4_refine.py`
and the root shadow ledgers were absent. That assertion was wrong. After a
recursive expansion of C85_Upstream_Recovery.zip (986 files; every nested ZIP
opened), all seven producer modules and all five named ledgers were located,
hashed and pinned. See:

  * evaluation-fixtures/upstream/FILE_INDEX.json      -- full expanded inventory
  * evaluation-fixtures/upstream/UPSTREAM_RESOLVED.json
        -- the exact chosen path + sha256 + byte size for each producer/ledger
  * evaluation-fixtures/upstream/*.parquet
        -- the five ledgers installed as parity fixtures (identical rows)
  * dependencies.py::LEAF_DEPENDENCIES
        -- per-output status, producer function, coverage window, blocker

Coverage of the recovered ledgers: 2026-02-06T23:00Z..2026-08-31T23:45Z
(fee_coverage / selected / fixed_floor, 19,780 rows each) and
2025-12-01T00:00Z..2026-08-31T22:30Z (t5_hot_calibration / t5_book_day4h_r4_1
rows, 26,124 rows each). They are historical intermediates and parity fixtures
-- they are NOT a live source, and they do not extend past 2026-08-31.

STATUS 2026-09-09. `external_direction` and `external_rank` are no longer
pass-through: their producer contract is transcribed in
`direction_contract.py` (signed call, positional 2,880/960 rolling rank of
|p-0.5|, ties half) and verified against the archived continuous ledger --
19,780 rows, zero direction mismatches, max rank difference 1.11e-16 -- and it
is wired into `LeafExperts` through `LongContextLeafProducer`. What is still
absent is the *head* that emits the probability: frozen `T0_LONG_CONTEXT_R1`
(`ALL_HGB`, 324 features, retain 0.25) exists only as freeze metadata, with no
fitted artifact and no feature pickle in recovery. So these two keys compute
correctly from a probability and stay fail-closed without one.

The other seven keys remain `UNPORTED`: producer source and historical inputs
are in hand, and what remains is (a) transcribing each producer's computation
for freshly arriving candles and (b) recovering continuation inputs after the
ledger cutoff. Where a ledger is used at all, it is used only for
stage-by-stage parity checking of a transcribed computation -- replaying a
ledger is never counted as evidence that its producer was ported.

Until a producer is transcribed and proven at parity, this module raises rather
than guessing at a root signal.

`LeafExperts.evaluate()` therefore FAILS CLOSED for every key without a wired
producer: it raises `MissingUpstreamSignalError` naming, per key, the exact
producer file and blocker, unless the caller opted into `allow_supplied` (tests
and archived replay) and placed the already-computed upstream field in
`packet`.

Everything below that *is* transcribed is transcribed exactly, with a docstring
pointing at the file and line range it came from.
"""


from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import RobustScaler


class LeafExpertError(Exception):
    """Base class for all leaf-expert failures. Fail closed, never guess."""


class MissingUpstreamSignalError(LeafExpertError):
    """Raised when a packet lacks a raw input or fitted state a rule needs.

    The message always names the exact ancestor module/ledger/column that is
    missing, per the "fail closed" rule in the task instructions.
    """


# ---------------------------------------------------------------------------
# Training-protocol constants, transcribed verbatim from the sources named in
# each docstring. These are not fabricated: every literal below is copied
# from a specific line in a specific recovered file.
# ---------------------------------------------------------------------------

# c30_c70_lab_manager_r2.py lines 33-48
SEED = 20_260_904
FEB_START = pd.Timestamp("2026-02-06T23:00:00Z")
MAY_START = pd.Timestamp("2026-05-01T00:00:00Z")
JULY_START = pd.Timestamp("2026-07-01T00:00:00Z")
END = pd.Timestamp("2026-09-01T00:00:00Z")
SOURCE_START = pd.Timestamp("2025-12-01T00:00:00Z")

SOURCE_SETS = {
    "BINANCE": {"binance"},
    "BINANCE_DERIBIT": {"binance", "deribit"},
    "BINANCE_HYPERLIQUID": {"binance", "hyperliquid"},
    "ALL3": {"binance", "deribit", "hyperliquid"},
}
C_GRID = (0.001, 0.003, 0.01, 0.03)

# c36_timing_robustness_r1.py lines 25-50: R4/C37 horizon heads use a single
# fixed C value (not grid-searched), and three walk-forward phases.
C_VALUE = 0.03
TAIL_HIGH = 0.90
TAIL_MID = 0.65
TAIL_T0_WEAK = 0.15
PHASES = (
    ("feb_apr_development", FEB_START, FEB_START, MAY_START),
    ("may_jun_validation", MAY_START, MAY_START, JULY_START),
    ("jul_aug_challenge", JULY_START, JULY_START, END),
)
VENUE_VARIANTS: dict[str, tuple[set[str], str]] = {
    "BOTH_HL": ({"binance", "hyperliquid"}, "both"),
    "BINANCE_ONLY": ({"binance"}, "both"),
    "SPOT_HL": ({"binance", "hyperliquid"}, "spot"),
    "UM_HL": ({"binance", "hyperliquid"}, "um"),
    "SPOT_ONLY": ({"binance"}, "spot"),
    "UM_ONLY": ({"binance"}, "um"),
    "HL_ONLY": ({"hyperliquid"}, "none"),
    "TIME_ONLY": (set(), "none"),
}

# c36_maturation_refinement_r2.py lines 127-152 / c37_balanced_maturation_r1.py
# lines 30-32: fixed admission thresholds actually shipped for C36/C37.
C36_HIGH, C36_MID, C36_WEAK = 0.90, 0.65, 0.15
C37_HIGH, C37_MID, C37_WEAK = 0.90, 0.60, 0.15

# t0_t5_fee_coverage_frontier_r1.py (recovered copy under legacy_c42/
# C42_MATURATION_CONSENSUS_R1/source_context/) does not define default
# RANK_LOOKBACK_PER_DIRECTION / RANK_MINIMUM_PER_DIRECTION constants in the
# excerpt read; c37_balanced_maturation_r1.py's own sensitivity sweep
# (`rank_lookback_sensitivity`) is the only place the live values are pinned
# down for the shipped model: lookback=768, minimum=768//8=96 is the middle
# of its swept grid but NOT identified there as "the" production value.
# We therefore do NOT hard-code a production lookback/minimum: callers must
# supply them, or MissingUpstreamSignalError is raised.


def model_pipeline(c_value: float) -> Pipeline:
    """Verbatim from c30_c70_lab_manager_r2.py lines 250-266.

    median imputation with missingness indicators -> RobustScaler(10,90) ->
    L1 logistic regression (liblinear), fixed random_state=SEED.
    """

    return Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
            ("scale", RobustScaler(quantile_range=(10, 90))),
            (
                "model",
                LogisticRegression(
                    C=c_value,
                    penalty="l1",
                    solver="liblinear",
                    max_iter=5_000,
                    random_state=SEED,
                ),
            ),
        ]
    )


def fit_predict_phase(
    history: pd.DataFrame,
    matrix: pd.DataFrame,
    train_end: pd.Timestamp,
    predict_start: pd.Timestamp,
    predict_end: pd.Timestamp,
    c_value: float,
) -> tuple[np.ndarray, list[str], Pipeline]:
    """Verbatim from c30_c70_lab_manager_r2.py lines 269-285.

    Trains only on rows strictly before `train_end` (walk-forward, no lookahead),
    keeping a feature column only if at least max(96, 10% of training rows)
    of the training rows have a non-missing value for it, then predicts the
    positive-label probability for `[predict_start, predict_end)`.
    """

    train = (history["ts"] < train_end).to_numpy()
    predict = ((history["ts"] >= predict_start) & (history["ts"] < predict_end)).to_numpy()
    minimum = max(96, int(0.10 * train.sum()))
    keep = [column for column in matrix if matrix.loc[train, column].notna().sum() >= minimum]
    model = model_pipeline(c_value)
    model.fit(matrix.loc[train, keep], history.loc[train, "label"].eq(1).astype(int))
    probability = np.full(len(history), np.nan)
    probability[predict] = model.predict_proba(matrix.loc[predict, keep])[:, 1]
    return probability, keep, model


def directional_past_rank(
    values: np.ndarray,
    directions: np.ndarray,
    *,
    lookback: int,
    minimum: int,
) -> np.ndarray:
    """Verbatim from the recovered copy of t0_t5_fee_coverage_frontier_r1.py
    (legacy_c42/C42_MATURATION_CONSENSUS_R1/source_context/, lines 76-100).

    Strictly past-only percentile rank of `value` within the deque of prior
    observed values sharing the same forecast `direction` (+1/-1); direction
    0 is never ranked. Ties count as half a rank. Requires `minimum` prior
    same-direction observations before it will emit a rank; otherwise NaN.
    """

    result = np.full(len(values), np.nan)
    history: dict[int, deque[float]] = {-1: deque(maxlen=lookback), 1: deque(maxlen=lookback)}
    for index, value in enumerate(values):
        direction = int(directions[index])
        if direction not in history or not np.isfinite(value):
            continue
        prior = history[direction]
        if len(prior) >= minimum:
            observed = np.fromiter(prior, dtype=float)
            result[index] = (np.sum(observed < value) + 0.5 * np.sum(observed == value)) / len(observed)
        prior.append(float(value))
    return result


def opportunity(frame: pd.DataFrame) -> np.ndarray:
    """Verbatim shape from the recovered t0_t5_fee_coverage_frontier_r1.py
    copy, lines 168-177, adapted to the column names visible in
    upstream_packet.parquet (`structure_valid`/`anchor_valid` stand in for
    that file's `t5_input_complete`; the original ledger-specific
    `candidate_prediction` gate cannot be reproduced -- see module docstring).

    NOTE: This is NOT wired into LeafExperts.evaluate(); it is provided only
    so the exact eligibility math is on record. The real production
    `candidate_prediction != 0` gate requires the unrecovered `deep`/`control`
    root ledgers.
    """

    label = frame["label"].to_numpy(float)
    return (
        (frame["ts"] >= FEB_START).to_numpy()
        & (frame["ts"] < END).to_numpy()
        & np.isfinite(label)
        & (label != 0)
    )


def make_tail(
    prediction_cov30: np.ndarray,
    stage_cov30: np.ndarray,
    candidate_t5_router_prediction: np.ndarray,
    external_rank: np.ndarray,
    router_rank: np.ndarray,
    opportunity_mask: np.ndarray,
    *,
    high: float,
    mid: float,
    weak: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Verbatim admission rule shared by C36 (c36_maturation_refinement_r2.py
    lines 127-152, "make_tail") and C37 (c36_timing_robustness_r1.py lines
    203-225, "make_tail_policy") and reused unchanged as the C37 baseline
    join point in c37_balanced_maturation_r1.py lines 243-248.

    C30's own T0/T5 call is never overwritten. A currently-abstaining candle
    is admitted at T5 with the router's own direction if either:
      * router_rank >= high, or
      * mid <= router_rank < high AND external_rank <= weak (a "counter"
        admission requiring the T0 external signal to be weak/undecided).
    """

    c30 = np.nan_to_num(prediction_cov30, nan=0).astype(np.int8)
    stage = np.asarray(stage_cov30, dtype=object).copy()
    router = np.nan_to_num(candidate_t5_router_prediction, nan=0).astype(np.int8)
    accept = np.isfinite(router_rank) & (
        (router_rank >= high)
        | ((router_rank >= mid) & (router_rank < high) & np.isfinite(external_rank) & (external_rank <= weak))
    )
    admitted = opportunity_mask & (c30 == 0) & (router != 0) & accept
    prediction = c30.copy()
    prediction[admitted] = router[admitted]
    stage[admitted] = "T5"
    return prediction, stage, admitted


def feature_matrix_columns(
    all_columns: list[str],
    horizon: int,
    sources: set[str],
    binance_leg: str = "both",
) -> list[str]:
    """Verbatim column-filtering rule from c36_timing_robustness_r1.py
    `feature_matrix`, lines 90-120, applied to whatever superset of columns
    `base.directional_matrix(history, sources, stage)` would have produced.

    NOTE: `base.directional_matrix` (evaluate_external_direction_r1.py, sha256
    e88f9c00e9b0..., recovered -- see dependencies.py) is not yet transcribed
    here, so this function covers only the *second* filtering stage (horizon
    truncation + venue-leg exclusion) applied on top of it; it cannot be used
    standalone to build the actual feature matrix.
    """

    keep: list[str] = []
    for column in all_columns:
        if "_t5_w001_" in column and horizon < 1:
            continue
        if "_t5_w003_" in column and horizon < 3:
            continue
        if "_t5_w005_" in column and horizon < 5:
            continue
        if "binance_cross_t5_" in column and horizon < 5:
            continue
        if binance_leg == "spot" and (column.startswith("binance_um_") or column.startswith("binance_cross_")):
            continue
        if binance_leg == "um" and (column.startswith("binance_spot_") or column.startswith("binance_cross_")):
            continue
        if binance_leg == "none" and column.startswith("binance_"):
            continue
        keep.append(column)
    return keep


REQUIRED_KEYS = (
    "c30_prediction",
    "c36_prediction",
    "c37_prediction",
    "r4_prediction",
    # The R4.3 expansion-selected T+5 output that the original C42
    # `apply_composite` actually reads (verified: 19,487/19,487 exact).
    "expansion_selected_prediction",
    "opportunity",
    "r4_probability_correct",
    "r4_directional_rank",
    "external_direction",
    "external_rank",
    "mean_135_rank",
)


# Exact, verified per-key blocker. Source presence and artifact presence are
# tracked separately in `dependencies.py`; nothing here claims a supplied file
# is missing, and nothing is ever fabricated.
from .dependencies import LEAF_DEPENDENCIES  # noqa: E402
from .direction_contract import (  # noqa: E402
    MODEL_NO_PROBABILITY,
    MODEL_SCORED,
)

_BLOCKED_BY: dict[str, str] = {d.key: d.summary() for d in LEAF_DEPENDENCIES}
_BLOCKED_BY.setdefault(
    "opportunity",
    "opportunity: UNAVAILABLE | the C85 opportunity flag is set by the C85 policy "
    "frame (kalshi.py candidate gate); supply it on the packet.",
)


@dataclass
class LeafExperts:
    """Live decision path for C30 / C36 / C37 / R4 / external-direction.

    STATUS (2026-09-09). Two of the nine keys now have a real, wired producer
    interface instead of pass-through:

    * ``external_direction`` and ``external_rank`` are produced by
      :class:`~src.experts.direction_contract.LongContextLeafProducer`, which
      carries the verified ``long_context_model.predictions`` contract and
      reproduces the archived continuous ledger (19,780 rows, zero direction
      mismatches, max rank difference 1.11e-16). It is driven here from the
      long-context probability, supplied per target on the packet as
      ``external_probability_green`` (or by a callable ``long_context_head``).
      The head itself - the frozen ``T0_LONG_CONTEXT_R1`` ``ALL_HGB``, 324
      features, retain 0.25 - is still NOT recovered as a fitted artifact, so
      with no probability source these keys stay fail-closed like the rest.

    The remaining seven keys are still ``UNPORTED``: producer source and
    historical outputs are recovered, transcription is not done.

    ``allow_supplied`` defaults to **False**: production fails closed, and a
    pre-computed value on the packet is ignored outright. Fixture and archived
    replay callers opt in explicitly with ``allow_supplied=True``.

    In production the probability that drives the external pair comes only from
    ``long_context_head`` - the real fitted head reading validated raw inputs.
    ``packet["external_probability_green"]`` is a *supplied output* and is read
    only in supplied mode; it can never override live inference.

    Updates are two-phase. ``evaluate`` prepares the external pair, and the
    producer state is committed only once every required key resolved. A failed
    evaluation therefore leaves the rank window untouched, which matters
    because the window is positional: a phantom row shifts every later rank.
    Callers driving the orchestration transaction use :meth:`prepare` and
    commit at the same point they persist the checkpoint.
    """

    fitted_pipelines: dict[str, Pipeline] = field(default_factory=dict)
    rank_histories: dict[str, deque] = field(default_factory=dict)
    long_context: Any = None
    long_context_head: Any = None
    allow_supplied: bool = False

    # -- computed keys ------------------------------------------------------
    def _external_update(self, packet: dict[str, Any]):
        """Prepare the external leaf pair, or None when there is no source.

        Nothing is mutated here. Returns a ``LeafUpdate`` whose ``.output``
        holds the pair and whose ``.commit()`` applies the rank window.
        """

        if self.long_context is None:
            return None
        key = packet.get("target_ms")
        if key is None:
            key = packet.get("ts")
        if key is None:
            return None

        if self.long_context_head is not None:
            # PRODUCTION PATH. The head reads the packet's validated raw inputs.
            # A probability supplied on the packet is deliberately not consulted
            # at all, in either mode, when a head exists.
            probability = self.long_context_head(packet)
            status = (
                MODEL_SCORED if probability is not None else MODEL_NO_PROBABILITY
            )
            return self.long_context.prepare(int(key), probability, status=status)

        if not self.allow_supplied:
            # No head: we must not manufacture a probability, and a supplied
            # one is not a computation. Fail closed.
            return None

        # SUPPLIED / REPLAY PATH ONLY.
        probability = packet.get("external_probability_green")
        if probability is None:
            return None
        return self.long_context.prepare(
            int(key), float(probability), status=MODEL_SCORED
        )

    def prepare(self, packet: dict[str, Any]) -> tuple[dict[str, Any], Any]:
        """Evaluate without committing; returns ``(result, update_or_None)``.

        The caller commits the update inside the same transaction that persists
        the decision and checkpoint.
        """

        if not isinstance(packet, dict):
            raise MissingUpstreamSignalError("packet must be a dict of raw/upstream candle inputs")

        update = self._external_update(packet)
        computed = dict(update.output) if update is not None else {}
        computed.pop("external_status", None)

        result: dict[str, Any] = {}
        missing: list[str] = []
        for key in REQUIRED_KEYS:
            if key in computed:
                result[key] = computed[key]
                continue
            supplied = packet.get(key)
            usable = (
                self.allow_supplied
                and supplied is not None
                and not (isinstance(supplied, float) and np.isnan(supplied))
            )
            if usable:
                result[key] = supplied
            else:
                missing.append(key)
        if missing:
            details = "\n".join(f"  - {key}: {_BLOCKED_BY[key]}" for key in missing)
            raise MissingUpstreamSignalError(
                "LeafExperts.evaluate(): cannot compute the following keys from raw "
                "inputs. Status per key below (source modules that ARE available are "
                "named; only genuinely absent artifacts are listed as missing). "
                "Fail-closed rather than fabricate:\n" + details
            )
        return result, update

    def evaluate(self, packet: dict[str, Any]) -> dict[str, Any]:
        """Fail-closed evaluation that commits on success only.

        `packet` is a single-candle dict of raw inputs (the
        upstream_packet.parquet row schema). Keys with a wired producer are
        computed here; keys without one raise `MissingUpstreamSignalError`
        unless the caller opted into `allow_supplied` and placed the
        fully-computed upstream value on the packet, in which case it is passed
        through unchanged - no ranking/admission math is applied to a value that
        already claims to be a final output.
        """

        result, update = self.prepare(packet)
        if update is not None:
            update.commit()
        return result
