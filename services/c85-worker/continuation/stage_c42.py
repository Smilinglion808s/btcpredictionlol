"""Stage: C42_MATURATION_CONSENSUS_R1 continuation.

The producer is `source/01c50b819f8e/build_c42_maturation_consensus_r1.py`,
executed unmodified except for its research `END` constant (audited by
`endpatch.load_producer`). It composes four upstream ledgers:

    inputs/phase3_selected_shadow_ledger.csv   <- c30 chain  (stage_c30)
    inputs/fee_coverage_shadow_ledger.csv      <- c30 chain  (stage_c30)
    inputs/t5_hot_calibration_ledger.csv       <- r5 phase 4 (stage_r4)
    inputs/c37_shadow_ledger.csv               <- c37        (stage_c30)

No feature, fitting schedule, venue or rule is touched here: the stage only
stages the upstream ledgers into the producer's own `inputs/` directory, runs
it, and gates the result on historical-prefix parity against the archived
`c42_ledger.csv`.

A second, purely mechanical artifact is published alongside the ledger:
`c42_audit_ledger.csv`, the C42 ledger left-joined to the Polymarket market
inventory on interval start so the downstream Polymarket acquisition has the
`condition_id` column its CLI requires. The join adds identifiers only; it
never alters a prediction, stage or score.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import pandas as pd

from .config import CACHE, UPSTREAM
from .runner import StageResult
from .stages import SOURCES, publish, staged_producer, workspace_for, writable_numpy_views

C42_PRODUCER = SOURCES / "01c50b819f8e" / "build_c42_maturation_consensus_r1.py"

# Published cache path (relative to the continuation cache, as each producing
# stage publishes it) -> the filename the producer expects inside inputs/.
C42_INPUTS = {
    "phase3/phase3_selected_shadow_ledger.csv": "phase3_selected_shadow_ledger.csv",
    "fee_coverage/fee_coverage_shadow_ledger.csv": "fee_coverage_shadow_ledger.csv",
    "t5_hot_calibration_ledger.csv": "t5_hot_calibration_ledger.csv",
    "c37/c37_shadow_ledger.csv": "c37_shadow_ledger.csv",
}

ARCHIVED_C42 = UPSTREAM / "ancestor" / "data" / "c42_ledger.csv"
PARITY_END = pd.Timestamp("2026-09-01T00:00:00Z")

DECISION_COLUMNS = (
    "composite_prediction",
    "composite_stage",
    "consensus_admitted",
    "consensus_agreement",
    "decision_source",
    "expansion_selected_prediction",
)


class UpstreamLedgerMissing(RuntimeError):
    """A required upstream ledger has not been produced yet."""


class PrefixParityError(RuntimeError):
    """The rebuilt prefix does not match the archived ledger."""


def _stage_inputs(inputs: Path) -> dict[str, str]:
    inputs.mkdir(parents=True, exist_ok=True)
    staged: dict[str, str] = {}
    missing: list[str] = []
    for cached_name, expected_name in C42_INPUTS.items():
        source = CACHE / cached_name
        if not source.exists():
            missing.append(cached_name)
            continue
        shutil.copy2(source, inputs / expected_name)
        staged[expected_name] = str(source)
    if missing:
        raise UpstreamLedgerMissing(
            "c42 cannot run until these upstream ledgers are published to the "
            "continuation cache: " + ", ".join(sorted(missing))
        )
    return staged


def _assert_prefix_parity(frame: pd.DataFrame) -> dict:
    """Truncated to the frozen end, the rebuild must equal the archived ledger."""
    if not ARCHIVED_C42.exists():
        raise PrefixParityError(f"archived C42 ledger absent: {ARCHIVED_C42}")
    archived = pd.read_csv(ARCHIVED_C42, low_memory=False)
    archived["ts"] = pd.to_datetime(archived["ts"], utc=True)
    rebuilt = frame.copy()
    rebuilt["ts"] = pd.to_datetime(rebuilt["ts"], utc=True)
    rebuilt = rebuilt[rebuilt["ts"] < PARITY_END].reset_index(drop=True)
    archived = archived[archived["ts"] < PARITY_END].reset_index(drop=True)

    if len(rebuilt) != len(archived):
        raise PrefixParityError(
            f"prefix row count {len(rebuilt)} != archived {len(archived)}")
    if not (rebuilt["ts"].to_numpy() == archived["ts"].to_numpy()).all():
        raise PrefixParityError("prefix timestamps misaligned against the archive")

    mismatches: dict[str, int] = {}
    for column in archived.columns:
        if column not in rebuilt.columns:
            mismatches[column] = len(archived)
            continue
        a, b = archived[column], rebuilt[column]
        if pd.api.types.is_numeric_dtype(a) and pd.api.types.is_numeric_dtype(b):
            af, bf = a.astype(float).to_numpy(), b.astype(float).to_numpy()
            import numpy as np
            bad = ~((np.isclose(af, bf, rtol=0, atol=1e-12)) | (np.isnan(af) & np.isnan(bf)))
        else:
            bad = a.astype(str).to_numpy() != b.astype(str).to_numpy()
        count = int(bad.sum())
        if count:
            mismatches[column] = count
    decision = {k: v for k, v in mismatches.items() if k in DECISION_COLUMNS}
    if mismatches:
        raise PrefixParityError(
            f"C42 prefix parity failed: {mismatches} (decision columns: {decision})")
    return {"prefix_rows": len(archived), "prefix_cell_mismatches": 0,
            "prefix_decision_mismatches": 0}


def _publish_audit_ledger(ledger: Path) -> tuple[str, dict]:
    """Attach Polymarket condition ids by interval start; identifiers only."""
    # The polymarket_inventory stage publishes under this name (stage_c51.py:130).
    inventory = CACHE / "polymarket_inventory.csv"
    frame = pd.read_csv(ledger, low_memory=False)
    frame["ts"] = pd.to_datetime(frame["ts"], utc=True)
    notes: dict = {}
    if inventory.exists():
        markets = pd.read_csv(inventory, low_memory=False)
        key = "interval_start" if "interval_start" in markets.columns else "ts"
        markets[key] = pd.to_datetime(markets[key], utc=True, errors="coerce")
        markets = (markets.dropna(subset=[key, "condition_id"])
                          .drop_duplicates(subset=[key], keep="first")
                          .rename(columns={key: "ts"})[["ts", "condition_id"]])
        frame = frame.merge(markets, on="ts", how="left")
        directional = frame["composite_prediction"].isin([-1, 1])
        notes["directional_rows"] = int(directional.sum())
        notes["directional_rows_without_condition_id"] = int(
            (directional & frame["condition_id"].isna()).sum())
    else:
        frame["condition_id"] = pd.NA
        notes["polymarket_inventory"] = (
            "absent from the continuation cache; condition ids left null and the "
            "Polymarket stage stays blocked rather than guessing a market")
    out = ledger.parent / "c42_audit_ledger.csv"
    frame.to_csv(out, index=False)
    return publish(out, "c42_audit_ledger.csv"), notes


def run_c42(end: pd.Timestamp, previous: dict | None) -> StageResult:
    module, patch = staged_producer("c42", "c42", end)
    root = workspace_for("c42")
    inputs = root / "inputs"
    outputs = root / "outputs"
    staged = _stage_inputs(inputs)

    saved = sys.argv
    sys.argv = ["build_c42_maturation_consensus_r1.py", "--package-root", str(root)]
    try:
        with writable_numpy_views():
            module.main()
    finally:
        sys.argv = saved

    ledger = outputs / f"{module.IDENTITY}_ledger.csv"
    frame = pd.read_csv(ledger, low_memory=False)
    parity = _assert_prefix_parity(frame)

    published = [publish(ledger, "c42_ledger.csv")]
    for name in ("policy_performance.csv", "component_ablation.csv",
                 "candidate_monthly.csv", "candidate_7d_blocks.csv",
                 "paired_cluster_bootstrap.csv", "fee_stress.csv",
                 "data_integrity.json"):
        candidate = outputs / name
        if candidate.exists():
            published.append(publish(candidate, name))
    audit_path, audit_notes = _publish_audit_ledger(ledger)
    published.append(audit_path)

    timestamps = pd.to_datetime(frame["ts"], utc=True)
    return StageResult(
        cursor=end,
        rows=len(frame),
        outputs=published,
        patches=[patch.as_dict()],
        notes={
            "staged_inputs": staged,
            "ledger_end": str(timestamps.max()),
            "opportunities": int(frame["opportunity"].fillna(0).astype(bool).sum())
            if "opportunity" in frame.columns else None,
            "calls": int(frame["composite_prediction"].isin([-1, 1]).sum()),
            **parity,
            **audit_notes,
        },
    )
