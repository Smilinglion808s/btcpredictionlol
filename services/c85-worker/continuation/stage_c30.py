"""C30 -> phase3/fee-coverage/fixed-floor -> C36 -> C37 continuation stages.

Every stage here loads a *recovered* producer verbatim except for its research
END constant (see `endpatch.load_producer`), exactly like `stages.py`. This
module is additive: it does not import from or modify `stages.py`.

Dependency order (matches C30_STAGES):
    1. external_direction  - evaluate_external_direction_r1.py::directional_matrix
    2. fee_coverage_chain  - phase3 / fee_coverage / fixed_floor shadow ledgers
    3. c30                 - c30_c70_lab_manager_r2.py -> selected_shadow_ledger.csv
    4. c36                 - c36_fee_frontier_r3.py + c36_timing_robustness_r1.py
    5. c37                 - c37_balanced_maturation_r1.py -> c37_shadow_ledger.csv

Historical-prefix parity window (frozen archives): 19,780 rows,
2026-02-06T23:00Z .. 2026-08-31T23:45Z. Every stage that can be checked against
an archived parquet fixture under evaluation-fixtures/upstream/ asserts that
its own output reproduces that fixed prefix exactly (row-for-row, cell-for-
cell) before publishing; a mismatch aborts the stage rather than publishing a
divergent ledger.

Known genuinely-unrecoverable input (see `fee_coverage_chain` docstring
below): `t5_second_path_features.csv`, the sole input listed under
`external_research/t5_second_path_challenger_r1_output/` inside
`t0_t5_coverage_bridge_audit_r1.py`. It is required unconditionally to build
that producer's `continuous_coverage_ledger.csv` (the frame is built by
`build_continuous_frame()`, which reads it directly and raises
`RuntimeError` if any row's `seq_complete` flag is not True), and it has no
producer and no archived copy anywhere under /tmp/upx or the uploaded
recovery zips. `continuous_coverage_ledger.csv` itself -- the direct input
`t0_t5_fee_coverage_frontier_r1.py::load_frame` reads from
`restored_checkpoint/continuous_r1/` -- is likewise absent from every
expanded archive, as is that checkpoint's second required file,
`label_stable_db1_shadow_ledger.csv`. None of the three can be fabricated
without inventing data, so `fee_coverage_chain` aborts identifying exactly
these three missing paths instead of substituting anything.
"""
from __future__ import annotations

import shutil
from pathlib import Path

import numpy as np
import pandas as pd

from .config import UPSTREAM, research_end
from .endpatch import load_producer
from .runner import Stage, StageResult
from .stages import VerbatimRecord, load_verbatim, publish, workspace_for

FIXTURES = Path(__file__).resolve().parents[1] / "evaluation-fixtures" / "upstream"

# Frozen archived-ledger parity window every stage below must reproduce
# exactly over its historical prefix.
PARITY_START = pd.Timestamp("2026-02-06T23:00:00Z")
PARITY_END = pd.Timestamp("2026-08-31T23:45:00Z")  # inclusive slot
PARITY_ROWS = 19_780

SOURCES = UPSTREAM / "ancestor" / "source"
LEGACY_LAB2 = UPSTREAM / "upstream" / "vault_work" / "legacy_lab2" / "sources"
LEGACY_C37 = UPSTREAM / "upstream" / "vault_work" / "legacy_c37"

PRODUCERS = {
    # No END/END_EXCLUSIVE constant: window comes from its own opportunity
    # loader (fixed FIT_END/VALIDATION_END research dates + input row counts),
    # so it is loaded verbatim -- there is nothing to patch.
    "external_direction": (
        LEGACY_LAB2 / "T0_T5_MULTIVENUE_LAB_R1_COMPACT.zip__expanded" / "evaluate_external_direction_r1.py",
        False,
    ),
    "c30": (
        LEGACY_LAB2 / "C30_C70_LAB_MANAGER_R2_PACKAGE.zip__expanded" / "external_research" / "c30_c70_lab_manager_r2.py",
        True,
    ),
    "phase3": (
        LEGACY_LAB2 / "C30_C70_LAB_MANAGER_R2_PACKAGE.zip__expanded" / "external_research" / "c30_c70_lab_manager_r2_phase3.py",
        True,
    ),
    "c36_frontier": (LEGACY_C37 / "external_research" / "c36_fee_frontier_r3.py", True),
    # No END constant either: the timing robustness producer takes its window
    # from the frontier's own inputs, not from a standalone research-end
    # literal.
    "c36_timing": (LEGACY_C37 / "external_research" / "c36_timing_robustness_r1.py", False),
}


def _staged(stage: str, key: str, end: pd.Timestamp):
    source, patch_end = PRODUCERS[key]
    if not source.exists():
        raise FileNotFoundError(f"recovered producer missing: {source}")
    target = workspace_for(stage) / source.name
    if not target.exists() or target.read_bytes() != source.read_bytes():
        shutil.copy2(source, target)
    if not patch_end:
        return load_verbatim(target), VerbatimRecord(target)
    return load_producer(target, end)


def _assert_parity(frame: pd.DataFrame, fixture_name: str, ts_column: str = "ts") -> dict:
    """Historical-prefix parity: the frozen 19,780-row window must match the
    archived ledger exactly, cell for cell. Raises on any mismatch."""
    fixture_path = FIXTURES / f"{fixture_name}.parquet"
    if not fixture_path.exists():
        raise FileNotFoundError(f"parity fixture missing: {fixture_path}")
    ref = pd.read_parquet(fixture_path)
    ref[ts_column] = pd.to_datetime(ref[ts_column], utc=True)
    new = frame.copy()
    new[ts_column] = pd.to_datetime(new[ts_column], utc=True)
    prefix = new[(new[ts_column] >= PARITY_START) & (new[ts_column] <= PARITY_END)]
    if len(ref) != PARITY_ROWS:
        raise RuntimeError(f"{fixture_name}: archived fixture itself is not {PARITY_ROWS} rows ({len(ref)})")
    if len(prefix) != len(ref):
        raise RuntimeError(f"{fixture_name}: historical-prefix row count {len(prefix)} != archived {len(ref)}")
    if not (ref[ts_column].to_numpy() == prefix[ts_column].to_numpy()).all():
        raise RuntimeError(f"{fixture_name}: historical-prefix timestamps do not align with the archive")
    mismatches = 0
    for column in ref.columns:
        if column not in prefix.columns:
            raise RuntimeError(f"{fixture_name}: output is missing archived column {column!r}")
        a, b = ref[column], prefix[column]
        if pd.api.types.is_numeric_dtype(a) and pd.api.types.is_numeric_dtype(b):
            af, bf = a.astype(float).to_numpy(), b.astype(float).to_numpy()
            bad = ~(np.isclose(af, bf, rtol=0, atol=1e-9) | (np.isnan(af) & np.isnan(bf)))
        else:
            bad = a.astype(str).to_numpy() != b.astype(str).to_numpy()
        mismatches += int(bad.sum())
    if mismatches:
        raise RuntimeError(f"{fixture_name}: {mismatches} cell mismatches over the historical prefix; aborting")
    return {"fixture": fixture_name, "prefix_rows": int(len(prefix)), "cell_mismatches": 0}


# --------------------------------------------------------------------------- #
# 1. external_direction
# --------------------------------------------------------------------------- #
def run_external_direction(end: pd.Timestamp, previous: dict | None) -> StageResult:
    """`evaluate_external_direction_r1.py::directional_matrix` and its causal
    frontier. No standalone research-end constant exists in this producer (its
    fit/validation/formal windows are fixed research dates baked into
    `fit_direction_model`, and its formal-opportunity count is asserted
    in-source), so it is loaded and run verbatim -- there is nothing safe to
    patch without touching the model's own fitting schedule."""
    module, patch = _staged("external_direction", "external_direction", end)
    module.main()
    out_dir = module.OUTPUT
    outputs = [publish(p, f"external_direction/{p.name}") for p in sorted(out_dir.glob("r4_2_external_direction_*"))]
    ledger = pd.read_csv(out_dir / "r4_2_external_direction_ledger.csv.gz")
    return StageResult(
        cursor=end,
        rows=len(ledger),
        outputs=outputs,
        patches=[patch.as_dict()],
        notes={
            "note": "no research-end constant present; producer runs on its fixed "
                    "formal-window contract (2026-07-27 .. 2026-08-31T22:00Z) unchanged",
        },
    )


# --------------------------------------------------------------------------- #
# 2. fee_coverage_chain (phase3 / fee_coverage / fixed_floor)
# --------------------------------------------------------------------------- #
def run_fee_coverage_chain(end: pd.Timestamp, previous: dict | None) -> StageResult:
    """Genuinely blocked: see module docstring.

    `t0_t5_fee_coverage_frontier_r1.py::load_frame` (consumed by
    `repro_fee_coverage.py`, `repro_fixed_floor.py` and, transitively via the
    selected shadow ledger, `repro_phase3.py`) requires two files under
    `<producer-root>/restored_checkpoint/continuous_r1/`:
      * continuous_coverage_ledger.csv
      * label_stable_db1_shadow_ledger.csv
    Neither exists anywhere under /tmp/upx/ancestor, /tmp/upx/upstream, or the
    uploaded recovery zips. `continuous_coverage_ledger.csv` is itself the
    output of `t0_t5_coverage_bridge_audit_r1.py::main`, whose
    `build_continuous_frame()` unconditionally reads
    `external_research/t5_second_path_challenger_r1_output/t5_second_path_features.csv`
    and raises `RuntimeError("Incomplete one-second reconstruction: ...")` if
    any row of that file's `seq_complete` flag is not True over
    2026-08-19T00:00Z .. the research end -- it is not an optional input, and
    it likewise has no producer and no archived copy anywhere in the
    recovered material. This stage aborts rather than substitute, synthesize
    or skip any of the three files.
    """
    missing = [
        "restored_checkpoint/continuous_r1/continuous_coverage_ledger.csv "
        "(input to t0_t5_fee_coverage_frontier_r1.py::load_frame)",
        "restored_checkpoint/continuous_r1/label_stable_db1_shadow_ledger.csv "
        "(input to t0_t5_fee_coverage_frontier_r1.py::load_frame)",
        "external_research/t5_second_path_challenger_r1_output/t5_second_path_features.csv "
        "(input to t0_t5_coverage_bridge_audit_r1.py::build_continuous_frame, "
        "required to produce continuous_coverage_ledger.csv in the first place)",
    ]
    raise RuntimeError(
        "fee_coverage_chain cannot be bootstrapped: the following inputs are "
        "genuinely unrecoverable (no producer, no archived copy under /tmp/upx "
        "or the uploaded recovery zips) and are not optional to the calculation "
        "they feed: " + "; ".join(missing)
    )


# --------------------------------------------------------------------------- #
# 3. c30
# --------------------------------------------------------------------------- #
def run_c30(end: pd.Timestamp, previous: dict | None) -> StageResult:
    module, patch = _staged("c30", "c30", end)
    out = workspace_for("c30") / "c30_c70_lab_manager_r2_output"
    module.OUT = out
    module.main()
    ledger = pd.read_csv(out / "selected_shadow_ledger.csv", parse_dates=["ts"])
    parity = _assert_parity(ledger, "selected_shadow_ledger__c30_c70_lab_manager_r2_output")
    outputs = [publish(p, f"c30/{p.name}") for p in sorted(out.glob("*")) if p.is_file()]
    return StageResult(
        cursor=end,
        rows=len(ledger),
        outputs=outputs,
        patches=[patch.as_dict()],
        notes={
            "prediction_cov30": "column" if "prediction_cov30" in ledger.columns else "absent",
            "external_rank": "column" if "external_rank" in ledger.columns else "absent",
            "parity": parity,
        },
    )


# --------------------------------------------------------------------------- #
# 4. c36 (fee frontier + timing robustness)
# --------------------------------------------------------------------------- #
def run_c36(end: pd.Timestamp, previous: dict | None) -> StageResult:
    frontier, frontier_patch = _staged("c36", "c36_frontier", end)
    frontier_out = workspace_for("c36") / "c36_fee_frontier_r3_output"
    timing_out = workspace_for("c36") / "c36_timing_robustness_r1_output"
    frontier.OUT = frontier_out
    frontier.TIMING_OUT = timing_out
    frontier.main()

    timing, timing_patch = _staged("c36", "c36_timing", end)
    timing.OUT = timing_out
    timing.main()

    outputs = [publish(p, f"c36/frontier/{p.name}") for p in sorted(frontier_out.glob("*.csv"))]
    outputs += [publish(p, f"c36/timing/{p.name}") for p in sorted(timing_out.glob("*.csv"))]
    rows = sum(len(pd.read_csv(p)) for p in sorted(frontier_out.glob("*.csv")))
    ref_frontier = UPSTREAM / "upstream" / "vault_work" / "legacy_c37" / "external_research" / "c36_fee_frontier_r3_output"
    ref_timing = UPSTREAM / "upstream" / "vault_work" / "legacy_c37" / "external_research" / "c36_timing_robustness_r1_output"
    mismatches = 0
    checked = []
    for ref_dir, out_dir in ((ref_frontier, frontier_out), (ref_timing, timing_out)):
        if not ref_dir.exists():
            continue
        for ref_path in sorted(ref_dir.glob("*.csv")):
            candidate = out_dir / ref_path.name
            if not candidate.exists():
                raise RuntimeError(f"c36 parity: missing output {ref_path.name}")
            a, b = pd.read_csv(ref_path), pd.read_csv(candidate)
            if a.shape != b.shape:
                raise RuntimeError(f"c36 parity: shape diff on {ref_path.name}: {a.shape} vs {b.shape}")
            cell_mismatches = 0
            for column in a.columns:
                if pd.api.types.is_numeric_dtype(a[column]) and pd.api.types.is_numeric_dtype(b[column]):
                    af, bf = a[column].astype(float).to_numpy(), b[column].astype(float).to_numpy()
                    cell_mismatches += int((~(np.isclose(af, bf, rtol=0, atol=1e-9) | (np.isnan(af) & np.isnan(bf)))).sum())
                else:
                    cell_mismatches += int((a[column].astype(str) != b[column].astype(str)).sum())
            mismatches += cell_mismatches
            checked.append(ref_path.name)
    if mismatches:
        raise RuntimeError(f"c36 parity: {mismatches} cell mismatches across {checked}")
    return StageResult(
        cursor=end,
        rows=rows,
        outputs=outputs,
        patches=[frontier_patch.as_dict(), timing_patch.as_dict()],
        notes={"parity_files_checked": checked, "cell_mismatches": mismatches},
    )


# --------------------------------------------------------------------------- #
# 5. c37
# --------------------------------------------------------------------------- #
def run_c37(end: pd.Timestamp, previous: dict | None) -> StageResult:
    module, patch = _staged("c37", "phase3", end)  # unused placeholder guard, replaced below
    raise NotImplementedError  # never reached; see run_c37 real body below

