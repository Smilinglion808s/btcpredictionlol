"""Serving restore must follow the PAIRED generation pointer.

The continuation runner writes each committed (head, rank) pair under
`rank/generations/<generation>/` and activates it by writing `rank/CURRENT`
last. The original bootstrap package also left a flat `rank/rank_state.json`
behind. Reading that flat file while a pointer exists paired an advanced head
with the stale bootstrap rank history — the exact defect these tests pin.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

for _var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_var, "1")

import pytest  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.experts import long_context_serving as serving  # noqa: E402


class _Head:
    position = 24_096
    fit_id = "T0_LONG_CONTEXT_R1:24000"
    fit_count = 39
    buffer: list = []
    _last_ts = None
    _labels_by_ts: dict = {}


class _Producer:
    def __init__(self, last_key: int) -> None:
        self.last_key = last_key

    @classmethod
    def from_dict(cls, payload):
        return cls(payload["last_key"])


def _layout(tmp_path: Path, *, pointer: str | None, paired_last_key: int,
            flat_last_key: int = 23_327) -> tuple[Path, Path]:
    state = tmp_path / "state"
    rank = tmp_path / "rank"
    (state / "x").parent.mkdir(parents=True, exist_ok=True)
    rank.mkdir(parents=True, exist_ok=True)
    (state / "CURRENT").write_text("gen-000000024096-6a9bada7b5ab")
    (rank / "rank_state.json").write_text(json.dumps({"last_key": flat_last_key}))
    if pointer is not None:
        gen = rank / "generations" / pointer
        gen.mkdir(parents=True)
        (gen / "rank_state.json").write_text(json.dumps({"last_key": paired_last_key}))
        (gen / "MANIFEST.json").write_text(json.dumps({"generation": pointer}))
        (rank / "CURRENT").write_text(pointer)
    return state, rank


@pytest.fixture(autouse=True)
def _stub(monkeypatch):
    monkeypatch.setattr(serving.lc.LongContextHead, "restore_state",
                        classmethod(lambda cls, path: _Head()))
    monkeypatch.setattr(serving, "LongContextLeafProducer", _Producer)


def test_pointer_generation_wins_over_the_flat_bootstrap_file(tmp_path):
    state, rank = _layout(tmp_path, pointer="gen-000000024096-6a9bada7b5ab",
                          paired_last_key=24_095)
    restored = serving.LongContextBootstrap.restore(state, rank)
    assert restored.producer.last_key == 24_095
    assert restored.generation == "gen-000000024096-6a9bada7b5ab"


def test_pointer_naming_another_generation_is_refused(tmp_path):
    state, rank = _layout(tmp_path, pointer="gen-000000023424-5dae61711fab",
                          paired_last_key=23_423)
    with pytest.raises(ValueError, match="not one committed pair"):
        serving.LongContextBootstrap.restore(state, rank)


def test_missing_pointed_generation_is_refused(tmp_path):
    state, rank = _layout(tmp_path, pointer="gen-000000024096-6a9bada7b5ab",
                          paired_last_key=24_095)
    (rank / "generations" / "gen-000000024096-6a9bada7b5ab"
     / "rank_state.json").unlink()
    with pytest.raises(FileNotFoundError):
        serving.LongContextBootstrap.restore(state, rank)


def test_without_a_pointer_the_flat_file_must_still_match_the_head(tmp_path):
    state, rank = _layout(tmp_path, pointer=None, paired_last_key=0)
    with pytest.raises(ValueError, match="does not belong to this"):
        serving.LongContextBootstrap.restore(state, rank)
