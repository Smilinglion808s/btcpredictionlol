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
# RESOLVED 2026-09-07 against the fully expanded C85_Upstream_Recovery.zip
# (986 files after recursive expansion; inventory in
# evaluation-fixtures/upstream/FILE_INDEX.json, exact chosen paths + sha256 in
# evaluation-fixtures/upstream/UPSTREAM_RESOLVED.json).
#
# The earlier "UNAVAILABLE" verdict on the leaf chain was WRONG: every named
# producer module and every named shadow ledger is present. Historical coverage
# of each ledger is recorded below. What remains is (a) transcribing each
# producer's live computation, and (b) continuation inputs after the ledger
# cutoff (2026-08-31), which this archive explicitly does not contain.

_LEDGER_ROOT = "evaluation-fixtures/upstream/"
_R4_LEDGER = (
    "vault_work/legacy_lab2/sources/T5_BASELINE_R4_1_FREEZE_PACKAGE.zip"
    "/external_research/htf_structure_r3_output/t5_book_day4h_r4_1_rows.csv"
    " (26,124 rows, 2025-12-01T00:00Z..2026-08-31T22:30Z, sha256 6bfd44cedf8b...)"
)
_T5_HOT = (
    "vault_work/legacy_c42/C42_MATURATION_CONSENSUS_R1/inputs/t5_hot_calibration_ledger.csv"
    " (26,124 rows, 2025-12-01..2026-08-31, sha256 808c9d4f6998...)"
)
_C30_LEDGERS = (
    "vault_work/legacy_c42/C42_MATURATION_CONSENSUS_R1/inputs/fee_coverage_shadow_ledger.csv"
    " (19,780 rows, 2026-02-06T23:00Z..2026-08-31T23:45Z, sha256 d5b693636d62...)",
    "vault_work/legacy_c30/external_research/c30_c70_lab_manager_r2_output/selected_shadow_ledger.csv"
    " (19,780 rows, same window, sha256 0dfb6862e4bb...)",
    "vault_work/legacy_lab2/sources/T0_T5_WIN_CONTAINMENT_DEEP_DIVE_R1_PACKAGE.zip"
    "/external_research/t0_t5_fixed_floor_containment_r1_output/fixed_floor_shadow_ledger.csv"
    " (19,780 rows, same window, sha256 c4a13bcfdd3c...)",
    _T5_HOT,
)

# Continuation gap that applies to EVERY leaf entry below. Derived from the real
# ledger cutoffs, not hard-coded to a fixed number of refits.
CONTINUATION_GAP = (
    "All recovered leaf ledgers stop at 2026-08-31 (fee/selected/fixed_floor at "
    "23:45Z, t5_hot / r4 rows at 22:30Z). Live scoring after that date requires "
    "rebuilding each stage chronologically from its own raw inputs; the upstream "
    "archive is not a September continuation dataset."
)

LEAF_DEPENDENCIES: tuple[Dependency, ...] = (
    Dependency(
        "external_direction", UNPORTED,
        ("vault_work/legacy_lab2/sources/T0_T5_MULTIVENUE_LAB_R1_COMPACT.zip"
         "/evaluate_external_direction_r1.py::directional_matrix (sha256 e88f9c00e9b0...)",),
        (),
        "Producer source recovered and readable. Historical values available as the "
        "`external_direction` column of fee_coverage_shadow_ledger.csv. Live value needs "
        "the directional_matrix venue feature build to be transcribed. " + CONTINUATION_GAP,
    ),
    Dependency(
        "external_rank", UNPORTED,
        ("vault_work/legacy_c30/external_research/c30_c70_lab_manager_r2.py::map_external_scores"
         " (sha256 151a768fd68f...)",),
        (),
        "Ranking math already transcribed in leaf.py; input series present as "
        "`external_rank` / `external_rank_t0` / `external_rank_t5` in the recovered "
        "ledgers. " + CONTINUATION_GAP,
    ),
    Dependency(
        "c30_prediction", UNPORTED,
        ("vault_work/legacy_c30/external_research/c30_c70_lab_manager_r2.py"
         "::make_dual_score_policy / load_lab_frame",),
        (),
        "load_lab_frame() inputs are all present: " + "; ".join(_C30_LEDGERS) + ". "
        "Historical output is `prediction_cov30` in selected_shadow_ledger.csv. " + CONTINUATION_GAP,
    ),
    Dependency(
        "c36_prediction", UNPORTED,
        ("vault_work/legacy_c37/external_research/c36_fee_frontier_r3.py",
         "vault_work/legacy_c37/external_research/c36_timing_robustness_r1.py"),
        (),
        "Admission math ported; inputs prediction_cov30 / candidate_t5_router_prediction "
        "present in the recovered C30 ledger chain. " + CONTINUATION_GAP,
    ),
    Dependency(
        "c37_prediction", UNPORTED,
        ("vault_work/legacy_c37/external_research/c37_balanced_maturation_r1.py"
         " (sha256 5eb0ff87d554...)",),
        (),
        "Same ledger chain as c36, plus mean_135_rank. " + CONTINUATION_GAP,
    ),
    Dependency(
        "mean_135_rank", UNPORTED,
        ("c37_balanced_maturation_r1.py:360", "c36_fee_frontier_r3.py:498"),
        (),
        "Rank blend over the three recovered rank series (external_rank, "
        "t5_reliability_rank, r4_directional_rank). " + CONTINUATION_GAP,
    ),
    Dependency(
        "expansion_selected_prediction", UNPORTED,
        ("vault_work/legacy_lab2/sources/T5_BASELINE_R4_1_FREEZE_PACKAGE.zip"
         "/external_research/htf_structure_r4_refine.py (sha256 f4c58d7676a8...)",
         "r5_lab_manager_phase4.py::expansion selector",),
        (),
        "The R4.3 expansion selector's input freeze IS recovered: " + _R4_LEDGER + ". " +
        CONTINUATION_GAP,
    ),
    Dependency("r4_probability_correct", UNPORTED,
               ("vault_work/legacy_lab2/sources/R5_Lab_Manager_Research_Checkpoint_2026-09-02.zip"
                "/external_research/r5_lab_manager.py (sha256 b38454a9a2eb...)",),
               (),
               "Present as `r4_probability_correct` in " + _T5_HOT + ". " + CONTINUATION_GAP),
    Dependency("r4_directional_rank", UNPORTED,
               ("r5_lab_manager_phase3.py:92-98",), (),
               "Rank math ported; probability series recovered in " + _T5_HOT + ". " +
               CONTINUATION_GAP),
    Dependency("r4_prediction", UNPORTED,
               ("vault_work/legacy_lab2/sources/R5_Lab_Manager_Research_Checkpoint_2026-09-02.zip"
                "/external_research/r5_lab_manager.py",),
               (),
               "Read as `base_direction` / `r4_prediction` from " + _T5_HOT + ". " +
               CONTINUATION_GAP),
    Dependency(
        "structure_valid", UNPORTED,
        ("research_c85/kalshi.py:27 (f81.source_valid)",
         "C85_Lovable_Kit.zip original_c85_layout/: research_c57, research_c58, research_c61, "
         "research_c76, research_c78, research_c80 and lab_recovered/"
         "BTC15M_C71_RESEARCH_CHECKPOINT_2026-09-05/ are all present, path-preserved",),
        (),
        "Package trees ARE supplied; the remaining work is import/packaging configuration "
        "plus transcribing the f81 source-validity computation. Never pinned true.",
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
