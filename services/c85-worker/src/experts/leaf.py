"""Live decision path for the C30 / C36 / C37 / R4 / external-direction ancestors.

STATUS: PARTIAL TRANSCRIPTION -- FAIL CLOSED FOR ALL NINE OUTPUT KEYS.

This module faithfully transcribes every piece of decision-path math that is
actually present in the recovered ancestor sources named in the task:

    /tmp/kit2/ancestor_source/vault_work/legacy_c30/external_research/
        c30_c70_lab_manager_r2.py
        c30_c70_lab_manager_r2_phase2.py
        c30_c70_lab_manager_r2_phase3.py
    /tmp/kit2/ancestor_source/vault_work/legacy_c37/external_research/
        c36_fee_frontier_r3.py
        c36_maturation_refinement_r2.py
        c36_timing_robustness_r1.py
        c37_balanced_maturation_r1.py
        c37_venue_ensemble_r4.py

Reading those files line by line shows that all five requested predictions
(c30_prediction, c36_prediction, c37_prediction, r4_prediction/r4_probability_
correct/r4_directional_rank, external_direction/external_rank) are NOT computed
inside these files. Every one of them is *consumed* from CSV ledgers produced by
earlier, still-unrecovered ancestors, and from two Python modules that are
`import`-ed by name but whose source is absent from every directory under
/tmp/kit2 (confirmed by an exhaustive `grep -rl` across the whole recovered
kit):

  * `evaluate_external_direction_r1.directional_matrix`   -- builds the raw
    Binance/Deribit/Hyperliquid feature matrix that every logistic head in
    C30/C36/C37 is trained on. Not recovered anywhere.
  * `t0_t5_win_containment_deep_dive_r1.load_rich_frame` ("deep") -- builds the
    per-candle "frame" (label, candidate_prediction, candidate_t5_router_
    prediction, candidate_stage, external_direction, external_rank, ...).
    Not recovered anywhere. (`external_direction`/`external_rank` -- one of
    the five requested outputs -- is *itself* a column this loader merges in
    from a still-earlier ledger; its generating formula is not in the kit.)
  * `t0_t5_fee_coverage_frontier_r1` ("control") -- a *near*-duplicate of this
    module was found one directory over, in
    legacy_c42/C42_MATURATION_CONSENSUS_R1/source_context/t0_t5_fee_coverage_frontier_r1.py.
    Its `directional_past_rank` and `opportunity` functions are transcribed
    verbatim below because their math is self-contained. Its `load_frame`,
    however, reads four more upstream CSV ledgers (`continuous_coverage_ledger.csv`,
    `label_stable_db1_shadow_ledger.csv`, `t5_reliability_r2_rows.csv`,
    `r5_lab_manager_output/t5_hot_calibration_ledger.csv`) that are themselves
    not recovered. `r4_prediction`/`r4_probability_correct` are read verbatim
    out of that last ledger -- i.e. R4 is not a model defined in the recovered
    C30/C36/C37 sources at all; it is an even earlier ancestor ("r5 lab
    manager") whose source was not supplied.
  * C30's own decision rule (`make_dual_score_policy` in
    c30_c70_lab_manager_r2.py) needs `frame["candidate_stage"]`,
    `frame["external_direction"]`, and `frame["candidate_t5_router_prediction"]`
    -- all three trace back to the unrecovered `deep`/`control` root ledgers
    above, not to any raw market feed.
  * C36's and C37's admission rules (`make_tail` / `make_tail_policy`, both
    transcribed verbatim below) gate on `prediction_cov30` / `stage_cov30`
    (= C30's own output) and `candidate_t5_router_prediction` -- the same
    unrecovered root signal.

Net effect: the *routing/admission* arithmetic for C30, C36, C37 is fully
recoverable and is transcribed below as pure functions, but every one of
those functions takes as input one or more signals
(`external_direction`, `external_rank`, `candidate_t5_router_prediction`,
`prediction_cov30`/`stage_cov30`) that this codebase cannot compute from raw
Binance/Deribit/Hyperliquid/Polymarket data, because the modules that compute
them were not part of the recovered kit. Fabricating those root signals (e.g.
guessing at a plausible `directional_matrix` from the naming convention of
columns in upstream_packet.parquet) would violate the "no approximations, no
fabricated parameters" instruction, so this module raises instead of guessing.

`LeafExperts.evaluate()` therefore FAILS CLOSED for every one of the nine
requested keys: it raises `MissingUpstreamSignalError` naming exactly which
unrecovered module/ledger/column blocks that key, unless the caller has
independently supplied the corresponding already-computed upstream field(s)
in `packet` (e.g. because some other, still-live service reproduces the
missing ancestor). The pure, faithfully-transcribed helper functions are
exposed as module-level functions and as `LeafExperts` static/instance
methods so that a future port -- once `evaluate_external_direction_r1`,
`t0_t5_win_containment_deep_dive_r1`, and the R4/root ledgers are recovered --
can be completed by writing only the missing feature-matrix builder and
wiring it in; nothing here would need to change.

Everything below that *is* transcribed is transcribed exactly, with a
docstring pointing at the file and line range it came from.
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

    NOTE: `base.directional_matrix` itself (evaluate_external_direction_r1.py)
    is NOT recovered, so this function documents only the *second* filtering
    stage (horizon truncation + venue-leg exclusion) applied on top of it; it
    cannot be used standalone to build the actual feature matrix.
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


# Exactly which unrecovered module/ledger blocks each output key. Used only
# to produce precise, actionable error messages -- never to fabricate values.
_BLOCKED_BY: dict[str, str] = {
    "external_direction": (
        "requires evaluate_external_direction_r1.directional_matrix (raw Binance/"
        "Deribit/Hyperliquid feature builder) and t0_t5_win_containment_deep_dive_r1."
        "load_rich_frame (root ledger merge). Neither module's source was recovered."
    ),
    "external_rank": (
        "requires t0_t5_fee_coverage_frontier_r1.directional_past_rank fed by "
        "external_direction's own probability-of-correct series, which is produced "
        "inside c30_c70_lab_manager_r2.select_external_models() from the same "
        "unrecovered evaluate_external_direction_r1.directional_matrix."
    ),
    "c30_prediction": (
        "requires c30_c70_lab_manager_r2.make_dual_score_policy(), which needs "
        "frame['candidate_stage'], frame['external_direction'] and "
        "frame['candidate_t5_router_prediction'] from the unrecovered "
        "t0_t5_win_containment_deep_dive_r1.load_rich_frame() root ledger, plus the "
        "unrecovered evaluate_external_direction_r1.directional_matrix training features."
    ),
    "c36_prediction": (
        "make_tail() admission math is transcribed above, but it requires "
        "prediction_cov30/stage_cov30 (= c30_prediction, itself blocked) and "
        "candidate_t5_router_prediction (root signal from the unrecovered "
        "t0_t5_win_containment_deep_dive_r1 ledger)."
    ),
    "c37_prediction": (
        "same blockers as c36_prediction, plus c37_balanced_maturation_r1.py's own "
        "mean_135_rank input (see mean_135_rank below)."
    ),
    "mean_135_rank": (
        "requires fit_phasewise_probability() run over H1/H3/H5 feature matrices built "
        "by the unrecovered evaluate_external_direction_r1.directional_matrix, then "
        "reranked via rerank_router() against candidate_t5_router_prediction -- a root "
        "signal from the unrecovered t0_t5_win_containment_deep_dive_r1 ledger."
    ),
    "r4_prediction": (
        "read verbatim, not modeled, from external_research/r5_lab_manager_output/"
        "t5_hot_calibration_ledger.csv ('base_direction') in the recovered "
        "t0_t5_fee_coverage_frontier_r1.load_frame(). That ledger and its generating "
        "'r5 lab manager' ancestor were not part of the recovered kit."
    ),
    "r4_probability_correct": (
        "read verbatim from the same unrecovered t5_hot_calibration_ledger.csv "
        "('r4_probability_correct' column)."
    ),
    "r4_directional_rank": (
        "would be directional_past_rank(r4_probability_correct, r4_prediction, ...) "
        "-- the ranking math is transcribed above, but its input r4_probability_correct "
        "is itself blocked (see r4_probability_correct)."
    ),
}


@dataclass
class LeafExperts:
    """Live decision path for C30 / C36 / C37 / R4 / external-direction.

    Every faithfully-recoverable pure function used by these ancestors is
    implemented at module scope above. This class does not fit or store any
    model state on its own, because none of the training data required to
    produce that state (the raw evaluate_external_direction_r1 feature
    matrix, and the unrecovered root ledgers) is available -- see the module
    docstring. `fitted_pipelines` / `rank_histories` are accepted so that,
    once the missing feature-matrix builder is recovered/re-derived, a
    caller can inject real walk-forward-fitted `sklearn` Pipelines and
    `directional_past_rank` deque state here without touching this file
    again.
    """

    fitted_pipelines: dict[str, Pipeline] = field(default_factory=dict)
    rank_histories: dict[str, deque] = field(default_factory=dict)

    def evaluate(self, packet: dict[str, Any]) -> dict[str, Any]:
        """Fail-closed evaluation.

        `packet` is expected to be a single-candle dict of raw inputs (the
        upstream_packet.parquet row schema). Because none of the nine target
        keys can be computed from raw inputs alone without the unrecovered
        modules/ledgers described in the module docstring, this raises
        `MissingUpstreamSignalError` for every key unless the caller has
        already placed the fully-computed upstream value for that key
        directly in `packet` (e.g. `packet["external_direction"]`), in which
        case that value is passed through unchanged -- no ranking/admission
        math is applied to a value that already claims to be the final
        output, to avoid silently double-transforming an already-correct
        upstream number.
        """

        if not isinstance(packet, dict):
            raise MissingUpstreamSignalError("packet must be a dict of raw/upstream candle inputs")

        result: dict[str, Any] = {}
        missing: list[str] = []
        for key in REQUIRED_KEYS:
            if key in packet and packet[key] is not None and not (isinstance(packet[key], float) and np.isnan(packet[key])):
                result[key] = packet[key]
            else:
                missing.append(key)
        if missing:
            details = "\n".join(f"  - {key}: {_BLOCKED_BY[key]}" for key in missing)
            raise MissingUpstreamSignalError(
                "LeafExperts.evaluate(): cannot compute the following keys from raw "
                "inputs because their upstream ancestor source/ledgers were not "
                "recovered (see src/experts/leaf.py module docstring for the full "
                "provenance trace). Fail-closed rather than fabricate:\n" + details
            )
        return result
