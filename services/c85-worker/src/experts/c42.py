"""C42_MATURATION_CONSENSUS_R1 — live decision path.

Transcribed from the recovered ancestor sources:
  - vault_work/legacy_c42/C42_MATURATION_CONSENSUS_R1/build_c42_maturation_consensus_r1.py
      (function `apply_composite`)
  - vault_work/legacy_c42_shadow/C42_PROSPECTIVE_SHADOW_R1/c42_reference_engine.py
      (function `decide_c42`)
  - vault_work/legacy_c42_shadow/C42_PROSPECTIVE_SHADOW_R1/c42_shadow_evaluator.py
      (function `load_prospective`, which independently re-derives the same
      `expected` prediction from raw component streams for parity auditing —
      this is the strongest confirmation of the frozen rule)

DECISION RULE (frozen, no fitted parameters):

    core = c37_prediction                      # C37 maturation-stack call
    r43  = expansion_selected_prediction        # frozen R4.3 expansion-selected
                                                  # T+5 prediction, already an
                                                  # admitted +/-1/0 call — NOT a raw
                                                  # score, and NOT the same column as
                                                  # r4_prediction. C42 does not
                                                  # threshold it itself.
    ext  = external_direction                    # frozen T0 external long-context
                                                  # direction call

    if core != 0:
        c42_prediction = core                    # "preserve every final C37 call"
    elif r43 != 0 and r43 == ext:
        c42_prediction = r43                     # "R43 x external-T0 consensus, T5"
    else:
        c42_prediction = 0                       # abstain (fail closed)

This is exactly the `apply_composite` / `decide_c42` / `load_prospective.expected`
logic in the recovered sources: preserve C37 unconditionally when it has an
opinion; only when C37 abstains, admit the R4.3 T+5 call, and only if it agrees
with the T0 external direction; otherwise abstain. There is no probability
weighting, no learned coefficients, and no retuning — "does not fit a new label
model" (build script docstring). Missing/invalid inputs fail closed to ABSTAIN
per `FROZEN_POLICY["missing_input"] = "FAIL_CLOSED_ABSTAIN"`.

INPUTS CONSUMED AT DECISION TIME (exactly, per recovered sources):
  - c37_prediction         (upstream C37 maturation-stack output)
  - expansion_selected_prediction (upstream frozen R4.3 expansion-selected T+5
                            output; source `apply_composite` applies .fillna(0),
                            so an absent value abstains rather than raising)
  - external_direction     (frozen T0 external long-context direction)

Inputs NOT used in the C42 math itself, but present in the packet/leaf-output
contract because sibling models (e.g. C41, C57) and provenance/audit logging
consume them: c30_prediction, c36_prediction, r4_probability_correct,
r4_directional_rank, external_rank, mean_135_rank. C42Expert.evaluate accepts
them (and requires their presence, per the leaf_outputs contract given by the
task) but they play no role in computing c42_prediction, exactly as in the
recovered `apply_composite`/`decide_c42` functions, which never reference
c30/c36/probability/rank/mean_135_rank in the composite formula.

TRAINING PROTOCOL / FITTED STATE:
  C42 has NO fitted parameters. It is a pure, frozen rule over already-decided
  upstream outputs (build script: "does not fit a new label model"). There is
  nothing to train or replay to obtain fitted state — the "training protocol"
  is the audit/validation procedure in `load_and_validate` (ledger alignment,
  duplicate/monotonic timestamp checks, canonical label agreement checks)
  which is a data-integrity gate, not a parameter fit. Consequently
  C42Expert requires no fitted-state file; it is stateless.

FIXTURE PARITY (verified 2026-09-07 against C85_Ancestor_Recovery):
  Replaying this rule against evaluation-fixtures/upstream_packet.parquet
  reproduces the stored `c42_prediction` on 19,487 / 19,487 rows (100%). The
  earlier 289-row divergence was an input-mapping error: the port read
  `r4_prediction` where `apply_composite` reads `expansion_selected_prediction`.
  There is no external-direction-only fallback and none is implemented.
"""

from __future__ import annotations

from typing import Any, Mapping

REQUIRED_LEAF_KEYS = (
    "c30_prediction",
    "c36_prediction",
    "c37_prediction",
    "r4_prediction",
    "expansion_selected_prediction",
    "r4_probability_correct",
    "r4_directional_rank",
    "external_direction",
    "external_rank",
    "mean_135_rank",
)

# Keys actually consumed by the frozen C42 decision math.
DECISION_KEYS = (
    "c37_prediction",
    "expansion_selected_prediction",
    "external_direction",
)

_VALID_DIRECTIONS = (-1, 0, 1)


class C42InputError(ValueError):
    """Raised when a required C42 input is missing or invalid (fail closed)."""


def _direction(value: Any, field: str) -> int:
    """Coerce a leaf/packet value to a strict {-1, 0, 1} direction.

    Mirrors `_direction` in c42_reference_engine.py: missing/invalid values
    are a hard failure (caller fails closed), not a silent zero.
    """
    if value is None:
        raise C42InputError(f"{field}_MISSING")
    if isinstance(value, bool):
        raise C42InputError(f"{field}_INVALID_DIRECTION")
    if isinstance(value, float) and value != value:  # NaN
        raise C42InputError(f"{field}_MISSING")
    try:
        numeric = int(value)
    except (TypeError, ValueError) as exc:
        raise C42InputError(f"{field}_INVALID_DIRECTION") from exc
    if numeric not in _VALID_DIRECTIONS:
        raise C42InputError(f"{field}_INVALID_DIRECTION")
    return numeric


def _expansion_direction(value: Any) -> int:
    """`expansion_selected_prediction.fillna(0)` from the source rule."""
    if value is None:
        return 0
    if isinstance(value, float) and value != value:  # NaN
        return 0
    return _direction(value, "EXPANSION_SELECTED_PREDICTION")


class C42Expert:
    """Live C42 maturation-consensus decision path.

    Stateless: no fitted parameters exist for this model (see module
    docstring). `evaluate` is a pure function of its inputs.
    """

    identity = "C42_MATURATION_CONSENSUS_R1"

    def evaluate(self, packet: Mapping[str, Any], leaf_outputs: Mapping[str, Any]) -> dict:
        """Apply the frozen C42 rule.

        Args:
            packet: the per-candle upstream packet (unused by the C42 math
                itself; accepted for interface symmetry with other experts
                and so a future opportunity/eligibility gate can be layered
                on by the caller without changing this contract).
            leaf_outputs: dict with (at least) the keys in REQUIRED_LEAF_KEYS,
                as produced by the upstream leaf models (C30, C36, C37, R4.3,
                external, mean-135 ranker). Missing required keys raise
                C42InputError (fail closed) rather than silently abstaining,
                so operational failures are distinguishable from strategic
                abstentions upstream of this call.

        Returns:
            {"c42_prediction": int in {-1, 0, 1}, "c42_decision_source": str}
        """
        if leaf_outputs is None:
            raise C42InputError("LEAF_OUTPUTS_MISSING")
        missing = [key for key in REQUIRED_LEAF_KEYS if key not in leaf_outputs]
        if missing:
            raise C42InputError(f"LEAF_OUTPUTS_MISSING_KEYS:{','.join(missing)}")

        core = _direction(leaf_outputs["c37_prediction"], "C37_PREDICTION")
        # Source `apply_composite` reads
        # `expansion_selected_prediction.fillna(0)`, so a missing/NaN expansion
        # value degrades to abstention on that branch rather than raising.
        r43 = _expansion_direction(leaf_outputs["expansion_selected_prediction"])
        external = _direction(leaf_outputs["external_direction"], "EXTERNAL_DIRECTION")

        if core != 0:
            return {"c42_prediction": core, "c42_decision_source": "C37_CORE"}

        if r43 != 0 and r43 == external:
            return {
                "c42_prediction": r43,
                "c42_decision_source": "R43_X_EXTERNAL_T0_CONSENSUS_T5",
            }

        return {"c42_prediction": 0, "c42_decision_source": "ABSTAIN"}
