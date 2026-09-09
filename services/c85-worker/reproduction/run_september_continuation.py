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


class PairIntegrityError(RuntimeError):
    """The persisted head+rank+ledger generation is not one verified pair."""


def _producer_from_payload(payload: dict) -> dc.LongContextLeafProducer:
    if "rank_state" not in payload:  # a bare RollingRankState export
        payload = {"rank_state": payload, "last_key": None, "last_output": None,
                   "version": 0}
    return dc.LongContextLeafProducer.from_dict(payload)


def read_ledger_rows(path: Path) -> list[tuple[int, str]]:
    """(position, ts) for every committed ledger row, in file order."""

    rows: list[tuple[int, str]] = []
    if not path.exists():
        return rows
    for line in path.read_text().splitlines():
        if not line or line.startswith("position,"):
            continue
        position, ts = line.split(",", 2)[:2]
        rows.append((int(position), ts))
    return rows


def validate_ledger_grid(rows: list[tuple[int, str]], *, floor: int, cursor: int) -> None:
    """Exact, unique, contiguous positions with strictly increasing timestamps."""

    positions = [p for p, _ in rows]
    expected = list(range(floor, cursor))
    if positions != expected:
        duplicates = sorted({p for p in positions if positions.count(p) > 1})
        raise PairIntegrityError(
            f"ledger grid is not the exact contiguous range [{floor}, {cursor}): "
            f"rows={len(positions)} first={positions[0] if positions else None} "
            f"last={positions[-1] if positions else None} duplicates={duplicates}")
    stamps = [pd.Timestamp(ts) for _, ts in rows]
    if any(b <= a for a, b in zip(stamps, stamps[1:])):
        raise PairIntegrityError("ledger timestamps are not strictly increasing")


def write_pair(head: lc.LongContextHead, producer: dc.LongContextLeafProducer,
               ledger: Path, *, floor: int) -> dict:
    """Persist head, rank and ledger as ONE generation, pointer activated LAST.

    Ordering is the whole point: the head writes its own immutable generation
    (and retains the previous one), the rank state and the ledger snapshot are
    staged into a generation directory of the same name and moved into place,
    and only then is `RANK/CURRENT` replaced. `RANK/CURRENT` — not the head's
    own pointer — is the authority for the PAIR, so an interruption at any
    point leaves the previous complete pair active.

    A generation directory is IMMUTABLE. If one of the same name already
    exists it is reused only when its recorded digests are identical to what
    this call produced; otherwise the collision is refused rather than
    overwritten.
    """

    from src import reconstruction

    validate_ledger_grid(read_ledger_rows(ledger), floor=floor, cursor=head.position)

    meta = head.export_state(STATE)
    generation = meta["generation"]
    generations = RANK / "generations"
    generations.mkdir(parents=True, exist_ok=True)
    staging = generations / f".staging-{os.getpid()}-{int(time.time() * 1e6)}"
    staging.mkdir(parents=True, exist_ok=False)
    rank_path = staging / "rank_state.json"
    rank_path.write_text(json.dumps(producer.to_dict(), indent=1))
    ledger_copy = staging / "ledger.csv"
    ledger_copy.write_bytes(ledger.read_bytes())
    manifest = {
        "generation": generation,
        "head_position": head.position,
        "head_fit_count": head.fit_count,
        "head_state_dir": str(STATE / "generations" / generation),
        "rank_last_key": producer.last_key,
        "rank_version": producer.version,
        "ledger_floor": int(floor),
        "ledger_rows": max(0, len(ledger_copy.read_text().splitlines()) - 1),
        "files": {
            "rank_state.json": sha256(rank_path),
            "ledger.csv": sha256(ledger_copy),
        },
        "identity": reconstruction.identity(),
        "runtime": runtime_metadata(),
        "written_at": pd.Timestamp.utcnow().isoformat(),
    }
    (staging / "MANIFEST.json").write_text(json.dumps(manifest, indent=1))
    target = generations / generation
    if target.exists():
        try:
            existing = json.loads((target / "MANIFEST.json").read_text())
        except (OSError, ValueError) as exc:
            raise PairIntegrityError(
                f"generation {generation!r} already exists and is unreadable ({exc}); "
                "immutable generations are never replaced") from exc
        same = (existing.get("files") == manifest["files"]
                and existing.get("head_position") == manifest["head_position"]
                and existing.get("rank_last_key") == manifest["rank_last_key"]
                and existing.get("ledger_floor") == manifest["ledger_floor"])
        for child in staging.iterdir():
            child.unlink()
        staging.rmdir()
        if not same:
            raise PairIntegrityError(
                f"generation {generation!r} already exists with different content; "
                "refusing to replace an immutable generation")
        manifest = existing
    else:
        os.replace(staging, target)
    pointer_tmp = RANK / f".CURRENT-{os.getpid()}-{int(time.time() * 1e6)}"
    pointer_tmp.write_text(generation)
    os.replace(pointer_tmp, RANK / "CURRENT")
    return manifest


def load_pair(ledger: Path) -> tuple[lc.LongContextHead, dc.LongContextLeafProducer, dict]:
    """Restore the ACTIVE pair, verifying identity, cursor and hashes.

    Refuses every inconsistency instead of repairing it: a missing pointer, a
    missing head generation, a foreign reconstruction identity, a manifest
    whose generation disagrees with the pointer, a missing or mismatching
    digest, an empty or incompatible rank cursor, or a committed history the
    ledger cannot account for.

    A pre-pointer bootstrap package is adopted only when the operator names its
    exact `rank_state.json` sha256 in `C85_LC_ADOPT_BOOTSTRAP_SHA256`. A
    missing pointer never silently downgrades to the legacy layout.
    """

    from src import reconstruction

    pointer = RANK / "CURRENT"
    if pointer.exists():
        generation = pointer.read_text().strip()
        gen_dir = RANK / "generations" / generation
        if not gen_dir.is_dir():
            raise PairIntegrityError(
                f"RANK/CURRENT points at a missing generation {generation!r}")
        manifest = json.loads((gen_dir / "MANIFEST.json").read_text())
        if manifest.get("generation") != generation:
            raise PairIntegrityError(
                f"manifest generation {manifest.get('generation')!r} does not match "
                f"the pointer {generation!r}")
        identity = manifest.get("identity") or {}
        expected_identity = reconstruction.identity()
        if (identity.get("reconstruction_id") != expected_identity["reconstruction_id"]
                or identity.get("lineage") != expected_identity["lineage"]):
            raise PairIntegrityError(
                f"generation {generation!r} carries identity {identity!r}, not "
                f"{expected_identity['reconstruction_id']!r}")
        digests = manifest.get("files") or {}
        for name in ("rank_state.json", "ledger.csv"):
            if name not in digests:
                raise PairIntegrityError(f"manifest has no sha256 for {name}")
        for name, expected in digests.items():
            got = sha256(gen_dir / name)
            if got != expected:
                raise PairIntegrityError(
                    f"{name} digest {got} does not match the manifest {expected}")
        head_dir = STATE / "generations" / generation
        if not head_dir.is_dir():
            raise PairIntegrityError(
                f"head generation {generation!r} is missing at {head_dir}")
        head = lc.LongContextHead.restore_state(head_dir)
        producer = _producer_from_payload(json.loads((gen_dir / "rank_state.json").read_text()))
        if head.position != manifest["head_position"]:
            raise PairIntegrityError(
                f"restored head position {head.position} != manifest "
                f"{manifest['head_position']}")
        if producer.last_key is None or producer.last_key != manifest["rank_last_key"]:
            raise PairIntegrityError(
                f"restored rank last_key {producer.last_key} != manifest "
                f"{manifest['rank_last_key']}")
        ledger.parent.mkdir(parents=True, exist_ok=True)
        ledger.write_bytes((gen_dir / "ledger.csv").read_bytes())
        log(f"restored pair generation {generation} (head={head.position} "
            f"rank_last_key={producer.last_key})")
        return head, producer, manifest

    # No paired pointer: the ONLY accepted case is one explicit, checksum-named
    # migration of the known bootstrap package.
    declared = (os.environ.get("C85_LC_ADOPT_BOOTSTRAP_SHA256") or "").strip()
    rank_path = RANK / "rank_state.json"
    if not declared:
        raise PairIntegrityError(
            f"no RANK/CURRENT pointer at {RANK}; refusing to fall back to the legacy "
            "layout. Set C85_LC_ADOPT_BOOTSTRAP_SHA256 to the sha256 of the bootstrap "
            "rank_state.json to migrate it once.")
    if not rank_path.exists():
        raise PairIntegrityError(
            f"bootstrap migration requested but {rank_path} does not exist")
    got = sha256(rank_path)
    if got != declared:
        raise PairIntegrityError(
            f"bootstrap rank_state.json sha256 {got} does not match the declared "
            f"{declared}; refusing the migration")
    head = lc.LongContextHead.restore_state(STATE)
    producer = _producer_from_payload(json.loads(rank_path.read_text()))
    if producer.last_key is None:
        raise PairIntegrityError("bootstrap rank state has no committed cursor")
    if producer.last_key != head.position - 1:
        raise PairIntegrityError(
            f"bootstrap head position {head.position} and rank cursor "
            f"{producer.last_key} are not one pair")
    manifest = {"generation": "BOOTSTRAP_MIGRATION", "head_position": head.position,
                "rank_last_key": producer.last_key, "ledger_floor": head.position,
                "identity": reconstruction.identity(),
                "files": {"rank_state.json": got}}
    log(f"adopted the checksum-verified bootstrap ({got}); the next checkpoint "
        "writes a verified paired generation")
    return head, producer, manifest


def truncate_ledger(path: Path, cursor: int, *, floor: int) -> int:
    """Bind the ledger to the committed cursor; committed state is authority.

    `floor` is the first position this run may own. Every position between the
    floor and the committed cursor must be present exactly once, in order:
    a short, gappy or duplicated history is refused, never fabricated.
    """

    if not path.exists():
        if cursor > floor:
            raise PairIntegrityError(
                f"committed cursor {cursor} is ahead of the ledger floor {floor} "
                f"but {path} does not exist; the committed history is missing")
        path.write_text(LEDGER_HEADER)
        return 0
    rows = [(p, ts) for p, ts in read_ledger_rows(path) if p < cursor]
    validate_ledger_grid(rows, floor=floor, cursor=cursor)
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
               ledger: Path, *, floor: int) -> dict:
    return write_pair(head, producer, ledger, floor=floor)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    frame, features = load_frame()
    ledger = OUT / "continuation_ledger.csv"
    head, producer, manifest = load_pair(ledger)

    # The floor is a property of the persisted generation, not of wherever the
    # head happens to be now: defaulting it to head.position would make the
    # missing-history check vacuous.
    floor = manifest.get("ledger_floor")
    if floor is None:
        floor = os.environ.get("C85_LC_LEDGER_FLOOR")
        if floor is None:
            raise PairIntegrityError(
                "the active generation records no ledger_floor; set "
                "C85_LC_LEDGER_FLOOR explicitly for this migration")
    floor = int(floor)
    kept = truncate_ledger(ledger, head.position, floor=floor)


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
            manifest = checkpoint(head, producer, ledger, floor=floor)
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
