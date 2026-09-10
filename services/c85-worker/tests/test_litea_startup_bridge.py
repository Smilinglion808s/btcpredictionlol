"""The startup bridge must not let a missed interval vanish.

Source recovery itself is exercised against the live public venue elsewhere;
here the recovery is stubbed so the CAUSAL behaviour is what is under test:
which targets are planned, that a frame behind the checkpoint is reconciled
without re-deciding, that the pass is idempotent across a restart, and that an
unrecoverable gap blocks scoring instead of being skipped silently.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.litea import bridge as bridge_module  # noqa: E402
from src.litea.bridge import INTERVAL, StartupBridge, last_available_target  # noqa: E402
from src.litea.heads import DailyHeadStore  # noqa: E402
from src.litea.state import LiteAState  # noqa: E402
from src.litea.training import COLUMNS, TrainingFrame  # noqa: E402

NOW = datetime(2026, 9, 10, 3, 0, tzinfo=timezone.utc)


def _row(target: datetime, *, valid: bool = True) -> dict:
    row = {
        "ts": pd.Timestamp(target),
        "ticker": f"KX-{target:%H%M}",
        "input_valid": valid,
        "label": float("nan"),
        "settlement_ts": pd.NaT,
        "blockers": None if valid else "NO_EVENTS:binance_spot",
    }
    for name in COLUMNS[5:]:
        row[name] = 0.0 if valid else float("nan")
    return row


class _Store:
    def __init__(self) -> None:
        self.commits: list[dict] = []

    def commit(self, row, checkpoint):  # noqa: ANN001
        self.commits.append(row)
        return {"ok": True}


class _Service:
    def __init__(self, root: Path, seed: list[datetime]) -> None:
        (root / "heads").mkdir(parents=True, exist_ok=True)
        self.root = root
        self.training = TrainingFrame(pd.DataFrame([_row(t) for t in seed])[COLUMNS])
        self.training_path = root / "training.parquet"
        self.training.save(self.training_path)
        self.state = LiteAState()
        self.state_path = root / "state.json"
        self.heads = DailyHeadStore(root / "heads")
        self.store = _Store()
        self.remote = type("R", (), {"publish": lambda *a, **k: {}})()
        self.worker = type("W", (), {"external_scoring_block": None})()

    def _catch_up_fits(self):
        return []


@pytest.fixture()
def stub_recovery(monkeypatch):
    calls: list[list[datetime]] = []

    def fake(targets):
        calls.append(list(targets))
        return [_row(pd.Timestamp(t)) for t in sorted(targets)]

    monkeypatch.setattr(bridge_module, "recover_targets", fake)
    return calls


def test_plans_every_missed_interval(tmp_path, stub_recovery):
    end = last_available_target(NOW)
    service = _Service(tmp_path, [end - 3 * INTERVAL])
    plan = StartupBridge(service).plan(NOW)
    assert [t.isoformat() for t in plan["targets"]] == [
        (end - 2 * INTERVAL).isoformat(),
        (end - INTERVAL).isoformat(),
        end.isoformat(),
    ]


def test_bridges_and_is_idempotent(tmp_path, stub_recovery):
    end = last_available_target(NOW)
    service = _Service(tmp_path, [end - 3 * INTERVAL])
    report = StartupBridge(service).run(NOW)

    assert report["status"] == "BRIDGED"
    assert report["targets"] == report["recovered"] == report["decided"] == 3
    assert report["committed"] == 3
    assert service.training.last_target == end.isoformat()
    assert service.state.engine.last_target == end.isoformat()
    assert all(c["run_mode"] == "RESEARCH" for c in service.store.commits)
    # execution is structurally absent: a recovered row can never dispatch
    assert all(c["decision"]["execution_enabled"] is False for c in service.store.commits)

    again = StartupBridge(service).run(NOW)
    assert again["status"] == "CURRENT" and again["targets"] == 0
    assert len(service.store.commits) == 3


def test_frame_behind_checkpoint_is_reconciled_without_redeciding(tmp_path, stub_recovery):
    """A newer backend checkpoint must not be paired with an older frame."""
    end = last_available_target(NOW)
    service = _Service(tmp_path, [end - 3 * INTERVAL])
    StartupBridge(service).run(NOW)          # frame and state now both at `end`

    # Simulate the durable snapshot lagging: drop the last two training rows.
    trimmed = service.training.frame.iloc[:-2]
    service.training = TrainingFrame(trimmed)
    service.training.save(service.training_path)
    service.store.commits.clear()

    report = StartupBridge(service).run(NOW)
    assert report["recovered"] == 2
    assert report["decided"] == 0          # already decided; frame-only repair
    assert report["recorded_only"] == 2
    assert service.training.last_target == end.isoformat()
    assert service.store.commits == []


def test_unrecoverable_gap_blocks_scoring(tmp_path, monkeypatch):
    def explode(targets):
        raise RuntimeError("venue unreachable")

    monkeypatch.setattr(bridge_module, "recover_targets", explode)
    end = last_available_target(NOW)
    service = _Service(tmp_path, [end - 2 * INTERVAL])
    report = StartupBridge(service).run(NOW)

    assert report["status"] == "BLOCKED"
    assert "LITEA_SOURCE_GAP" in report["gap"]
    assert "LITEA_SOURCE_GAP" in service.worker.external_scoring_block


def test_oversized_gap_blocks_instead_of_replaying_history(tmp_path, stub_recovery):
    end = last_available_target(NOW)
    service = _Service(tmp_path, [end - timedelta(days=10)])
    report = StartupBridge(service).run(NOW)

    assert report["status"] == "BLOCKED"
    assert "LITEA_GAP_TOO_LARGE" in report["reason"]
    assert stub_recovery == []  # no historical replay was attempted
