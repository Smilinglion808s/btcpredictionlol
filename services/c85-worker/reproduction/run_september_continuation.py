"""Advance the C85 RECONSTRUCTION long-context head through September targets.

Continues the bootstrap (position 23,328, generation
`gen-000000023328-4243bdfb0c5f`) over the rebuilt continuation frame, running
the ORIGINAL grid: settle the previous target's label, refit on a 96-boundary,
score out-of-sample, and advance the positional rank window. Nothing here
tunes, replays for archive parity, imputes an absent source row, or substitutes
an archived probability.

Head and rank advance ATOMICALLY, in the ordering the serving path uses
(`src.experts.ChainUpdate`): the staged head is validated first, then the rank
window commits, then the head. A failure at any point leaves both on the
previous target, so a retry re-derives the same pair instead of layering a
second advance on a half-moved state.

Checkpoints write the head state, the rank state and the score ledger together
with a manifest carrying a sha256 for each and the exact interpreter/library
versions of the process that produced them, so a restore can prove it did not
pair a head with a foreign rank history.

Resumable: re-running restores `CURRENT`, binds the ledger to the committed
cursor and never reprocesses a committed position.
"""
from __future__ import annotations

import os

for _var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
             "NUMEXPR_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
    os.environ.setdefault(_var, "1")

import hashlib
import json
import platform
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.experts import ChainUpdate  # noqa: E402
from src.experts import direction_contract as dc  # noqa: E402
from src.experts import long_context as lc  # noqa: E402

FRAME = Path(os.environ.get("C85_LC_FRAME", "/tmp/lc/combined_frame.parquet"))
STATE = Path(os.environ.get("C85_LC_STATE", "/tmp/lc/cont/state"))
RANK = Path(os.environ.get("C85_LC_RANK", "/tmp/lc/cont/rank"))
OUT = Path(os.environ.get("C85_LC_OUT", "/tmp/lc/cont"))
COUNT = int(os.environ.get("C85_LC_COUNT", "96"))
CHECKPOINT_EVERY = int(os.environ.get("C85_LC_CHECKPOINT_EVERY", "24"))
LABEL_SOURCE = "binance_spot_1m"
LEDGER_HEADER = "position,ts,status,probability,rank,direction,fit_id\n"


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def runtime_metadata() -> dict[str, str]:
    import joblib
    import sklearn

    return {
        "python": platform.python_version(),
        "python_build": sys.version,
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "scikit_learn": sklearn.__version__,
        "joblib": joblib.__version__,
        "platform": platform.platform(),
    }


class _StagedHead:
    """The serving-side holder `ChainUpdate` commits against.

    Mirrors `LongContextBootstrap`: `prepare` stages, and nothing touches the
    head until `commit`.
    """

    def __init__(self, head: lc.LongContextHead) -> None:
        self.head = head
        self._staged: lc.HeadUpdate | None = None

    def stage(self, ts: pd.Timestamp, row: dict) -> lc.HeadUpdate:
        self._staged = self.head.prepare(ts, row)
        return self._staged

    def commit(self) -> float | None:
        staged, self._staged = self._staged, None
        return None if staged is None else staged.commit()

    def rollback(self) -> None:
        staged, self._staged = self._staged, None
        if staged is not None:
            staged.rollback()


def load_frame() -> tuple[pd.DataFrame, list[str]]:
    raw = pd.read_parquet(FRAME) if FRAME.suffix == ".parquet" else pd.read_pickle(FRAME)
    frame = lc.prepare_external_frame(raw)
    return frame, lc.feature_columns(list(frame.columns))


def load_producer() -> dc.LongContextLeafProducer:
    payload = json.loads((RANK / "rank_state.json").read_text())
    if "rank_state" not in payload:  # a bare RollingRankState export
        payload = {"rank_state": payload, "last_key": None, "last_output": None,
                   "version": 0}
    return dc.LongContextLeafProducer.from_dict(payload)


def truncate_ledger(path: Path, cursor: int) -> int:
    """Bind the ledger to the committed cursor; committed state is authority."""

    if not path.exists():
        path.write_text(LEDGER_HEADER)
        return 0
    kept = [
        line for line in path.read_text().splitlines()
        if line and not line.startswith("position,") and int(line.split(",", 1)[0]) < cursor
    ]
    path.write_text(LEDGER_HEADER + "".join(f"{line}\n" for line in kept))
    return len(kept)


def settle(head: lc.LongContextHead, ts, label: float, as_of) -> None:
    available = pd.Timestamp(ts) + lc.LABEL_CANDLE
    if np.isfinite(label):
        head.settle_label(ts, label, available_at=available, as_of=as_of,
                          source=LABEL_SOURCE)
    else:
        head.settle_missing_label(
            ts, available_at=available, as_of=as_of, source=LABEL_SOURCE,
            reason="rebuilt frame binance_label is NaN (source not contiguous "
                   "over the settling candle)",
        )


def checkpoint(head: lc.LongContextHead, producer: dc.LongContextLeafProducer,
               ledger: Path) -> dict:
    """Persist head, rank and ledger as ONE verifiable generation."""

    meta = head.export_state(STATE)
    RANK.mkdir(parents=True, exist_ok=True)
    rank_path = RANK / "rank_state.json"
    tmp = rank_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(producer.to_dict(), indent=1))
    os.replace(tmp, rank_path)
    manifest = {
        "generation": meta["generation"],
        "head_position": head.position,
        "head_fit_count": head.fit_count,
        "rank_last_key": producer.last_key,
        "rank_version": producer.version,
        "files": {
            "rank_state.json": sha256(rank_path),
            "ledger": sha256(ledger),
        },
        "ledger_path": ledger.name,
        "runtime": runtime_metadata(),
        "written_at": pd.Timestamp.utcnow().isoformat(),
    }
    (RANK / "rank_manifest.json").write_text(json.dumps(manifest, indent=1))
    return manifest


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    frame, features = load_frame()
    head = lc.LongContextHead.restore_state(STATE)
    producer = load_producer()
    ledger = OUT / "continuation_ledger.csv"

    if producer.last_key is not None and producer.last_key != head.position - 1:
        raise SystemExit(
            f"refusing to run: head is at position {head.position} but the rank "
            f"window last committed {producer.last_key}; the pair is not the same "
            "generation"
        )
    kept = truncate_ledger(ledger, head.position)
    start = head.position
    stop = min(len(frame), start + COUNT)
    log(f"frame rows={len(frame)} features={len(features)}; head position={start} "
        f"fits={head.fit_count}; rank last_key={producer.last_key}; ledger rows kept={kept}")
    log(f"processing [{start}, {stop}) = {frame.ts.iloc[start].isoformat()} .. "
        f"{frame.ts.iloc[stop - 1].isoformat()}")

    records = frame[["ts", "label", *features]].to_dict("records")
    processed = 0
    fits: list[str] = []
    started = time.time()
    staged_head = _StagedHead(head)

    for pos in range(start, stop):
        record = records[pos]
        previous = records[pos - 1]
        # The label of target T is the candle beginning at T: settled one
        # target later, exactly as the original loop does.
        settle(head, previous["ts"], float(previous["label"]),
               as_of=pd.Timestamp(record["ts"]))

        if pos >= lc.MINIMUM and pos % lc.REFIT_EVERY == 0:
            fit_started = time.time()
            fit = head.train_ahead(position=pos)
            fits.append(f"{pos}:{'fit' if fit else 'NO-FIT'}")
            log(f"boundary {pos} {record['ts']} fit={'yes' if fit else 'NO-FIT'} "
                f"rows={getattr(fit, 'training_rows', 0)} "
                f"{round(time.time() - fit_started, 1)}s")

        update = staged_head.stage(pd.Timestamp(record["ts"]), record)
        probability = update.probability
        status = dc.MODEL_SCORED if probability is not None else dc.MODEL_NO_PROBABILITY
        leaf_update = producer.prepare(pos, probability, status=status)
        pair = ChainUpdate(leaf_update=leaf_update, long_context=staged_head)
        try:
            pair.commit()
        except Exception:
            pair.rollback()
            raise
        output = leaf_update.output

        with ledger.open("a") as handle:
            handle.write(
                f"{pos},{pd.Timestamp(record['ts']).isoformat()},{status},"
                f"{'' if probability is None else repr(probability)},"
                f"{output['external_rank']!r},{output['external_direction']},"
                f"{head.fit_id or ''}\n"
            )
        processed += 1
        if processed % CHECKPOINT_EVERY == 0 or pos == stop - 1:
            manifest = checkpoint(head, producer, ledger)
            log(f"checkpoint {manifest['generation']} head={head.position} "
                f"rank_last_key={producer.last_key}")

    summary = {
        **head.state_summary(),
        "first_position": start,
        "last_position": stop - 1,
        "first_target": frame.ts.iloc[start].isoformat(),
        "last_target": frame.ts.iloc[stop - 1].isoformat(),
        "processed": processed,
        "fits": fits,
        "rank_last_key": producer.last_key,
        "rank_version": producer.version,
        "runtime": runtime_metadata(),
        "elapsed_seconds": round(time.time() - started, 1),
    }
    (OUT / "continuation_summary.json").write_text(json.dumps(summary, indent=1, default=str))
    log(json.dumps(summary, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
