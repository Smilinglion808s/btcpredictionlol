"""Precise dependency ledger for C85's inherited ancestors.

Every entry below was verified against the unpacked supplement
(`C85_Ancestor_Recovery.zip`, `source_index.json` / `data_index.json`). Each
dependency carries one status, and never a blanket "source missing" claim:

  PORTED            transcribed into this worker and passing fixture parity
  RESTORED_STALE    original fitted artifacts installed, but not advanced to today
  UNPORTED          source AND all required artifacts present; not yet transcribed
  UNCONFIGURED      ported/portable, blocked only on a live data feed
  UNAVAILABLE       a named module or artifact is genuinely absent from the archives
  FAILING_PARITY    implemented but not matching the reference

Verified on the supplement (reproduced locally, pinned env):
  verify_c42.py -> 19,487 matched rows, 0 original-rule mismatches
                   (287 mismatches only when the wrong `r4_prediction`
                   column is substituted for `expansion_selected_prediction`)
  verify_c51.py -> 26,304 rows compared, 0 prediction mismatches,
                   245 direction fits, 216 meta fits, 6,524 warmup rows
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

PORTED = "PORTED"
RESTORED_STALE = "RESTORED_STALE"
UNPORTED = "UNPORTED"
UNCONFIGURED = "UNCONFIGURED"
UNAVAILABLE = "UNAVAILABLE"
FAILING_PARITY = "FAILING_PARITY"


@dataclass(frozen=True)
class Dependency:
    key: str
    status: str
    source_modules: tuple[str, ...] = ()      # present, readable source
    missing_artifacts: tuple[str, ...] = ()   # exact filenames NOT in the archives
    detail: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def summary(self) -> str:
        parts = [f"{self.key}: {self.status}"]
        if self.source_modules:
            parts.append("source present: " + ", ".join(self.source_modules))
        if self.missing_artifacts:
            parts.append("absent artifacts: " + ", ".join(self.missing_artifacts))
        if self.detail:
            parts.append(self.detail)
        return " | ".join(parts)


# --- Stages transcribed into this worker -----------------------------------

C42 = Dependency(
    key="c42_prediction",
    status=PORTED,
    source_modules=("source/01c50b819f8e/build_c42_maturation_consensus_r1.py::apply_composite",),
    detail=(
        "Reads expansion_selected_prediction (not r4_prediction) and applies the "
        "opportunity gate. Fixture parity 19,487/19,487, zero mismatches."
    ),
)

C51 = Dependency(
    key="c51_prediction",
    status=RESTORED_STALE,
    source_modules=("source/06cf04da3fa1/build_c51_target_native_rebase_r1.py",),
    detail=(
        "245 direction states and 216 correctness states installed under "
        "artifacts/c51 with the trailing 768-per-side rank history; scoring "
        "matches the archived ledger to 1e-12. States end 2026-08-31T23:45Z, so "
        "the daily 96-row refits from 2026-09-01 onward must be replayed before "
        "live scoring. Continuation inputs for that gap (Binance event features, "
        "Polymarket pre-open book rows, settled labels, C42 ledger for September) "
        "are not in the supplement."
    ),
)

C54 = Dependency(key="c54_prediction", status=PORTED,
                 source_modules=("source/.../build_c54_error_complementarity_router_r1.py",))

# --- Leaf outputs -----------------------------------------------------------
#
# The leaf SOURCE is available and readable (paths below). What is absent is the
# chained shadow-ledger data each harness reads: these scripts are backtest
# harnesses over a previous stage's CSV output, not standalone scorers, so the
# source alone cannot produce a live value.

_R4_LEDGER = "external_research/htf_structure_r3_output/t5_book_day4h_r4_1_rows.csv"
_C30_LEDGERS = (
    "external_research/t0_t5_fee_coverage_frontier_r1_output/fee_coverage_shadow_ledger.csv",
    "external_research/c30_c70_lab_manager_r2_output/selected_shadow_ledger.csv",
    "external_research/t0_t5_fixed_floor_containment_r1_output/fixed_floor_shadow_ledger.csv",
    "external_research/r5_lab_manager_output/t5_hot_calibration_ledger.csv",
)

LEAF_DEPENDENCIES: tuple[Dependency, ...] = (
    Dependency(
        "external_direction", UNAVAILABLE,
        ("source/eb8e707686c9/evaluate_external_direction_r1.py",),
        ("per-venue label/formal-index CSV inputs read at evaluate_external_direction_r1.py:41-59",),
        "Source recovered (T0_T5_MULTIVENUE_LAB_R1_COMPACT.zip). It is an evaluator over "
        "venue-label ledgers it does not build; those ledgers are not in data_index.json.",
    ),
    Dependency(
        "external_rank", UNAVAILABLE,
        ("source/66e944c0b614/c30_c70_lab_manager_r2.py::map_external_scores",),
        _C30_LEDGERS,
        "Ranking math is transcribed in leaf.py; its input series comes from the absent shadow ledgers.",
    ),
    Dependency(
        "c30_prediction", UNAVAILABLE,
        ("source/66e944c0b614/c30_c70_lab_manager_r2.py::make_dual_score_policy/load_lab_frame",),
        _C30_LEDGERS,
        "load_lab_frame() reads the shadow ledgers listed; none are in the supplement.",
    ),
    Dependency(
        "c36_prediction", UNAVAILABLE,
        ("source/567a76607e86/c36_fee_frontier_r3.py", "source/08b5716138dd/c36_timing_robustness_r1.py"),
        _C30_LEDGERS,
        "Admission math ported; inputs prediction_cov30 / candidate_t5_router_prediction come from the C30 ledger chain.",
    ),
    Dependency(
        "c37_prediction", UNAVAILABLE,
        ("source/792d4b4c4f1a/c37_balanced_maturation_r1.py",),
        _C30_LEDGERS,
        "Same ledger chain as c36, plus mean_135_rank.",
    ),
    Dependency(
        "mean_135_rank", UNAVAILABLE,
        ("source/792d4b4c4f1a/c37_balanced_maturation_r1.py:360", "source/567a76607e86/c36_fee_frontier_r3.py:498"),
        _C30_LEDGERS,
    ),
    Dependency(
        "expansion_selected_prediction", UNAVAILABLE,
        ("source/a211367da033/r5_lab_manager_phase4.py:450",
         "source/57cfc02035b3/freeze_t5_baseline_r4_1.py"),
        (_R4_LEDGER,),
        "R4.3 expansion selector reads the frozen R4.1 rows CSV; that file (and the ROWS input "
        "freeze_t5_baseline_r4_1.py:49 reads) is absent.",
    ),
    Dependency("r4_probability_correct", UNAVAILABLE,
               ("source/144005d1f2d0/r5_lab_manager.py:454",), (_R4_LEDGER,)),
    Dependency("r4_directional_rank", UNAVAILABLE,
               ("source/a85e947b1784/r5_lab_manager_phase3.py:92-98",), (_R4_LEDGER,),
               "Rank math ported; input probability series blocked above."),
    Dependency("r4_prediction", UNAVAILABLE,
               ("source/144005d1f2d0/r5_lab_manager.py",),
               ("external_research/r5_lab_manager_output/t5_hot_calibration_ledger.csv",),
               "Read verbatim ('base_direction') from a ledger that is absent."),
    Dependency(
        "structure_valid", UNAVAILABLE,
        ("source/8900bf059075/kalshi.py:27 (f81.source_valid)",),
        ("research_c57/, research_c58/, research_c61/, research_c71/, research_c76/, "
         "research_c78/, research_c80/ importable package trees",),
        "Individual run.py/build files exist under sha-dirs, but the package layout kalshi.py "
        "imports is not intact; structure_valid is never pinned true.",
    ),
)

ALL_DEPENDENCIES: tuple[Dependency, ...] = (C42, C51, C54, *LEAF_DEPENDENCIES)

BLOCKING_STATUSES = {UNAVAILABLE, UNPORTED, UNCONFIGURED, FAILING_PARITY, RESTORED_STALE}


def blocking() -> list[Dependency]:
    return [d for d in ALL_DEPENDENCIES if d.status in BLOCKING_STATUSES]


def report() -> list[dict[str, Any]]:
    return [
        {
            "key": d.key,
            "status": d.status,
            "source_modules": list(d.source_modules),
            "missing_artifacts": list(d.missing_artifacts),
            "detail": d.detail,
        }
        for d in ALL_DEPENDENCIES
    ]
