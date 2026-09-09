"""Incremental T0/T5 coverage-control producer — the shared C30/C36/C37 precursor.

C30 (`c30_c70_lab_manager_r2`), C36 (`c36_timing_robustness_r1`,
`c36_fee_frontier_r3`) and C37 (`c37_balanced_maturation_r1`) do NOT each build
their own per-target state. They all consume one common computation, recovered
verbatim from `t0_t5_fee_coverage_frontier_r1.py`:

    load_frame -> add_confidence_scores -> directional_past_rank
                                        -> make_policy / make_adaptive_policy

C30 reaches it through `t0_t5_win_containment_deep_dive_r1.load_rich_frame`,
which calls `control.load_frame` + `control.add_confidence_scores` before adding
its own R2/R5/hot columns; C36 and C37 consume C30's phase3 / timing ledgers,
which are built on the same rows. So the first concrete ancestor producer the
live worker needs is this one, and it is what this module implements.

Everything here is the ORIGINAL rule, restated as a per-target state machine so
one target can be scored when its inputs arrive instead of re-running a
whole-history batch:

  * `directional_past_rank`: strictly past-only percentile inside the forecast
    direction, lookback 768 per direction, minimum 96 prior observations,
    `(#less + 0.5 * #equal) / n`. Non-finite values are neither ranked nor
    remembered; a value is remembered even when its own rank is withheld.
  * `add_confidence_scores`: R2/R4 direction-adjusted correctness, their mean
    blend over the available heads, the active direction margin (context margin
    when the T5 router overrides the candidate base direction, ensemble margin
    otherwise), the T0/opening agreement bonuses, and the MARGIN_ONLY rank as
    the deterministic cold-start fallback for every other rank series.
  * `make_adaptive_policy`: the label-free trailing coverage controller —
    calibration window 768 opportunities, minimum history 384, refresh every 96,
    candidate grid 0.000..0.950 step 0.005, ties broken toward the HIGHER
    (fee-conservative) threshold.
  * `make_policy`: the fixed-threshold T0-first policy.

No value is imputed, no threshold is invented and no outcome is consulted by the
controller. A row missing a required field raises rather than scoring.
"""
from __future__ import annotations

import json
import math
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Iterable

RANK_LOOKBACK_PER_DIRECTION = 768
RANK_MINIMUM_PER_DIRECTION = 96

CALIBRATION_WINDOW = 768
MINIMUM_HISTORY = 384
REFRESH_EVERY = 96

# np.round(np.arange(0.0, 0.950001, 0.005), 3)
CANDIDATE_THRESHOLDS: tuple[float, ...] = tuple(round(i * 0.005, 3) for i in range(191))

RAW_SCORES = (
    "MARGIN_ONLY",
    "R2_ADJUSTED",
    "R4_ADJUSTED",
    "R2_R4_BLEND",
    "BLEND_PLUS_OPENING_003",
    "BLEND_PLUS_T0_AND_OPENING_003",
)

REQUIRED_FIELDS = (
    "ts",
    "candidate_t5_router_prediction",
    "candidate_base_direction",
    "candidate_prediction",
    "candidate_stage",
    "r2_probability_correct",
    "r2_base_probability_green",
    "r4_probability_correct",
    "r4_base_direction",
    "base_probability_green",
    "p_pf_context_logit",
    "external_direction",
    "external_rank",
    "opening_direction",
    "t5_input_complete",
    "label",
)


class CoverageInputError(RuntimeError):
    """A target row cannot be scored faithfully; never substituted or zero-filled."""


def _float(value: Any) -> float:
    if value is None:
        return math.nan
    try:
        out = float(value)
    except (TypeError, ValueError):
        return math.nan
    return out


def _direction(value: Any) -> int:
    number = _float(value)
    if not math.isfinite(number):
        return 0
    return int(number)


def _truthy(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "t", "yes"}
    try:
        if isinstance(value, float) and math.isnan(value):
            return False
    except TypeError:
        pass
    return bool(value)


class DirectionalPastRank:
    """`directional_past_rank` as an online, order-sensitive state machine."""

    def __init__(
        self,
        lookback: int = RANK_LOOKBACK_PER_DIRECTION,
        minimum: int = RANK_MINIMUM_PER_DIRECTION,
    ) -> None:
        self.lookback = lookback
        self.minimum = minimum
        self.history: dict[int, deque[float]] = {
            -1: deque(maxlen=lookback),
            1: deque(maxlen=lookback),
        }

    def observe(self, value: float, direction: int) -> float:
        if direction not in self.history or not math.isfinite(value):
            return math.nan
        prior = self.history[direction]
        rank = math.nan
        if len(prior) >= self.minimum:
            less = 0
            equal = 0
            for seen in prior:
                if seen < value:
                    less += 1
                elif seen == value:
                    equal += 1
            rank = (less + 0.5 * equal) / len(prior)
        prior.append(float(value))
        return rank

    def dump(self) -> dict[str, Any]:
        return {
            "lookback": self.lookback,
            "minimum": self.minimum,
            "history": {str(k): list(v) for k, v in self.history.items()},
        }

    @classmethod
    def load(cls, payload: dict[str, Any]) -> "DirectionalPastRank":
        obj = cls(int(payload["lookback"]), int(payload["minimum"]))
        for key, values in payload["history"].items():
            obj.history[int(key)] = deque(
                (float(v) for v in values), maxlen=obj.lookback
            )
        return obj


@dataclass
class CoverageController:
    """`make_adaptive_policy`'s trailing controller for one target coverage."""

    target_coverage: float
    calibration_window: int = CALIBRATION_WINDOW
    minimum_history: int = MINIMUM_HISTORY
    refresh_every: int = REFRESH_EVERY
    threshold: float = field(init=False)
    seen: int = 0
    window: deque[tuple[bool, float, float]] = field(default_factory=deque)

    def __post_init__(self) -> None:
        self.threshold = (
            0.0 if self.target_coverage >= 0.999 else 1.0 - self.target_coverage
        )
        if not self.window:
            self.window = deque(maxlen=self.calibration_window)
        else:  # restored
            self.window = deque(self.window, maxlen=self.calibration_window)

    def _recalibrate(self) -> None:
        recent = list(self.window)
        best_threshold = self.threshold
        best_distance = math.inf
        for candidate in CANDIDATE_THRESHOLDS:
            called = 0
            for t0_eligible, external_rank, t5_rank in recent:
                if candidate <= 0:
                    called += 1
                    continue
                use_t0 = (
                    t0_eligible
                    and math.isfinite(external_rank)
                    and external_rank >= candidate
                )
                use_t5 = (
                    (not use_t0)
                    and math.isfinite(t5_rank)
                    and t5_rank >= candidate
                )
                if use_t0 or use_t5:
                    called += 1
            coverage = called / len(recent)
            distance = abs(coverage - self.target_coverage)
            # np.isclose tie handling, taking the LAST (highest) tied candidate.
            if distance < best_distance - 1e-9 or (
                abs(distance - best_distance) <= 1e-8 + 1e-5 * abs(distance)
            ):
                if distance < best_distance:
                    best_distance = distance
                best_threshold = candidate
        self.threshold = float(best_threshold)

    def decide(
        self,
        *,
        t0_eligible: bool,
        external_rank: float,
        external_direction: int,
        t5_rank: float,
        t5_direction: int,
    ) -> dict[str, Any]:
        """Advance the controller by one OPPORTUNITY row and return its call."""

        if (
            self.target_coverage < 0.999
            and self.seen >= self.minimum_history
            and self.seen % self.refresh_every == 0
        ):
            self._recalibrate()

        threshold = self.threshold
        if threshold <= 0:
            use_t0 = bool(t0_eligible)
            use_t5 = not use_t0
        else:
            use_t0 = bool(
                t0_eligible
                and math.isfinite(external_rank)
                and external_rank >= threshold
            )
            use_t5 = bool(
                (not use_t0) and math.isfinite(t5_rank) and t5_rank >= threshold
            )
        if use_t0:
            prediction, stage = external_direction, "T0"
        elif use_t5:
            prediction, stage = t5_direction, "T5"
        else:
            prediction, stage = 0, "ABSTAIN"

        self.window.append((bool(t0_eligible), external_rank, t5_rank))
        self.seen += 1
        return {
            "prediction": int(prediction),
            "stage": stage,
            "active_threshold": float(threshold),
        }

    def dump(self) -> dict[str, Any]:
        return {
            "target_coverage": self.target_coverage,
            "calibration_window": self.calibration_window,
            "minimum_history": self.minimum_history,
            "refresh_every": self.refresh_every,
            "threshold": self.threshold,
            "seen": self.seen,
            "window": [[bool(a), b, c] for a, b, c in self.window],
        }

    @classmethod
    def load(cls, payload: dict[str, Any]) -> "CoverageController":
        obj = cls(
            target_coverage=float(payload["target_coverage"]),
            calibration_window=int(payload["calibration_window"]),
            minimum_history=int(payload["minimum_history"]),
            refresh_every=int(payload["refresh_every"]),
        )
        obj.threshold = float(payload["threshold"])
        obj.seen = int(payload["seen"])
        obj.window = deque(
            ((bool(a), float(b), float(c)) for a, b, c in payload["window"]),
            maxlen=obj.calibration_window,
        )
        return obj


class CoverageControlProducer:
    """Per-target producer for the shared C30/C36/C37 precursor frame.

    `observe(row)` consumes ONE chronological target and returns its confidence
    scores, ranks and policy calls. State (rank windows + controllers + cursor)
    is serialisable, so a restart resumes on exactly the next target.
    """

    def __init__(self, coverages: Iterable[float] = (0.30, 0.70)) -> None:
        self.ranks = {name: DirectionalPastRank() for name in RAW_SCORES}
        self.controllers = {
            f"cov{int(round(c * 100))}": CoverageController(c) for c in coverages
        }
        self.cursor: str | None = None
        self.processed = 0

    # ---------------------------------------------------------------- inputs
    @staticmethod
    def _require(row: dict[str, Any]) -> None:
        missing = [f for f in REQUIRED_FIELDS if f not in row]
        if missing:
            raise CoverageInputError(
                "C85_COVERAGE_INPUT_INCOMPLETE: missing "
                + ", ".join(sorted(missing))
                + " — the row is not scored and nothing is imputed"
            )

    # ---------------------------------------------------------------- scoring
    def observe(self, row: dict[str, Any]) -> dict[str, Any]:
        self._require(row)
        ts = str(row["ts"])
        if self.cursor is not None and ts <= self.cursor:
            raise CoverageInputError(
                f"C85_COVERAGE_OUT_OF_ORDER: {ts} is not after cursor {self.cursor}"
            )

        t5_direction = _direction(row["candidate_t5_router_prediction"])
        candidate_base = _direction(row["candidate_base_direction"])
        external_direction = _direction(row["external_direction"])
        opening_direction = _direction(row["opening_direction"])

        r2_probability = _float(row["r2_probability_correct"])
        r2_green = _float(row["r2_base_probability_green"])
        r2_base = 0 if not math.isfinite(r2_green) else (1 if r2_green >= 0.5 else -1)
        r2_adjusted = (
            r2_probability if t5_direction == r2_base else 1.0 - r2_probability
        )
        if not math.isfinite(r2_probability) or r2_base == 0:
            r2_adjusted = math.nan

        r4_probability = _float(row["r4_probability_correct"])
        r4_base = _direction(row["r4_base_direction"])
        r4_adjusted = (
            r4_probability if t5_direction == r4_base else 1.0 - r4_probability
        )
        if not math.isfinite(r4_probability) or r4_base == 0:
            r4_adjusted = math.nan

        available = [v for v in (r2_adjusted, r4_adjusted) if math.isfinite(v)]
        blend = sum(available) / len(available) if available else math.nan

        context_override = t5_direction != candidate_base
        ensemble_margin = abs(_float(row["base_probability_green"]) - 0.5)
        context_margin = abs(_float(row["p_pf_context_logit"]) - 0.5)
        active_margin = context_margin if context_override else ensemble_margin

        agrees_t0 = external_direction != 0 and t5_direction == external_direction
        agrees_opening = opening_direction != 0 and t5_direction == opening_direction

        raw = {
            "MARGIN_ONLY": active_margin,
            "R2_ADJUSTED": r2_adjusted,
            "R4_ADJUSTED": r4_adjusted,
            "R2_R4_BLEND": blend,
            "BLEND_PLUS_OPENING_003": blend + 0.03 * float(agrees_opening),
            "BLEND_PLUS_T0_AND_OPENING_003": (
                blend + 0.03 * float(agrees_t0) + 0.03 * float(agrees_opening)
            ),
        }
        # MARGIN_ONLY is ranked first: it is the cold-start fallback for the rest.
        margin_rank = self.ranks["MARGIN_ONLY"].observe(
            raw["MARGIN_ONLY"], t5_direction
        )
        ranks = {"MARGIN_ONLY": margin_rank}
        for name in RAW_SCORES[1:]:
            rank = self.ranks[name].observe(raw[name], t5_direction)
            ranks[name] = rank if math.isfinite(rank) else margin_rank

        label = _float(row["label"])
        candidate_prediction = _direction(row["candidate_prediction"])
        opportunity = (
            _truthy(row["t5_input_complete"])
            and candidate_prediction != 0
            and math.isfinite(label)
            and label != 0
        )

        t5_rank = ranks["R2_R4_BLEND"]
        external_rank = _float(row["external_rank"])
        t0_eligible = str(row["candidate_stage"]) == "T0"

        policies: dict[str, Any] = {}
        for tag, controller in self.controllers.items():
            if not opportunity:
                policies[tag] = {
                    "prediction": 0,
                    "stage": "ABSTAIN",
                    "active_threshold": math.nan,
                    "opportunity": False,
                }
                continue
            call = controller.decide(
                t0_eligible=t0_eligible,
                external_rank=external_rank,
                external_direction=external_direction,
                t5_rank=t5_rank,
                t5_direction=t5_direction,
            )
            policies[tag] = {**call, "opportunity": True}

        self.cursor = ts
        self.processed += 1
        return {
            "ts": ts,
            "opportunity": opportunity,
            "r2_adjusted_probability_correct": r2_adjusted,
            "r4_adjusted_probability_correct": r4_adjusted,
            "reliability_blend_probability_correct": blend,
            "active_direction_margin": active_margin,
            "t5_agrees_t0": agrees_t0,
            "t5_agrees_opening": agrees_opening,
            "t5_reliability_rank": t5_rank,
            "ranks": ranks,
            "external_rank": external_rank,
            "external_direction": external_direction,
            "t5_direction": t5_direction,
            "candidate_stage": str(row["candidate_stage"]),
            "policies": policies,
        }

    # -------------------------------------------------------- fixed threshold
    @staticmethod
    def fixed_policy(
        scored: dict[str, Any], threshold: float
    ) -> dict[str, Any]:
        """`make_policy`: T0-first fixed-threshold call for a scored target."""

        t0_eligible = scored["candidate_stage"] == "T0"
        external_rank = scored["external_rank"]
        t5_rank = scored["t5_reliability_rank"]
        if threshold <= 0:
            use_t0 = t0_eligible
            use_t5 = not use_t0
        else:
            use_t0 = (
                t0_eligible
                and math.isfinite(external_rank)
                and external_rank >= threshold
            )
            use_t5 = (
                (not use_t0) and math.isfinite(t5_rank) and t5_rank >= threshold
            )
        if use_t0:
            return {"prediction": scored["external_direction"], "stage": "T0"}
        if use_t5:
            return {"prediction": scored["t5_direction"], "stage": "T5"}
        return {"prediction": 0, "stage": "ABSTAIN"}

    # ------------------------------------------------------------------ state
    def dump(self) -> dict[str, Any]:
        return {
            "version": 1,
            "cursor": self.cursor,
            "processed": self.processed,
            "ranks": {name: r.dump() for name, r in self.ranks.items()},
            "controllers": {t: c.dump() for t, c in self.controllers.items()},
        }

    @classmethod
    def load(cls, payload: dict[str, Any]) -> "CoverageControlProducer":
        if int(payload.get("version", 0)) != 1:
            raise CoverageInputError("unsupported coverage-control state version")
        obj = cls(coverages=())
        obj.ranks = {
            name: DirectionalPastRank.load(state)
            for name, state in payload["ranks"].items()
        }
        obj.controllers = {
            tag: CoverageController.load(state)
            for tag, state in payload["controllers"].items()
        }
        obj.cursor = payload["cursor"]
        obj.processed = int(payload["processed"])
        return obj

    def save(self, path: Any) -> None:
        from pathlib import Path

        target = Path(path)
        temporary = target.with_suffix(target.suffix + ".tmp")
        temporary.write_text(json.dumps(self.dump()))
        temporary.replace(target)

    @classmethod
    def restore(cls, path: Any) -> "CoverageControlProducer":
        from pathlib import Path

        return cls.load(json.loads(Path(path).read_text()))
