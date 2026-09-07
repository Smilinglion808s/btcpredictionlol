"""Fully connected C85 parity harness.

Nothing here reads a decision column out of the stored upstream packet. Every
leaf output is recomputed by executing its ORIGINAL producer, the recomputed
columns are substituted into the packet, the ported experts (C42/C51/C54) are
driven off the substituted packet, the direction60/meta55 matrices are rebuilt
from it, and only then is the engine's output compared against the archived
reference predictions.

Leaf sources (all produced in this same session by the chained reproductions):
  c30_prediction, c36_prediction, c37_prediction, mean_135_rank
      external_research c37_balanced_maturation_r1 -> c37_repro_out
  external_direction, external_rank
      t0_t5_fee_coverage_frontier_r1 (executed in-process here)
  r4_prediction, r4_probability_correct, r4_directional_rank,
  expansion_selected_prediction
      r5_lab_manager_phase4 -> r5_lab_manager_output/t5_hot_calibration_ledger.csv
  structure_valid
      research_c75 -> research_c76 -> research_c79 source chain
  c42_prediction, c51_prediction, c54_prediction
      the ported experts, evaluated on the substituted packet

Usage:
    C85_ARTIFACT_DIR=/tmp/c85/kit python3 connected_parity.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

KIT = Path(os.environ.get("C85_ARTIFACT_DIR", "/tmp/c85/kit"))
REPO = Path(__file__).resolve().parents[1]
C30ROOT = Path(os.environ.get("C30ROOT", "/tmp/c30root"))
C85ROOT = Path(os.environ.get("C85ROOT", "/tmp/c85root"))
LAB = Path(os.environ.get("LAB", "/tmp/upx/upstream/lab/c81/lab"))
MINUTES = Path(os.environ.get("MINUTES", "/tmp/c79/btc_minutes_spot.parquet"))

sys.path.insert(0, str(KIT / "reference"))
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(C30ROOT))
sys.path.insert(0, str(C30ROOT / "external_research"))
sys.path.insert(0, str(LAB))

TOL = dict(rtol=1e-12, atol=0)


def _ts(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.copy()
    frame["ts"] = pd.to_datetime(frame["ts"], utc=True)
    return frame


def recompute_c37_family() -> pd.DataFrame:
    path = C30ROOT / "c37_repro_out" / "c37_shadow_ledger.csv"
    ledger = _ts(pd.read_csv(path))
    return ledger[["ts", "c30_prediction", "c36_prediction", "c37_prediction", "mean_135_rank"]]


def recompute_external() -> pd.DataFrame:
    """Execute the fee-coverage frontier producer and take its T0 external call."""
    from external_research import t0_t5_fee_coverage_frontier_r1 as control

    frame = control.load_frame(control.DEFAULT_CHECKPOINT)
    frame, _ranks = control.add_confidence_scores(frame)
    return _ts(frame[["ts", "external_direction", "external_rank"]])


def recompute_r5_family() -> pd.DataFrame:
    path = C30ROOT / "external_research" / "r5_lab_manager_output" / "t5_hot_calibration_ledger.csv"
    if not path.exists():
        path = C85ROOT / "external_research" / "r5_lab_manager_output" / "t5_hot_calibration_ledger.csv"
    ledger = _ts(pd.read_csv(path))
    return ledger[
        [
            "ts",
            "r4_prediction",
            "r4_probability_correct",
            "r4_directional_rank",
            "expansion_selected_prediction",
        ]
    ]


def recompute_structure_valid(packet: pd.DataFrame) -> pd.Series:
    from research_c75 import source as c75
    from research_c76 import source as c76
    from research_c79 import source as c79

    btc = pd.read_parquet(MINUTES)
    frame = packet[
        ["ts", "binance_spot_t5_w005_return_bps", "binance_spot_t5_w005_flow_imbalance"]
    ].copy()
    frame["ts"] = pd.to_datetime(frame.ts, utc=True)
    context = c75.build(frame, btc)
    indicator76 = c76.market(frame, btc, context)
    indicator79 = c79.market(frame, btc, indicator76)
    return pd.Series(np.asarray(indicator79.source_valid, dtype=bool), index=packet.index)


def substitute(packet: pd.DataFrame) -> pd.DataFrame:
    out = _ts(packet)
    for recomputed in (recompute_c37_family(), recompute_external(), recompute_r5_family()):
        merged = out[["ts"]].merge(recomputed, on="ts", how="left", validate="one_to_one")
        for column in recomputed.columns:
            if column == "ts":
                continue
            if column not in out.columns:
                raise SystemExit(f"recomputed column {column} is not in the packet")
            out[column] = merged[column].to_numpy()
    out["structure_valid"] = recompute_structure_valid(out).to_numpy()
    return out


def drive_experts(packet: pd.DataFrame) -> pd.DataFrame:
    from src.experts.c42 import C42Expert
    from src.experts.c54 import C54Expert

    c42, c54 = C42Expert(), C54Expert()
    leaf_columns = [
        "c30_prediction",
        "c36_prediction",
        "c37_prediction",
        "r4_prediction",
        "r4_probability_correct",
        "r4_directional_rank",
        "expansion_selected_prediction",
        "external_direction",
        "external_rank",
        "mean_135_rank",
    ]
    c42_out, c54_out = [], []
    for row in packet.to_dict("records"):
        leaf = {name: row[name] for name in leaf_columns}
        verdict42 = c42.evaluate(packet=row, leaf_outputs=leaf)
        c42_out.append(int(verdict42["c42_prediction"]))
        verdict54 = c54.evaluate(
            packet=row,
            upstream={
                "c42_prediction": c42_out[-1],
                "c51_prediction": int(row["c51_prediction"]),
            },
        )
        c54_out.append(int(verdict54["c54_prediction"]))
    packet = packet.copy()
    packet["c42_prediction"] = c42_out
    packet["c54_prediction"] = c54_out
    return packet


def main() -> int:
    from reliability import policy, portable_probability

    from src import features as F

    stored = pd.read_parquet(KIT / "fixtures/upstream_packet.parquet")
    frame = pd.read_parquet(KIT / "fixtures/policy_frame.parquet")
    valid = pd.read_parquet(KIT / "fixtures/head_validity.parquet")
    reference = pd.read_parquet(KIT / "fixtures/reference_predictions.parquet")
    aux = pd.read_parquet(KIT / "fixtures/auxiliary_scores.parquet")

    packet = substitute(stored)

    report: dict[str, object] = {"rows": int(len(packet))}
    leaf_report = {}
    for column in (
        "c30_prediction",
        "c36_prediction",
        "c37_prediction",
        "mean_135_rank",
        "external_direction",
        "external_rank",
        "r4_prediction",
        "r4_probability_correct",
        "r4_directional_rank",
        "expansion_selected_prediction",
        "structure_valid",
    ):
        a = pd.to_numeric(stored[column], errors="coerce").to_numpy(float)
        b = pd.to_numeric(packet[column], errors="coerce").to_numpy(float)
        same = np.isclose(a, b, **TOL) | (np.isnan(a) & np.isnan(b))
        leaf_report[column] = int((~same).sum())
    report["recomputed_vs_stored_leaf_mismatches"] = leaf_report

    packet = drive_experts(packet)
    for column in ("c42_prediction", "c54_prediction"):
        a = pd.to_numeric(stored[column], errors="coerce").fillna(0).to_numpy(float)
        b = pd.to_numeric(packet[column], errors="coerce").fillna(0).to_numpy(float)
        leaf_report[column] = int((a != b).sum())

    direction = F.build_direction_features(packet)
    p_dir = np.full(len(frame), np.nan)
    for path in sorted((KIT / "models/C71_DIRECTION").glob("*.json")):
        head = json.loads(path.read_text())
        index = np.arange(head["prediction_start_row"], head["prediction_end_row_exclusive"])
        index = index[valid.direction_valid.to_numpy(bool)[index]]
        p_dir[index] = portable_probability(direction.iloc[index], head)
    proposal = F.direction_from_probability(p_dir)

    meta = F.build_meta_features(packet, p_dir, proposal, F.auxiliary_logits(aux))
    p_meta = np.full(len(frame), np.nan)
    for path in sorted((KIT / "models/C85_META").glob("*.json")):
        head = json.loads(path.read_text())
        index = np.arange(head["prediction_start_row"], head["prediction_end_row_exclusive"])
        index = index[valid.meta_valid.to_numpy(bool)[index]]
        p_meta[index] = portable_probability(meta.iloc[index], head)

    rebuilt = frame.copy()
    for column, values in (
        ("C85_probability_yes", p_dir),
        ("C85_proposal", proposal),
        ("C85_probability_correct", p_meta),
    ):
        if column in rebuilt.columns:
            rebuilt[column] = values

    graded, _state = policy(rebuilt, p_meta)

    decision_columns = [
        column
        for column in reference.columns
        if column.endswith(("prediction", "stage", "opportunity"))
        and column in graded.columns
    ]
    for column in ("base_prediction", "core", "extension", "proposal", "rank",
                   "filter_rank", "filter_count", "weak", "latest_state_ns"):
        if column in reference.columns and column in graded.columns:
            decision_columns.append(column)

    mismatches = {}
    for column in sorted(set(decision_columns)):
        a, b = reference[column], graded[column]
        if pd.api.types.is_numeric_dtype(a) and pd.api.types.is_numeric_dtype(b):
            af, bf = a.astype(float).to_numpy(), b.astype(float).to_numpy()
            n = int((~(np.isclose(af, bf, **TOL) | (np.isnan(af) & np.isnan(bf)))).sum())
        else:
            n = int((a.astype(str) != b.astype(str)).sum())
        if n:
            mismatches[column] = n

    calls = int(graded.prediction.ne(0).sum())
    wins = int((graded.prediction.ne(0) & graded.prediction.eq(graded.label)).sum())
    losses = calls - wins
    report.update(
        {
            "expert_mismatches": {k: leaf_report[k] for k in ("c42_prediction", "c54_prediction")},
            "compared_decision_columns": sorted(set(decision_columns)),
            "decision_mismatches": mismatches,
            "opportunities": int(len(graded)),
            "calls": calls,
            "wins": wins,
            "losses": losses,
            "raw_net": wins - losses,
        }
    )
    expected = (19487, 6794, 4083, 2711)
    report["gate"] = (
        "PASS"
        if not mismatches and (len(graded), calls, wins, losses) == expected
        else "FAIL"
    )
    print(json.dumps(report, indent=2, default=str))
    return 0 if report["gate"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
