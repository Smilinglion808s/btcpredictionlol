"""Execute the incremental coverage-control producer and prove it equals the
recovered batch implementation row for row.

Reference: `t0_t5_fee_coverage_frontier_r1.py` (recovered, unmodified) —
`load_frame` -> `add_confidence_scores` -> `directional_past_rank` ->
`make_adaptive_policy` / `make_policy`.

Under test: `src.experts.coverage_control.CoverageControlProducer`, which
consumes one chronological target at a time.

Checks:
  1. Every confidence column, all six rank series, and the cov30/cov70 adaptive
     prediction/stage/active_threshold match the batch arrays exactly (NaN slots
     included, positionally).
  2. A mid-stream save/restore produces byte-identical remaining output, so a
     worker restart resumes on the next target with the same rank windows and
     controller thresholds.

Usage:
  python3 reproduction/run_coverage_control_stream.py [--limit N]
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

WORKER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER))

from src.experts.coverage_control import (  # noqa: E402
    RAW_SCORES,
    CoverageControlProducer,
)

CACHE = Path("/mnt/documents/.lovable/c85-cache/upx")
PACKAGE = (
    CACHE
    / "upstream/vault_work/legacy_lab2/sources"
    / "T0_T5_FEE_COVERAGE_FRONTIER_R1_PACKAGE.zip__expanded"
)
COVERAGES = (0.30, 0.70)


def load_control():
    """Import the recovered producer with its ROOT bound to the package."""
    import importlib.util

    source = PACKAGE / "external_research" / "t0_t5_fee_coverage_frontier_r1.py"
    spec = importlib.util.spec_from_file_location("control_r1", source)
    module = importlib.util.module_from_spec(spec)
    sys.modules["control_r1"] = module
    spec.loader.exec_module(module)
    module.ROOT = PACKAGE
    return module


def rows_from(frame: pd.DataFrame, live: np.ndarray) -> list[dict]:
    fields = [
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
    ]
    records = frame[fields].to_dict("records")
    for index, record in enumerate(records):
        record["ts"] = pd.Timestamp(record["ts"]).isoformat()
        record["in_live_window"] = bool(live[index])
    return records


def stream(records: list[dict], producer: CoverageControlProducer) -> list[dict]:
    return [producer.observe(record) for record in records]


def equal(left, right) -> bool:
    if isinstance(left, float) and isinstance(right, float):
        if math.isnan(left) and math.isnan(right):
            return True
        return left == right
    return left == right


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0)
    arguments = parser.parse_args()

    control = load_control()
    checkpoint = PACKAGE / "restored_checkpoint" / "continuous_r1"
    frame = control.load_frame(checkpoint)
    if arguments.limit:
        frame = frame.head(arguments.limit).reset_index(drop=True)
    live = (
        (frame.ts >= control.LIVE_READY) & (frame.ts < control.END)
    ).to_numpy()
    print(f"frame rows={len(frame)} span={frame.ts.min()} .. {frame.ts.max()}")

    scored, ranks = control.add_confidence_scores(frame)
    opportunity = (
        live
        & frame.t5_input_complete.fillna(False).to_numpy(bool)
        & (frame.candidate_prediction.to_numpy(np.int8) != 0)
        & np.isfinite(frame.label.to_numpy(float))
        & (frame.label.to_numpy(float) != 0)
    )
    reference_policies = {}
    for coverage in COVERAGES:
        prediction, stage, threshold = control.make_adaptive_policy(
            scored, ranks["R2_R4_BLEND"], coverage, opportunity
        )
        reference_policies[f"cov{int(round(coverage * 100))}"] = (
            prediction,
            stage,
            threshold,
        )
    print(f"batch reference built; opportunities={int(opportunity.sum())}")

    records = rows_from(frame, live)
    producer = CoverageControlProducer(coverages=COVERAGES)
    results = stream(records, producer)

    mismatches: list[str] = []
    columns = {
        "r2_adjusted_probability_correct": scored.r2_adjusted_probability_correct,
        "r4_adjusted_probability_correct": scored.r4_adjusted_probability_correct,
        "reliability_blend_probability_correct": (
            scored.reliability_blend_probability_correct
        ),
        "active_direction_margin": scored.active_direction_margin,
        "t5_reliability_rank": scored.t5_reliability_rank,
    }
    for name, series in columns.items():
        expected = series.to_numpy(float)
        actual = np.array([r[name] for r in results], dtype=float)
        bad = int(
            np.sum(
                ~(
                    (np.isnan(expected) & np.isnan(actual))
                    | (expected == actual)
                )
            )
        )
        print(f"  {name}: mismatches={bad}")
        if bad:
            mismatches.append(name)

    for name in RAW_SCORES:
        expected = np.asarray(ranks[name], dtype=float)
        actual = np.array([r["ranks"][name] for r in results], dtype=float)
        bad = int(
            np.sum(
                ~(
                    (np.isnan(expected) & np.isnan(actual))
                    | (expected == actual)
                )
            )
        )
        print(f"  rank[{name}]: mismatches={bad}")
        if bad:
            mismatches.append(f"rank[{name}]")

    expected_opportunity = opportunity
    actual_opportunity = np.array([r["opportunity"] for r in results])
    bad = int(np.sum(expected_opportunity != actual_opportunity))
    print(f"  opportunity: mismatches={bad}")
    if bad:
        mismatches.append("opportunity")

    for tag, (prediction, stage, threshold) in reference_policies.items():
        actual_prediction = np.array(
            [r["policies"][tag]["prediction"] for r in results], dtype=np.int8
        )
        actual_stage = np.array(
            [
                r["policies"][tag]["stage"] if r["opportunity"] else "ABSTAIN"
                for r in results
            ],
            dtype=object,
        )
        actual_threshold = np.array(
            [r["policies"][tag]["active_threshold"] for r in results], dtype=float
        )
        expected_stage = np.where(opportunity, stage, "ABSTAIN")
        expected_threshold = np.where(opportunity, threshold, np.nan)
        for label, bad in (
            (f"{tag}.prediction", int(np.sum(actual_prediction != prediction))),
            (f"{tag}.stage", int(np.sum(actual_stage != expected_stage))),
            (
                f"{tag}.active_threshold",
                int(
                    np.sum(
                        ~(
                            (
                                np.isnan(expected_threshold)
                                & np.isnan(actual_threshold)
                            )
                            | (expected_threshold == actual_threshold)
                        )
                    )
                ),
            ),
        ):
            print(f"  {label}: mismatches={bad}")
            if bad:
                mismatches.append(label)

    # ---- restart equality -------------------------------------------------
    split = len(records) // 2
    warm = CoverageControlProducer(coverages=COVERAGES)
    first = stream(records[:split], warm)
    with tempfile.TemporaryDirectory() as directory:
        state = Path(directory) / "coverage_state.json"
        warm.save(state)
        resumed = CoverageControlProducer.restore(state)
    second = stream(records[split:], resumed)
    restart = first + second
    restart_bad = sum(
        1
        for a, b in zip(results, restart)
        if json.dumps(a, sort_keys=True, default=str)
        != json.dumps(b, sort_keys=True, default=str)
    )
    print(f"  restart-at-{split}: differing targets={restart_bad}")
    if restart_bad:
        mismatches.append("restart")

    print(
        f"cursor={producer.cursor} processed={producer.processed} "
        f"mismatched_series={len(mismatches)}"
    )
    if mismatches:
        print("MISMATCHES: " + ", ".join(mismatches))
        return 1
    print("PARITY OK: incremental producer == recovered batch implementation")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
