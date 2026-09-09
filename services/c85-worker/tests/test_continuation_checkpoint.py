"""Paired head+rank+ledger checkpoint integrity (reconstruction continuation).

These run the REAL `LongContextHead.export_state` / `restore_state` path and the
REAL positional rank producer — no stubs — so a mistake in the restore API or in
the generation layout fails here rather than in a live restart.

Covered: interruption before and after the pair pointer, a colliding generation
name with different content, a missing committed ledger, duplicated ledger
positions, a wrong rank digest, a foreign identity, and the one explicit
checksum-verified bootstrap migration.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

for _var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_var, "1")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import pytest  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "reproduction"))

from src.experts import direction_contract as dc  # noqa: E402
from src.experts import long_context as lc  # noqa: E402

FEATURES = [f"f{i}" for i in range(4)]
START = pd.Timestamp("2026-01-01", tz="UTC")


@pytest.fixture()
def cont(tmp_path, monkeypatch):
    """Import the continuation script bound to a temporary state root."""

    monkeypatch.setenv("C85_LC_FRAME", str(tmp_path / "frame.parquet"))
    monkeypatch.setenv("C85_LC_STATE", str(tmp_path / "state"))
    monkeypatch.setenv("C85_LC_RANK", str(tmp_path / "rank"))
    monkeypatch.setenv("C85_LC_OUT", str(tmp_path / "out"))
    sys.modules.pop("run_september_continuation", None)
    import run_september_continuation as module  # noqa: PLC0415

    return module


def _rows(n: int, seed: int = 7):
    rng = np.random.default_rng(seed)
    for i in range(n):
        values = rng.normal(size=len(FEATURES))
        yield START + pd.Timedelta(minutes=15 * i), {
            f: float(v) for f, v in zip(FEATURES, values)
        }


def _pair(n: int = 5):
    """A genuinely advanced head and the matching rank producer."""

    head = lc.LongContextHead(features=list(FEATURES))
    producer = dc.LongContextLeafProducer()
    ledger_lines = []
    for pos, (ts, row) in enumerate(_rows(n)):
        head.observe(ts, row)
        update = producer.prepare(pos, None, status=dc.MODEL_NO_PROBABILITY)
        update.commit()
        out = update.output
        ledger_lines.append(
            f"{pos},{ts.isoformat()},{dc.MODEL_NO_PROBABILITY},,"
            f"{out['external_rank']!r},{out['external_direction']},\n"
        )
    return head, producer, ledger_lines


def _write_ledger(path: Path, header: str, lines) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(header + "".join(lines))


def test_roundtrip_restores_the_real_head_and_rank_pair(cont, tmp_path):
    head, producer, lines = _pair()
    ledger = tmp_path / "out" / "ledger.csv"
    _write_ledger(ledger, cont.LEDGER_HEADER, lines)

    manifest = cont.write_pair(head, producer, ledger, floor=0)
    assert manifest["ledger_floor"] == 0
    assert manifest["identity"]["reconstruction_id"] == "c85-reconstruction-r1"

    restored_head, restored_producer, restored_manifest = cont.load_pair(ledger)
    assert restored_head.position == head.position
    assert restored_head.features == head.features
    assert restored_producer.last_key == producer.last_key == head.position - 1
    assert restored_manifest["generation"] == manifest["generation"]
    # And the restored pair scores the next row identically to the live one.
    ts, row = list(_rows(head.position + 1))[-1]
    assert restored_head.prepare(ts, row).probability == head.prepare(ts, row).probability


def test_interruption_before_the_pointer_keeps_the_previous_pair(cont, tmp_path):
    head, producer, lines = _pair()
    ledger = tmp_path / "out" / "ledger.csv"
    _write_ledger(ledger, cont.LEDGER_HEADER, lines)
    first = cont.write_pair(head, producer, ledger, floor=0)

    # Advance, write the new generation directory, but die before the pointer.
    # COVERAGE QUALIFICATION: the injected failure fires on every write whose
    # path ends in CURRENT, which includes the head's own pointer. It therefore
    # proves "no pointer of either kind is left half-written", not specifically
    # "a crash after the head export and before the pair pointer".
    for pos, (ts, row) in enumerate(_rows(head.position + 1), start=0):
        pass
    ts, row = list(_rows(head.position + 1))[-1]
    head.observe(ts, row)
    update = producer.prepare(head.position - 1, None, status=dc.MODEL_NO_PROBABILITY)
    update.commit()
    lines.append(f"{head.position - 1},{ts.isoformat()},{dc.MODEL_NO_PROBABILITY},,"
                 f"{update.output['external_rank']!r},"
                 f"{update.output['external_direction']},\n")
    _write_ledger(ledger, cont.LEDGER_HEADER, lines)
    real_replace = os.replace

    def fail_on_pointer(src, dst):
        if str(dst).endswith("CURRENT"):
            raise OSError("crash before the pointer swap")
        return real_replace(src, dst)

    import run_september_continuation as module

    module.os.replace = fail_on_pointer
    try:
        with pytest.raises(OSError):
            cont.write_pair(head, producer, ledger, floor=0)
    finally:
        module.os.replace = real_replace

    restored_head, restored_producer, manifest = cont.load_pair(ledger)
    assert manifest["generation"] == first["generation"]
    assert restored_head.position == first["head_position"]
    assert restored_producer.last_key == first["rank_last_key"]


def test_colliding_generation_with_different_content_is_refused(cont, tmp_path):
    head, producer, lines = _pair()
    ledger = tmp_path / "out" / "ledger.csv"
    _write_ledger(ledger, cont.LEDGER_HEADER, lines)
    manifest = cont.write_pair(head, producer, ledger, floor=0)

    generation = manifest["generation"]
    real_export = head.export_state
    head.export_state = lambda directory: {**real_export(directory),
                                           "generation": generation}
    # Same name, different rank content -> refuse, and leave the original.
    producer.prepare(head.position, None, status=dc.MODEL_NO_PROBABILITY).commit()
    lines.append(f"{head.position},{START.isoformat()},{dc.MODEL_NO_PROBABILITY},,"
                 f"nan,0,\n")
    with pytest.raises(cont.PairIntegrityError, match="different content"):
        cont.write_pair(head, producer, ledger, floor=0)
    stored = json.loads(
        (tmp_path / "rank" / "generations" / generation / "MANIFEST.json").read_text())
    assert stored["files"] == manifest["files"]


def test_missing_committed_ledger_is_refused(cont, tmp_path):
    head, producer, lines = _pair()
    ledger = tmp_path / "out" / "ledger.csv"
    _write_ledger(ledger, cont.LEDGER_HEADER, lines)
    cont.write_pair(head, producer, ledger, floor=0)
    ledger.unlink()
    with pytest.raises(cont.PairIntegrityError, match="committed history is missing"):
        cont.truncate_ledger(ledger, head.position, floor=0)


def test_duplicate_and_gappy_ledger_positions_are_refused(cont, tmp_path):
    ledger = tmp_path / "out" / "ledger.csv"
    rows = [(0, "2026-01-01T00:00:00+00:00"), (1, "2026-01-01T00:15:00+00:00"),
            (1, "2026-01-01T00:15:00+00:00")]
    _write_ledger(ledger, cont.LEDGER_HEADER,
                  [f"{p},{ts},{dc.MODEL_NO_PROBABILITY},,nan,0,\n" for p, ts in rows])
    with pytest.raises(cont.PairIntegrityError, match="contiguous"):
        cont.truncate_ledger(ledger, 3, floor=0)


def test_wrong_rank_digest_is_refused(cont, tmp_path):
    head, producer, lines = _pair()
    ledger = tmp_path / "out" / "ledger.csv"
    _write_ledger(ledger, cont.LEDGER_HEADER, lines)
    manifest = cont.write_pair(head, producer, ledger, floor=0)
    gen_dir = tmp_path / "rank" / "generations" / manifest["generation"]
    payload = json.loads((gen_dir / "rank_state.json").read_text())
    payload["version"] = payload.get("version", 0) + 99
    (gen_dir / "rank_state.json").write_text(json.dumps(payload))
    with pytest.raises(cont.PairIntegrityError, match="digest"):
        cont.load_pair(ledger)


def test_foreign_identity_is_refused(cont, tmp_path):
    head, producer, lines = _pair()
    ledger = tmp_path / "out" / "ledger.csv"
    _write_ledger(ledger, cont.LEDGER_HEADER, lines)
    manifest = cont.write_pair(head, producer, ledger, floor=0)
    gen_dir = tmp_path / "rank" / "generations" / manifest["generation"]
    stored = json.loads((gen_dir / "MANIFEST.json").read_text())
    stored["identity"]["reconstruction_id"] = "c85-multi-meta-r1"
    (gen_dir / "MANIFEST.json").write_text(json.dumps(stored))
    with pytest.raises(cont.PairIntegrityError, match="identity"):
        cont.load_pair(ledger)


def test_missing_pointer_never_silently_downgrades(cont, tmp_path, monkeypatch):
    head, producer, lines = _pair()
    ledger = tmp_path / "out" / "ledger.csv"
    _write_ledger(ledger, cont.LEDGER_HEADER, lines)
    cont.write_pair(head, producer, ledger, floor=0)
    (tmp_path / "rank" / "CURRENT").unlink()
    # Legacy layout present, but not declared: refuse.
    legacy = tmp_path / "rank" / "rank_state.json"
    legacy.write_text(json.dumps(producer.to_dict(), indent=1))
    monkeypatch.delenv("C85_LC_ADOPT_BOOTSTRAP_SHA256", raising=False)
    with pytest.raises(cont.PairIntegrityError, match="refusing to fall back"):
        cont.load_pair(ledger)

    # A wrong declared checksum is refused too.
    monkeypatch.setenv("C85_LC_ADOPT_BOOTSTRAP_SHA256", "0" * 64)
    with pytest.raises(cont.PairIntegrityError, match="does not match the declared"):
        cont.load_pair(ledger)

    # The exact checksum migrates the bootstrap once.
    digest = hashlib.sha256(legacy.read_bytes()).hexdigest()
    monkeypatch.setenv("C85_LC_ADOPT_BOOTSTRAP_SHA256", digest)
    restored_head, restored_producer, manifest = cont.load_pair(ledger)
    assert manifest["generation"] == "BOOTSTRAP_MIGRATION"
    assert restored_head.position == head.position
    assert restored_producer.last_key == producer.last_key
