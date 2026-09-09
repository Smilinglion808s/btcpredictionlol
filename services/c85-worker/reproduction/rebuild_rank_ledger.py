"""Reconstruct the COMPLETE positional score ledger of the LongContext bootstrap
and the `external_rank` queue that the serving path restores from it.

Why this exists
---------------
`fit_long_context_bootstrap.py` appended a row only when the head returned a
probability. The original `rolling_rank` window is POSITIONAL: it spans the
previous 2,880 *rows* of the series and only then drops the non-finite ones, so
a target the head could not score still occupies a slot. A ledger that silently
omits those rows shifts every later rank.

This script therefore rebuilds the full grid `[bootstrap_start, position)` from
the target timestamps (a strict 15-minute grid, cross-checked against the
restored head's own buffer stamps) and marks every unscored slot explicitly as
`MODEL_NO_PROBABILITY` with a NaN value. It never invents a score.

It then replays the whole positional history through the sanctioned incremental
producer (`LongContextLeafProducer` / `RollingRankState`) and validates the
result against the batch `rolling_rank` transcription over the identical vector
(NaNs included). Length alone proves nothing: the two must agree row for row.

Outputs (under `--out`):

  score_ledger.csv    position, ts, status, probability, direction, rank
  rank_state.json     serialised producer state at the last ledger position
  rank_manifest.json  identity, counts, window occupancy and verification

    python -m reproduction.rebuild_rank_ledger --state /tmp/lc/x --out /tmp/lc/rank
"""
from __future__ import annotations

import os

for _var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
             "NUMEXPR_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
    os.environ.setdefault(_var, "1")

import argparse
import csv
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.experts import long_context as lc  # noqa: E402
from src.experts.direction_contract import (  # noqa: E402
    MODEL_NO_PROBABILITY,
    MODEL_SCORED,
    RANK_LOOKBACK,
    RANK_MINIMUM,
    LongContextLeafProducer,
    rolling_rank,
)

INTERVAL = pd.Timedelta(minutes=15)


class LedgerError(RuntimeError):
    """The recorded scores cannot be reconciled with the restored head."""


def read_scores(path: Path) -> dict[int, tuple[pd.Timestamp, float]]:
    """Parse the append-only score file, refusing duplicate or unordered keys."""

    scores: dict[int, tuple[pd.Timestamp, float]] = {}
    previous: int | None = None
    with path.open() as handle:
        for row in csv.DictReader(handle):
            position = int(row["position"])
            if position in scores:
                raise LedgerError(
                    f"duplicate position {position} in {path.name}: the append-only "
                    "ledger ran ahead of the committed cursor on a restart"
                )
            if previous is not None and position <= previous:
                raise LedgerError(
                    f"position {position} follows {previous}: the ledger is not "
                    "chronological and cannot seed a positional window"
                )
            value = float(row["probability"])
            if not np.isfinite(value):
                raise LedgerError(f"position {position} carries a non-finite score")
            scores[position] = (pd.Timestamp(row["ts"]), value)
            previous = position
    return scores


def build_grid(head: lc.LongContextHead, scores: dict[int, tuple[pd.Timestamp, float]],
               start: int) -> list[dict[str, object]]:
    """Every target position in `[start, head.position)`, scored or not.

    Timestamps come from the restored head's own buffer wherever it still holds
    the row, so the grid is anchored to the fitted object rather than to the
    CSV. Positions the buffer has already evicted are extrapolated on the strict
    15-minute grid and cross-checked against any recorded stamp.
    """

    buffered = {row.pos: pd.Timestamp(row.ts) for row in head.buffer}
    anchor_pos, anchor_ts = min(buffered.items()) if buffered else (start, None)
    grid: list[dict[str, object]] = []
    for position in range(start, head.position):
        if position in buffered:
            ts = buffered[position]
        elif anchor_ts is not None:
            ts = anchor_ts + INTERVAL * (position - anchor_pos)
        else:  # pragma: no cover - a head with an empty buffer cannot serve
            raise LedgerError("restored head has no buffered rows to anchor the grid")
        recorded = scores.get(position)
        if recorded is not None and recorded[0] != ts:
            raise LedgerError(
                f"position {position} is stamped {recorded[0].isoformat()} in the "
                f"score file but {ts.isoformat()} in the fitted head: the ledger "
                "does not belong to this generation"
            )
        grid.append(
            {
                "position": position,
                "ts": ts,
                "status": MODEL_SCORED if recorded else MODEL_NO_PROBABILITY,
                "probability": recorded[1] if recorded else float("nan"),
            }
        )
    unknown = sorted(k for k in scores if k < start or k >= head.position)
    if unknown:
        raise LedgerError(
            f"score file carries {len(unknown)} positions outside "
            f"[{start}, {head.position}); first {unknown[0]}"
        )
    return grid


def replay(grid: list[dict[str, object]]) -> tuple[LongContextLeafProducer, list[dict[str, object]]]:
    producer = LongContextLeafProducer()
    rows: list[dict[str, object]] = []
    for entry in grid:
        status = str(entry["status"])
        value = float(entry["probability"])
        output = producer.observe(
            int(entry["position"]),
            None if status == MODEL_NO_PROBABILITY else value,
            status=status,
        )
        rows.append({**entry, "direction": output["external_direction"],
                     "rank": output["external_rank"]})
    return producer, rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", default="/tmp/lc/x",
                        help="extracted bootstrap state directory (holds CURRENT)")
    parser.add_argument("--scores", default=None,
                        help="score file; defaults to <state>/probabilities.csv")
    parser.add_argument("--out", default="/tmp/lc/rank")
    args = parser.parse_args()

    state_dir = Path(args.state)
    scores_path = Path(args.scores) if args.scores else state_dir / "probabilities.csv"
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    head = lc.LongContextHead.restore_state(state_dir)
    generation = (state_dir / "CURRENT").read_text().strip()
    summary = json.loads((state_dir / "summary.json").read_text())
    start = int(summary["bootstrap_start_position"])
    if int(summary["position"]) != head.position:
        raise LedgerError(
            f"summary position {summary['position']} != restored head position "
            f"{head.position}: the score file and the fitted object disagree"
        )

    scores = read_scores(scores_path)
    grid = build_grid(head, scores, start)
    producer, rows = replay(grid)

    values = np.array([abs(r["probability"] - 0.5) if np.isfinite(r["probability"])
                       else np.nan for r in rows], dtype=float)
    reference = rolling_rank(values)
    incremental = np.array([r["rank"] if r["rank"] is not None else np.nan
                            for r in rows], dtype=float)
    both_nan = np.isnan(reference) & np.isnan(incremental)
    diff = np.where(both_nan, 0.0, np.abs(reference - incremental))
    mismatches = int(np.sum(~(both_nan | (diff <= 1e-15))))
    max_diff = float(np.nanmax(diff)) if len(diff) else 0.0

    with (out / "score_ledger.csv").open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["position", "ts", "status", "probability", "direction", "rank"])
        for row in rows:
            writer.writerow([
                row["position"], pd.Timestamp(row["ts"]).isoformat(), row["status"],
                "" if not np.isfinite(row["probability"]) else repr(row["probability"]),
                row["direction"],
                "" if row["rank"] is None or not np.isfinite(row["rank"]) else repr(row["rank"]),
            ])
    (out / "rank_state.json").write_text(json.dumps(producer.to_dict()))

    # Occupancy of the window the FIRST live target will see.
    next_position = head.position
    tail = [r for r in rows if r["position"] >= next_position - RANK_LOOKBACK]
    tail_finite = int(sum(1 for r in tail if np.isfinite(r["probability"])))
    unsettled = pd.Timestamp(head._last_ts)
    settled = max(head._labels_by_ts) if head._labels_by_ts else None

    manifest = {
        "identity": "c85-reconstruction-r1",
        "head_id": lc.HEAD_ID,
        "generation": generation,
        "fit_id": head.fit_id,
        "fit_count": head.fit_count,
        "position": head.position,
        "bootstrap_start_position": start,
        "grid_positions": len(rows),
        "scored_rows": int(np.isfinite([r["probability"] for r in rows]).sum()),
        "no_probability_rows": [int(r["position"]) for r in rows
                                if r["status"] == MODEL_NO_PROBABILITY],
        "first_ts": pd.Timestamp(rows[0]["ts"]).isoformat(),
        "last_ts": pd.Timestamp(rows[-1]["ts"]).isoformat(),
        "rank_lookback": RANK_LOOKBACK,
        "rank_minimum": RANK_MINIMUM,
        "rank_window_positions_at_next_target": len(tail),
        "rank_window_finite_at_next_target": tail_finite,
        "rank_window_fully_ledger_backed": len(tail) == RANK_LOOKBACK,
        "ranked_rows": int(np.isfinite(incremental).sum()),
        "batch_vs_incremental_mismatches": mismatches,
        "batch_vs_incremental_max_abs_diff": max_diff,
        "score_file_sha256": hashlib.sha256(scores_path.read_bytes()).hexdigest(),
        "score_ledger_sha256": hashlib.sha256((out / "score_ledger.csv").read_bytes()).hexdigest(),
        "rank_state_sha256": hashlib.sha256((out / "rank_state.json").read_bytes()).hexdigest(),
        "last_feature_ts": unsettled.isoformat(),
        "last_settled_label_ts": None if settled is None else pd.Timestamp(settled).isoformat(),
        "last_settled_label_available_at": (
            None if settled is None else head._label_available_at.get(settled)
        ),
        "unsettled_target_ts": (
            unsettled.isoformat() if settled is None or unsettled > settled else None
        ),
        "next_target_position": next_position,
        "stale": True,
    }
    (out / "rank_manifest.json").write_text(json.dumps(manifest, indent=1))
    print(json.dumps(manifest, indent=1))
    return 0 if mismatches == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
