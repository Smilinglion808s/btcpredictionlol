"""C30 -> phase3 -> fee-coverage/fixed-floor -> C36 -> C37 continuation stages.

Every stage loads a *recovered* producer with, at most, its research END
constant overridden (`endpatch.load_producer`); feature definitions, fitting
schedules, source venues and model rules are untouched. Producers with no END
constant take their window from their own inputs and are loaded verbatim.

Dependency order (matches C30_STAGES):
    external_direction -> fee_coverage -> fixed_floor -> c30 -> phase3
                                                        -> c36_timing -> c36_frontier -> c37

Historical-prefix parity: every stage that has an archived reference under the
expanded recovery tree asserts its own rebuild reproduces that reference
cell-for-cell before publishing. A mismatch aborts the stage.

Continuation semantics
----------------------
These producers are *input-bound*: their window is set by the base-stage
capture ledgers recovered from the archives, which stop at the frozen end
(2026-08-31T23:45Z inclusive). Overriding END past that point cannot invent
rows, so each stage reports a cursor of `FROZEN_END` and records the residual
gap in `notes["continuation_gap"]` rather than silently claiming to be current.
The END override is still applied through `endpatch`, so the moment the base
captures extend, the same stages advance with no code change.
"""
from __future__ import annotations

import importlib
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from .config import FROZEN_END, UPSTREAM
from .endpatch import load_producer
from .runner import Stage, StageResult
from .stages import VerbatimRecord, publish

REPO = Path(__file__).resolve().parents[1]
SETUP = REPO / "reproduction" / "setup_c30_workspace.sh"
ROOT = Path(os.environ.get("C85_C30_ROOT", "/tmp/c30root"))

LEGACY_C37 = UPSTREAM / "upstream" / "vault_work" / "legacy_c37" / "external_research"

# The frozen archived-ledger parity window.
PARITY_START = pd.Timestamp("2026-02-06T23:00:00Z")
PARITY_END = pd.Timestamp("2026-08-31T23:45:00Z")  # inclusive slot
PARITY_ROWS = 19_780

CONTINUATION_GAP = (
    "input-bound stage: the recovered base-capture ledgers end at "
    "2026-08-31T23:45Z, so this stage cannot advance past FROZEN_END until the "
    "base captures are extended. No rows are synthesised to close the gap."
)


class WorkspaceMissing(RuntimeError):
    pass


# --------------------------------------------------------------------------- #
# workspace
# --------------------------------------------------------------------------- #
def ensure_workspace() -> Path:
    """Idempotently (re)build /tmp/c30root from the expanded recovery archives."""
    marker = ROOT / "external_research" / "c30_c70_lab_manager_r2.py"
    if not marker.exists():
        result = subprocess.run(["bash", str(SETUP)], capture_output=True, text=True)
        if not marker.exists():
            raise WorkspaceMissing(
                f"setup_c30_workspace.sh did not produce {marker}: "
                f"{result.stdout[-1500:]}{result.stderr[-1500:]}")
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    return ROOT


def _import(module: str):
    """Import a producer from the workspace verbatim."""
    ensure_workspace()
    name = f"external_research.{module}"
    if name in sys.modules:
        del sys.modules[name]
    return importlib.import_module(name)


def _patched(module: str, end: pd.Timestamp):
    """Load a producer whose research END constant is overridden, in place.

    The producer is patched on disk inside the workspace so its sibling
    `external_research` imports keep resolving, then imported normally. With
    `end == FROZEN_END` the patched text is byte-identical to the original,
    which is what makes historical-prefix parity provable.
    """
    ensure_workspace()
    from .endpatch import patch_source

    path = ROOT / "external_research" / f"{module}.py"
    patched, record = patch_source(path, end)
    if patched != path.read_text():
        path.write_text(patched)
    return _import(module), record


def _verbatim(module: str):
    ensure_workspace()
    return _import(module), VerbatimRecord(ROOT / "external_research" / f"{module}.py")


# --------------------------------------------------------------------------- #
# parity helpers
# --------------------------------------------------------------------------- #
def _cell_mismatches(ref: pd.DataFrame, new: pd.DataFrame, label: str) -> int:
    if ref.shape != new.shape:
        raise RuntimeError(f"{label}: shape {ref.shape} != rebuilt {new.shape}")
    total = 0
    for column in ref.columns:
        if column not in new.columns:
            raise RuntimeError(f"{label}: rebuild is missing archived column {column!r}")
        a, b = ref[column], new[column]
        if pd.api.types.is_numeric_dtype(a) and pd.api.types.is_numeric_dtype(b):
            af, bf = a.astype(float).to_numpy(), b.astype(float).to_numpy()
            bad = ~(np.isclose(af, bf, rtol=0, atol=1e-12) | (np.isnan(af) & np.isnan(bf)))
        else:
            bad = a.astype(str).to_numpy() != b.astype(str).to_numpy()
        total += int(bad.sum())
    return total


def _assert_frame_parity(reference: Path, frame: pd.DataFrame, label: str) -> dict:
    if not reference.exists():
        raise FileNotFoundError(f"{label}: archived reference missing at {reference}")
    ref = pd.read_csv(reference)
    mismatches = _cell_mismatches(ref, frame.reset_index(drop=True), label)
    if mismatches:
        raise RuntimeError(f"{label}: {mismatches} cell mismatches vs the archive; aborting")
    return {"reference": str(reference), "rows": int(len(ref)), "cell_mismatches": 0}


def _assert_dir_parity(ref_dir: Path, out_dir: Path, label: str) -> dict:
    if not ref_dir.exists():
        raise FileNotFoundError(f"{label}: archived reference directory missing at {ref_dir}")
    checked, total = [], 0
    for ref_path in sorted(ref_dir.glob("*.csv")):
        candidate = out_dir / ref_path.name
        if not candidate.exists():
            raise RuntimeError(f"{label}: rebuild did not produce {ref_path.name}")
        total += _cell_mismatches(pd.read_csv(ref_path), pd.read_csv(candidate),
                                  f"{label}/{ref_path.name}")
        checked.append(ref_path.name)
    if total:
        raise RuntimeError(f"{label}: {total} cell mismatches across {checked}; aborting")
    if not checked:
        raise RuntimeError(f"{label}: no archived CSV references found under {ref_dir}")
    return {"reference_dir": str(ref_dir), "files_checked": checked, "cell_mismatches": 0}


def _publish_dir(out_dir: Path, prefix: str) -> list[str]:
    return [publish(p, f"{prefix}/{p.name}")
            for p in sorted(out_dir.glob("*")) if p.is_file()]


def _result(cursor: pd.Timestamp, rows: int, outputs: list[str], patches: list,
            **notes) -> StageResult:
    return StageResult(
        cursor=cursor,
        rows=rows,
        outputs=outputs,
        patches=[p.as_dict() for p in patches],
        notes={"continuation_gap": CONTINUATION_GAP, **notes},
    )


# --------------------------------------------------------------------------- #
# 1. external_direction
# --------------------------------------------------------------------------- #
def run_external_direction(end: pd.Timestamp, previous: dict | None) -> StageResult:
    """`evaluate_external_direction_r1.py` — no standalone research-end constant
    (its fit/validation/formal windows are fixed research dates inside
    `fit_direction_model`), so it runs verbatim."""
    module, record = _verbatim("evaluate_external_direction_r1")
    out = ROOT / "external_direction_out"
    out.mkdir(parents=True, exist_ok=True)
    module.OUTPUT = out
    module.main()
    ledger = pd.read_csv(out / "r4_2_external_direction_ledger.csv.gz")
    return _result(FROZEN_END, len(ledger), _publish_dir(out, "external_direction"), [record],
                   note="fixed formal-window contract preserved unchanged")


# --------------------------------------------------------------------------- #
# 2. fee_coverage
# --------------------------------------------------------------------------- #
def run_fee_coverage(end: pd.Timestamp, previous: dict | None) -> StageResult:
    """`t0_t5_fee_coverage_frontier_r1.py` adaptive coverage frontier.

    Reads `restored_checkpoint/continuous_r1/{continuous_coverage_ledger,
    label_stable_db1_shadow_ledger}.csv` — both recovered from
    T0_T5_CONTINUOUS_COVERAGE_LAB_CHECKPOINT_R1.
    """
    control, record = _patched("t0_t5_fee_coverage_frontier_r1", end)
    frame = control.load_frame(control.DEFAULT_CHECKPOINT)
    frame, ranks = control.add_confidence_scores(frame)
    opportunity = control.opportunity(frame)
    masks = control.split_masks(frame)
    _, policies = control.build_adaptive_frontier(frame, ranks["R2_R4_BLEND"], opportunity, masks)

    export = frame[[
        "ts", "label", "label_source", "source_segment", "candidate_prediction",
        "candidate_stage", "candidate_t5_router_prediction", "external_direction",
        "external_rank", "r2_adjusted_probability_correct",
        "r4_adjusted_probability_correct", "reliability_blend_probability_correct",
        "active_direction_margin", "t5_reliability_rank",
    ]].copy()
    for target, (prediction, stage, threshold) in policies.items():
        tag = f"cov{int(round(target * 100))}"
        export[f"active_threshold_{tag}"] = threshold
        export[f"prediction_{tag}"] = prediction
        export[f"stage_{tag}"] = stage

    parity = _assert_parity_parquet(export, "fee_coverage_shadow_ledger")
    out = ROOT / "fee_coverage_out"
    out.mkdir(parents=True, exist_ok=True)
    export.to_csv(out / "fee_coverage_shadow_ledger.csv", index=False)
    return _result(FROZEN_END, len(export), _publish_dir(out, "fee_coverage"), [record],
                   parity=parity)


def _assert_parity_parquet(frame: pd.DataFrame, fixture: str, ts_column: str = "ts") -> dict:
    path = REPO / "evaluation-fixtures" / "upstream" / f"{fixture}.parquet"
    if not path.exists():
        raise FileNotFoundError(
            f"parity fixture missing: {path}; run reproduction/restore_upstream_fixtures.py")
    ref = pd.read_parquet(path)
    ref[ts_column] = pd.to_datetime(ref[ts_column], utc=True)
    new = frame.copy().reset_index(drop=True)
    new[ts_column] = pd.to_datetime(new[ts_column], utc=True)
    prefix = new[(new[ts_column] >= PARITY_START) & (new[ts_column] <= PARITY_END)]
    prefix = prefix.reset_index(drop=True)
    if len(ref) != PARITY_ROWS:
        raise RuntimeError(f"{fixture}: archived fixture is {len(ref)} rows, expected {PARITY_ROWS}")
    if len(prefix) != len(ref):
        raise RuntimeError(f"{fixture}: prefix rows {len(prefix)} != archived {len(ref)}")
    if not (ref[ts_column].to_numpy() == prefix[ts_column].to_numpy()).all():
        raise RuntimeError(f"{fixture}: prefix timestamps do not align with the archive")
    mismatches = _cell_mismatches(ref, prefix[list(ref.columns)], fixture)
    if mismatches:
        raise RuntimeError(f"{fixture}: {mismatches} cell mismatches over the historical prefix")
    return {"fixture": fixture, "prefix_rows": int(len(prefix)), "cell_mismatches": 0}


# --------------------------------------------------------------------------- #
# 3. fixed_floor
# --------------------------------------------------------------------------- #
def run_fixed_floor(end: pd.Timestamp, previous: dict | None) -> StageResult:
    """`t0_t5_fixed_floor_containment_r1.py` — the floor is *selected* by the
    producer's own pre-July ranking rule, never hardcoded here."""
    control, control_record = _patched("t0_t5_fee_coverage_frontier_r1", end)
    floor_module, floor_record = _verbatim("t0_t5_fixed_floor_containment_r1")
    stress = _import("t0_t5_branch_budget_stress_r1")

    frame = control.load_frame(control.DEFAULT_CHECKPOINT)
    frame, ranks = control.add_confidence_scores(frame)
    t5_rank = ranks["R2_R4_BLEND"]
    opportunity = control.opportunity(frame)
    masks = control.split_masks(frame)

    full_prediction, full_stage = control.make_policy(frame, t5_rank, 0.0)
    full = {name: control.metrics(frame, full_prediction, full_stage, mask, opportunity)
            for name, mask in masks.items()}
    baseline, baseline_stage, baseline_threshold = control.make_adaptive_policy(
        frame, t5_rank, floor_module.TARGET_COVERAGE, opportunity)
    baseline_row = {"identity": "SHARED_THRESHOLD_CONTROL", "t0_floor": np.nan,
                    "requested_coverage": floor_module.TARGET_COVERAGE,
                    **stress.evaluate(frame, baseline, baseline_stage, opportunity, masks)}
    stress.add_containment(baseline_row, full)

    rows, policies = [], {}
    for floor in floor_module.T0_FLOORS:
        prediction, stage, threshold = floor_module.make_fixed_floor_policy(
            frame, t5_rank, floor, floor_module.TARGET_COVERAGE, opportunity)
        policies[floor] = (prediction, stage, threshold)
        row = {"identity": "FIXED_T0_FLOOR_T5_FILL", "t0_floor": floor,
               "requested_coverage": floor_module.TARGET_COVERAGE,
               **stress.evaluate(frame, prediction, stage, opportunity, masks)}
        stress.add_containment(row, full)
        for split in ("feb_apr_development", "may_jun_validation", "later_challenge", "all"):
            row[f"{split}_win_rate_delta_pp"] = 100 * (
                row[f"{split}_win_rate"] - baseline_row[f"{split}_win_rate"])
        rows.append(row)

    table = pd.DataFrame([baseline_row, *rows])
    sub = table.loc[table.identity.eq("FIXED_T0_FLOOR_T5_FILL")].copy()
    sub["pre_july_worst_win_rate"] = sub[
        ["feb_apr_development_win_rate", "may_jun_validation_win_rate"]].min(axis=1)
    sub["pre_july_mean_win_rate"] = sub[
        ["feb_apr_development_win_rate", "may_jun_validation_win_rate"]].mean(axis=1)
    selected = sub.sort_values(
        ["pre_july_worst_win_rate", "pre_july_mean_win_rate", "t0_floor"],
        ascending=[False, False, True]).iloc[0]
    floor = float(selected.t0_floor)
    candidate, candidate_stage, candidate_threshold = policies[floor]

    label = frame.label.to_numpy(float)
    ledger = pd.DataFrame({
        "ts": frame.ts, "label": label, "opportunity": opportunity,
        "external_rank": frame.external_rank, "t5_reliability_rank": t5_rank,
        "t0_floor": floor, "active_t5_threshold": candidate_threshold,
        "candidate_prediction": candidate, "candidate_stage": candidate_stage,
        "candidate_score": np.where(
            opportunity & (candidate != 0),
            candidate * np.nan_to_num(label, nan=0.0), 0).astype(np.int8),
        "control_prediction": baseline, "control_stage": baseline_stage,
        "control_active_threshold": baseline_threshold,
        "control_score": np.where(
            opportunity & (baseline != 0),
            baseline * np.nan_to_num(label, nan=0.0), 0).astype(np.int8),
    })
    parity = _assert_parity_parquet(ledger, "fixed_floor_shadow_ledger")
    out = ROOT / "fixed_floor_out"
    out.mkdir(parents=True, exist_ok=True)
    ledger.to_csv(out / "fixed_floor_shadow_ledger.csv", index=False)
    table.to_csv(out / "fixed_floor_policy_table.csv", index=False)
    return _result(FROZEN_END, len(ledger), _publish_dir(out, "fixed_floor"),
                   [control_record, floor_record],
                   selected_t0_floor=floor, parity=parity)


# --------------------------------------------------------------------------- #
# 4. c30
# --------------------------------------------------------------------------- #
def run_c30(end: pd.Timestamp, previous: dict | None) -> StageResult:
    module, record = _patched("c30_c70_lab_manager_r2", end)
    out = ROOT / "c30_repro_out"
    out.mkdir(parents=True, exist_ok=True)
    module.OUT = out
    module.main()
    ledger = pd.read_csv(out / "selected_shadow_ledger.csv", parse_dates=["ts"])
    parity = _assert_parity_parquet(
        ledger, "selected_shadow_ledger__c30_c70_lab_manager_r2_output")
    return _result(FROZEN_END, len(ledger), _publish_dir(out, "c30"), [record], parity=parity)


# --------------------------------------------------------------------------- #
# 5. phase3
# --------------------------------------------------------------------------- #
def run_phase3(end: pd.Timestamp, previous: dict | None) -> StageResult:
    module, record = _verbatim("c30_c70_lab_manager_r2_phase3")
    out = ROOT / "phase3_repro_out"
    out.mkdir(parents=True, exist_ok=True)
    source = ROOT / "c30_repro_out" / "selected_shadow_ledger.csv"
    if not source.exists():
        raise RuntimeError("phase3 requires the c30 stage's selected_shadow_ledger.csv")
    (out / "selected_shadow_ledger.csv").write_bytes(source.read_bytes())
    module.OUT = out
    module.main()
    reference = ROOT / "external_research" / "c30_c70_lab_manager_r2_output"
    checked, total, rows = [], 0, 0
    for path in sorted(out.glob("phase3_*.csv")):
        ref_path = reference / path.name
        if not ref_path.exists():
            raise RuntimeError(f"phase3: no archived reference for {path.name}")
        new = pd.read_csv(path)
        total += _cell_mismatches(pd.read_csv(ref_path), new, f"phase3/{path.name}")
        checked.append(path.name)
        rows += len(new)
    if total:
        raise RuntimeError(f"phase3: {total} cell mismatches across {checked}; aborting")
    return _result(FROZEN_END, rows, _publish_dir(out, "phase3"), [record],
                   parity={"files_checked": checked, "cell_mismatches": 0})


# --------------------------------------------------------------------------- #
# 6. c36_timing then c36_frontier
# --------------------------------------------------------------------------- #
def run_c36_timing(end: pd.Timestamp, previous: dict | None) -> StageResult:
    module, record = _verbatim("c36_timing_robustness_r1")
    out = ROOT / "c36t_repro_out"
    out.mkdir(parents=True, exist_ok=True)
    module.OUT = out
    module.main()
    parity = _assert_dir_parity(LEGACY_C37 / "c36_timing_robustness_r1_output", out, "c36_timing")
    rows = sum(len(pd.read_csv(p)) for p in sorted(out.glob("*.csv")))
    return _result(FROZEN_END, rows, _publish_dir(out, "c36/timing"), [record], parity=parity)


def run_c36_frontier(end: pd.Timestamp, previous: dict | None) -> StageResult:
    module, record = _verbatim("c36_fee_frontier_r3")
    out = ROOT / "c36f_repro_out"
    out.mkdir(parents=True, exist_ok=True)
    module.OUT = out
    module.TIMING_OUT = ROOT / "c36t_repro_out"
    module.main()
    parity = _assert_dir_parity(LEGACY_C37 / "c36_fee_frontier_r3_output", out, "c36_frontier")
    rows = sum(len(pd.read_csv(p)) for p in sorted(out.glob("*.csv")))
    return _result(FROZEN_END, rows, _publish_dir(out, "c36/frontier"), [record], parity=parity)


# --------------------------------------------------------------------------- #
# 7. c37
# --------------------------------------------------------------------------- #
def run_c37(end: pd.Timestamp, previous: dict | None) -> StageResult:
    """`c37_balanced_maturation_r1.py` -> c37_shadow_ledger.csv, wired to the
    phase3 and timing ledgers this branch just reproduced."""
    module, record = _verbatim("c37_balanced_maturation_r1")
    out = ROOT / "c37_repro_out"
    out.mkdir(parents=True, exist_ok=True)
    module.OUT = out
    module.PHASE3_OUT = ROOT / "phase3_repro_out"
    module.TIMING_OUT = ROOT / "c36t_repro_out"
    module.main()
    reference = ROOT / "external_research" / "c37_balanced_maturation_r1_output" / "c37_shadow_ledger.csv"
    ledger = pd.read_csv(out / "c37_shadow_ledger.csv")
    parity = _assert_frame_parity(reference, ledger, "c37_shadow_ledger")
    return _result(FROZEN_END, len(ledger), _publish_dir(out, "c37"), [record], parity=parity)


C30_STAGES = [
    Stage(name="external_direction", depends_on=(), run=run_external_direction,
          incremental=False, frozen_end=True,
          description="evaluate_external_direction_r1 directional matrix + causal frontier"),
    Stage(name="fee_coverage", depends_on=(), run=run_fee_coverage, incremental=False, frozen_end=True,
          description="t0_t5_fee_coverage_frontier_r1 adaptive coverage frontier ledger"),
    Stage(name="fixed_floor", depends_on=("fee_coverage",), run=run_fixed_floor,
          incremental=False, frozen_end=True,
          description="t0_t5_fixed_floor_containment_r1 fixed-T0-floor containment ledger"),
    Stage(name="c30", depends_on=("fee_coverage", "fixed_floor", "external_direction"),
          run=run_c30, incremental=False, frozen_end=True,
          description="c30_c70_lab_manager_r2 selected shadow ledger"),
    Stage(name="phase3", depends_on=("c30",), run=run_phase3, incremental=False, frozen_end=True,
          description="c30_c70_lab_manager_r2_phase3 policy/fee/bootstrap tables"),
    Stage(name="c36_timing", depends_on=("phase3",), run=run_c36_timing, incremental=False, frozen_end=True,
          description="c36_timing_robustness_r1 timing selector + venue ablation"),
    Stage(name="c36_frontier", depends_on=("c36_timing",), run=run_c36_frontier,
          incremental=False, frozen_end=True,
          description="c36_fee_frontier_r3 maturation fee frontier"),
    Stage(name="c37", depends_on=("phase3", "c36_timing", "c36_frontier"), run=run_c37,
          incremental=False, frozen_end=True,
          description="c37_balanced_maturation_r1 balanced maturation shadow ledger"),
]
