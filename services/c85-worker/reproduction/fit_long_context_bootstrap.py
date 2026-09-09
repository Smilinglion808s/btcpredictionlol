"""Fit the C85 RECONSTRUCTION `T0_LONG_CONTEXT_R1` bootstrap head.

Runs the ORIGINAL schedule and rules (`src/experts/long_context.py`, itself a
verbatim transcription of `external_research/long_context_model.py`) over the
rebuilt frame `datasets/long_context/long_context_features.pkl`
(sha256 93b99a13…). Nothing here tunes, replays for archive parity, or invents
a continuation policy.

Why it does not start at position 0
-----------------------------------
The frame is 23,328 targets; a fit costs ~54 s, so the 183 original grid
boundaries would be ~2.7 h of refits whose models are all superseded by the
last one. The bootstrap needs exactly two things:

  * the fitted model of the LATEST eligible boundary, and
  * a causal, strictly out-of-sample probability history long enough for
    `external_rank` (lookback 2,880, minimum 960).

So the trailing window `[B0-WINDOW, B0)` is HYDRATED into the head's buffer as
rows with their real positions and settled labels — the identical buffer the
sequential run would hold, and the identical state `restore_state` rebuilds —
and the head then runs the real grid from `B0` to the end of the frame: one
`train_ahead` per 96-target boundary, probabilities out-of-sample only. No
probability is emitted for a hydrated row, so no rank history is in-sample.

Resumable: state is exported (atomic generation + manifest) every
`CHECKPOINT_EVERY` boundaries and at the end; `progress.json` carries the
cursor. Re-running resumes from `CURRENT` and never refits a completed
boundary.
"""
from __future__ import annotations

import os

for _var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
             "NUMEXPR_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
    os.environ.setdefault(_var, "1")

import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.experts import long_context as lc  # noqa: E402

FRAME = Path(os.environ.get("C85_LC_FRAME", "/tmp/lc/long_context_features.pkl"))
OUT = Path(os.environ.get("C85_LC_OUT", "/tmp/lc/bootstrap"))
STATE = OUT / "state"
#: Causal probability history to produce (>= external_rank's 2,880 lookback).
RANK_HISTORY = int(os.environ.get("C85_LC_RANK_HISTORY", "2880"))
CHECKPOINT_EVERY = 4
LABEL_SOURCE = "binance_spot_1m"


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def load_frame() -> tuple[pd.DataFrame, list[str]]:
    frame = lc.prepare_external_frame(pd.read_pickle(FRAME))
    return frame, lc.feature_columns(list(frame.columns))


def hydrate(frame: pd.DataFrame, features: list[str], b0: int) -> lc.LongContextHead:
    """Seed the trailing window `[b0-WINDOW, b0)` with real rows and labels."""

    head = lc.LongContextHead(features=features)
    first = max(0, b0 - lc.WINDOW)
    values = frame[features].to_numpy(float)
    labels = frame.label.to_numpy(float)
    stamps = frame.ts.to_numpy()
    for pos in range(first, b0):
        ts = pd.Timestamp(stamps[pos])
        row = values[pos]
        label = float(labels[pos])
        head.buffer.append(
            lc._Row(ts, np.asarray(row, dtype=float), bool(np.isfinite(row).all()), label, pos)
        )
        available = (ts + lc.LABEL_CANDLE).isoformat()
        if np.isfinite(label):
            head._labels_by_ts[ts] = label
            head._label_available_at[ts] = f"{available}|{LABEL_SOURCE}"
        else:
            # The recovered generator writes NaN only for a non-contiguous
            # source over the settling candle; that is the evidence recorded.
            head._missing_labels[ts] = (
                f"{available}|{LABEL_SOURCE}|rebuilt frame binance_label is NaN "
                "(source not contiguous over the settling candle)"
            )
    head.position = b0
    head._last_ts = pd.Timestamp(stamps[b0 - 1])
    head.version = 1
    return head


def settle(head: lc.LongContextHead, ts: pd.Timestamp, label: float,
           as_of: pd.Timestamp) -> None:
    available = ts + lc.LABEL_CANDLE
    if np.isfinite(label):
        head.settle_label(ts, label, available_at=available, as_of=as_of,
                          source=LABEL_SOURCE)
    else:
        head.settle_missing_label(
            ts, available_at=available, as_of=as_of, source=LABEL_SOURCE,
            reason="rebuilt frame binance_label is NaN (source not contiguous "
                   "over the settling candle)",
        )


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    frame, features = load_frame()
    n = len(frame)
    last_boundary = (n - 1) // lc.REFIT_EVERY * lc.REFIT_EVERY
    b0 = last_boundary - (RANK_HISTORY // lc.REFIT_EVERY) * lc.REFIT_EVERY
    if b0 < lc.MINIMUM:
        b0 = lc.MINIMUM
    log(f"frame rows={n} features={len(features)} "
        f"{frame.ts.iloc[0].isoformat()} .. {frame.ts.iloc[-1].isoformat()}")
    log(f"grid: MINIMUM={lc.MINIMUM} REFIT_EVERY={lc.REFIT_EVERY} WINDOW={lc.WINDOW} "
        f"b0={b0} last_boundary={last_boundary}")

    probabilities_path = OUT / "probabilities.csv"
    if (STATE / "CURRENT").exists():
        head = lc.LongContextHead.restore_state(STATE)
        log(f"resumed at position {head.position} (fits={head.fit_count})")
    else:
        head = hydrate(frame, features, b0)
        probabilities_path.write_text("position,ts,probability\n")
        log(f"hydrated {len(head.buffer)} rows into the trailing window")

    records = frame[["ts", "label", *features]].to_dict("records")
    start = head.position
    boundaries_done = 0
    started = time.time()
    for pos in range(start, n):
        record = records[pos]
        if pos >= 1:
            # The label of target T is the candle that BEGINS at T, so it is
            # settled here, one target later. A hydrated row is already settled
            # with the identical stamp, which the head treats as a no-op.
            previous = records[pos - 1]
            settle(head, previous["ts"], float(previous["label"]),
                   as_of=pd.Timestamp(record["ts"]))
        due = pos >= lc.MINIMUM and pos % lc.REFIT_EVERY == 0
        if due:
            fit_started = time.time()
            staged = head.train_ahead(position=pos)
            log(f"boundary {pos} {record['ts']} fit={'yes' if staged else 'NO-FIT'} "
                f"rows={getattr(staged, 'training_rows', 0)} "
                f"{round(time.time() - fit_started, 1)}s")
        probability = head.observe(record["ts"], record, allow_inline_training=False)
        if probability is not None:
            with probabilities_path.open("a") as handle:
                handle.write(f"{pos},{pd.Timestamp(record['ts']).isoformat()},{probability!r}\n")
        if due:
            boundaries_done += 1
            if boundaries_done % CHECKPOINT_EVERY == 0:
                meta = head.export_state(STATE)
                (OUT / "progress.json").write_text(json.dumps({
                    "cursor_position": head.position,
                    "generation": meta["generation"],
                    "fit_count": head.fit_count,
                    "elapsed_seconds": round(time.time() - started, 1),
                }, indent=1))
                log(f"checkpoint {meta['generation']} at position {head.position}")

    meta = head.export_state(STATE)
    summary = {
        **head.state_summary(),
        "generation": meta["generation"],
        "frame_rows": n,
        "frame_first_ts": frame.ts.iloc[0].isoformat(),
        "frame_last_ts": frame.ts.iloc[-1].isoformat(),
        "bootstrap_start_position": b0,
        "last_boundary": last_boundary,
        "probability_rows": sum(1 for _ in probabilities_path.open()) - 1,
        "elapsed_seconds": round(time.time() - started, 1),
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=1))
    (OUT / "progress.json").write_text(json.dumps({
        "cursor_position": head.position, "generation": meta["generation"],
        "fit_count": head.fit_count, "done": True,
    }, indent=1))
    log(json.dumps(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
