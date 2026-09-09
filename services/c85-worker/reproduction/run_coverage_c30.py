"""Execute the consolidated coverage -> C30 path and prove the serving state.

  1. batch-run the recovered functions through the requested end boundary;
  2. write the continuous coverage / C30 ledger (reconstruction namespace);
  3. snapshot serving state at (end - REPLAY targets);
  4. reload that state in-place from disk and re-derive the final REPLAY
     targets one at a time through CoverageC30Server, requiring equality with
     the batch rows.

Usage: python run_coverage_c30.py [--end 2026-09-09T00:00:00Z] [--replay 96]
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import numpy as np
import pandas as pd

import c30_coverage_path as path

OUT = Path("/tmp/c85stage/c30_out")

# Columns whose value IS the decision: any difference at all is a failure.
DECISION_COLUMNS = {
    "base_direction",
    "t5_context_router_prediction",
    "external_direction",
    "graded_warm",
    "graded_hot",
    "continuous_graded_prediction",
    "continuous_graded_stage",
    "t5_input_complete",
}



def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--end", default="2026-09-09T00:00:00Z")
    parser.add_argument("--replay", type=int, default=96)
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    end = pd.Timestamp(args.end)
    frame, audit = path.run_batch(end)

    ledger = frame.loc[frame.ts >= path.bridge.LIVE_READY, path.LEDGER_COLUMNS]
    ledger.to_csv(OUT / "continuous_coverage_ledger.csv", index=False)

    september = ledger[ledger.ts >= pd.Timestamp("2026-09-01T00:00:00Z")]
    audit["september_rows"] = int(len(september))
    audit["september_first_ts"] = (
        september.ts.iloc[0].isoformat() if len(september) else None
    )
    audit["september_last_ts"] = (
        september.ts.iloc[-1].isoformat() if len(september) else None
    )
    audit["september_calls"] = int(
        (
            september.t5_input_complete
            & (september.continuous_graded_prediction != 0)
        ).sum()
    )
    audit["september_stage_counts"] = (
        september.continuous_graded_stage.value_counts().to_dict()
    )
    audit["september_unresolved_labels"] = int(september.label.isna().sum())

    # ---- serving state snapshot + restore replay --------------------------
    last = len(frame) - 1
    anchor = last - args.replay
    server = path.CoverageC30Server.from_batch(frame, anchor)
    state_dir = OUT / "state"
    shutil.rmtree(state_dir, ignore_errors=True)
    meta = server.save(state_dir)

    restored = path.CoverageC30Server.load(state_dir)
    decision_mismatches: list[dict[str, object]] = []
    numeric_differences: list[dict[str, object]] = []
    replayed: list[dict[str, object]] = []

    compare_columns = [
        "p_pf_linear",
        "p_pf_context_logit",
        "base_probability_green",
        "base_direction",
        "t5_context_router_prediction",
        "external_direction",
        "external_rank",
        "graded_warm",
        "graded_hot",
        "continuous_graded_prediction",
        "continuous_graded_stage",
        "t5_input_complete",
    ]
    for index in range(anchor + 1, len(frame)):
        expected = frame.iloc[index]
        raw = {column: expected[column] for column in path.RAW_COLUMNS}
        external = {
            "external_probability_green": expected.external_probability_green,
            "external_direction": expected.external_direction,
            "external_rank": expected.external_rank,
        }
        produced = restored.score(raw, external)
        replayed.append({"ts": produced["ts"].isoformat(), **{
            key: produced[key] for key in compare_columns
        }})
        for column in compare_columns:
            a, b = produced[column], expected[column]
            if column in DECISION_COLUMNS:
                if str(a) == str(b) or (
                    isinstance(a, (bool, np.bool_)) and bool(a) == bool(b)
                ):
                    continue
                decision_mismatches.append(
                    {
                        "ts": produced["ts"].isoformat(),
                        "column": column,
                        "serving": str(a),
                        "batch": str(b),
                    }
                )
                continue
            x, y = float(a), float(b)
            if np.isnan(x) and np.isnan(y):
                continue
            if np.isnan(x) != np.isnan(y):
                decision_mismatches.append(
                    {
                        "ts": produced["ts"].isoformat(),
                        "column": column,
                        "serving": str(a),
                        "batch": str(b),
                    }
                )
                continue
            difference = abs(x - y)
            if difference:
                numeric_differences.append(
                    {
                        "ts": produced["ts"].isoformat(),
                        "column": column,
                        "absolute": difference,
                        "ulps": difference / max(np.spacing(abs(y)), np.spacing(1.0)),
                    }
                )
        restored.settle(expected.ts, float(expected.label) if pd.notna(expected.label) else np.nan)

    audit["restore_replay"] = {
        "anchor_index": anchor,
        "anchor_ts": frame.ts.iloc[anchor].isoformat(),
        "targets": int(len(replayed)),
        "compared_columns": compare_columns,
        "decision_mismatches": len(decision_mismatches),
        "decision_mismatch_examples": decision_mismatches[:10],
        "numeric_differing_cells": len(numeric_differences),
        "numeric_max_absolute_difference": max(
            (item["absolute"] for item in numeric_differences), default=0.0
        ),
        "numeric_max_ulps": max(
            (item["ulps"] for item in numeric_differences), default=0.0
        ),
        "numeric_examples": numeric_differences[:10],
        "state": meta,
    }
    pd.DataFrame(replayed).to_csv(OUT / "serving_replay_rows.csv", index=False)
    (OUT / "COVERAGE_C30_RUN.json").write_text(json.dumps(audit, indent=2, default=str))
    print(json.dumps({k: v for k, v in audit.items() if k != "restore_replay"}, indent=2, default=str))
    replay = dict(audit["restore_replay"])
    replay.pop("state", None)
    print(json.dumps(replay, indent=2, default=str))



if __name__ == "__main__":
    main()
