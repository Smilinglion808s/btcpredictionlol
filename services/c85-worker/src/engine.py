"""The unchanged C85 decision chain for a single target, evaluated online.

Order of operations is fixed by the original source and must not be reordered:

  1. direction head  -> probability_yes -> proposal (>=0.5 => +1, else -1;
     unavailable probability => 0)
  2. core validity   = binance_complete AND anchor_valid AND cm_valid AND
                       auxiliary source_ok (valid aux data, four finite aux
                       outputs, aux source last close == T-1ms)
  3. correctness head -> probability_correct
  4. rank family 1 (admission): side-specific midrank of probability_correct by
     proposal; admit YES at >= 0.50, NO at >= 0.70  -> core side
  5. confirmed extension when the core abstains
  6. base side = core or extension; EVERY nonzero base call feeds the
     deterioration stream, including structure-invalid ones
  7. rank family 2 (filter): midrank of confidence in the base side
  8. final keep = structure_valid AND NOT (weak AND filter_rank < 0.40)
     NaN filter_rank < 0.40 is False, so a not-yet-ready filter rank never
     abstains on its own.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import numpy as np

from .config import (
    EXTENSION_MIN_DISTANCE,
    FILTER_RANK_FLOOR,
    NO_ADMISSION_RANK,
    YES_ADMISSION_RANK,
)
from .c85.reliability import portable_probability
from .state import C85State

NS = 1_000_000_000


def target_identity(ticker: str, target_open: datetime) -> str:
    return f"{ticker}|{target_open.astimezone(timezone.utc).isoformat()}"


def proposal_from_probability(p: float | None) -> int:
    if p is None or not math.isfinite(p):
        return 0
    return 1 if p >= 0.5 else -1


@dataclass
class Decision:
    ticker: str
    target_open: datetime
    run_mode: str = "LIVE"
    status: str = "SCHEDULED"
    status_reason: str | None = None

    probability_yes: float | None = None
    proposal: int = 0
    probability_correct: float | None = None

    admission_rank: float | None = None
    admission_rank_count: int = 0
    filter_rank: float | None = None
    filter_rank_count: int = 0

    core_side: int = 0
    extension: bool = False
    last_yes_price: float | None = None
    base_side: int = 0
    weak: bool = False
    final_side: int = 0

    deterioration: dict[str, Any] = field(default_factory=dict)
    validity: dict[str, bool] = field(default_factory=dict)
    gate_reasons: list[str] = field(default_factory=list)
    fits: dict[str, Any] = field(default_factory=dict)
    features: dict[str, Any] = field(default_factory=dict)
    timing: dict[str, Any] = field(default_factory=dict)

    @property
    def identity(self) -> str:
        return target_identity(self.ticker, self.target_open)

    @property
    def is_directional(self) -> bool:
        return self.final_side in (-1, 1)


def score_head(bundle: dict[str, Any], features: dict[str, float | None]) -> float:
    """Portable logistic scoring in the head's own feature order."""
    order = list(bundle["feature_order"])
    row = np.array(
        [[np.nan if features.get(name) is None else float(features[name]) for name in order]],
        dtype=float,
    )
    return float(portable_probability(row, bundle)[0])


def confirmed_extension_side(
    core_side: int,
    market_q1: bool,
    c54_prediction: int,
    last_yes_price: float | None,
    minimum_distance: float = EXTENSION_MIN_DISTANCE,
) -> tuple[int, bool]:
    """Original confirmed extension. May disagree with the direction proposal."""
    price_ok = last_yes_price is not None and math.isfinite(last_yes_price)
    market_side = 0 if not price_ok else (1 if last_yes_price >= 0.5 else -1)
    fired = bool(
        core_side == 0
        and market_q1
        and c54_prediction in (-1, 1)
        and market_side == c54_prediction
        and price_ok
        and abs(last_yes_price - 0.5) >= minimum_distance
    )
    return (c54_prediction if fired else core_side), fired


def evaluate(
    state: C85State,
    *,
    ticker: str,
    target_open: datetime,
    direction_bundle: dict[str, Any] | None,
    meta_bundle: dict[str, Any] | None,
    direction_features: dict[str, float | None],
    meta_features_without_aux: dict[str, float | None],
    auxiliary_outputs: dict[str, float | None],
    validity: dict[str, bool],
    c54_prediction: int,
    market_q1: bool,
    last_yes_price: float | None,
    run_mode: str = "LIVE",
) -> Decision:
    """Run the full chain and mutate `state` exactly once for this target."""
    decision = Decision(ticker=ticker, target_open=target_open, run_mode=run_mode)
    decision.validity = dict(validity)
    decision.last_yes_price = last_yes_price
    decision_ns = int(target_open.timestamp() * NS) + 5 * NS

    # A boundary without an applicable fit abstains; it never reuses stale weights.
    if direction_bundle is None or meta_bundle is None:
        decision.status = "INVALID"
        decision.status_reason = "C85_NO_APPLICABLE_FIT"
        decision.gate_reasons.append("no_applicable_fit")
        state.deterioration.consume_settlements(decision_ns)
        return decision

    # 1-2. direction head and core validity
    core_valid = bool(
        validity.get("binance_complete")
        and validity.get("anchor_valid")
        and validity.get("cm_valid")
        and validity.get("source_ok")
    )
    decision.validity["core_valid"] = core_valid

    decision.probability_yes = score_head(direction_bundle, direction_features)
    decision.proposal = proposal_from_probability(decision.probability_yes)

    # 3. correctness head; the four auxiliary inputs are appended in feature order
    meta_features = dict(meta_features_without_aux)
    meta_features.update(auxiliary_outputs)
    decision.probability_correct = score_head(meta_bundle, meta_features)

    # Settlements are consumed before this target's gate is read.
    state.deterioration.consume_settlements(decision_ns)

    # 4. admission rank (family 1)
    eligible = core_valid and decision.proposal in (-1, 1) and decision.probability_yes is not None
    rank, count = state.admission_ranks.observe(
        decision.probability_correct if eligible else None,
        decision.proposal,
        eligible=eligible,
    )
    decision.admission_rank, decision.admission_rank_count = rank, count

    threshold = YES_ADMISSION_RANK if decision.proposal == 1 else NO_ADMISSION_RANK
    core_side = (
        decision.proposal
        if (rank is not None and math.isfinite(rank) and decision.proposal in (-1, 1)
            and rank >= threshold)
        else 0
    )
    if not core_valid:
        core_side = 0
        decision.gate_reasons.append("core_invalid")
    decision.core_side = core_side

    # 5-6. confirmed extension, then the counterfactual base call
    base_side, fired = confirmed_extension_side(
        core_side, market_q1, c54_prediction, last_yes_price
    )
    decision.extension = fired
    decision.base_side = base_side
    if fired:
        decision.gate_reasons.append("confirmed_extension")

    structure_valid = bool(validity.get("structure_valid"))

    # The deterioration stream learns from every nonzero base call, including
    # structure-invalid ones and calls the final filter later vetoes.
    if base_side != 0:
        state.deterioration.register_base_call(decision.identity, base_side, decision_ns)

    gate = state.deterioration.evaluate()
    decision.deterioration = gate
    decision.weak = bool(base_side != 0 and structure_valid and not gate["warm"] and not gate["keep"])
    if gate["warm"]:
        decision.gate_reasons.append("deterioration_warmup")

    # 7. filter rank (family 2): confidence in the FINAL base side
    confidence = None
    if decision.probability_correct is not None and base_side != 0:
        confidence = (
            decision.probability_correct
            if base_side == decision.proposal
            else 1 - decision.probability_correct
        )
    f_rank, f_count = state.filter_ranks.observe(
        confidence, base_side, eligible=(base_side != 0 and structure_valid)
    )
    decision.filter_rank, decision.filter_rank_count = f_rank, f_count

    # 8. final keep. NaN rank < 0.40 is False by design.
    rank_below = f_rank is not None and math.isfinite(f_rank) and f_rank < FILTER_RANK_FLOOR
    keep = structure_valid and not (decision.weak and rank_below)
    decision.final_side = base_side if keep else 0
    if not structure_valid:
        decision.gate_reasons.append("structure_invalid")
    elif decision.weak and rank_below:
        decision.gate_reasons.append("deterioration_veto")

    decision.status = "PUBLISHED" if decision.is_directional else "ABSTAIN"
    state.last_processed_target_utc = target_open.astimezone(timezone.utc).isoformat()
    return decision
