"""Resumable, dependency-ordered stage runner for the C85 continuation rebuild.

Each stage persists:
  * its outputs (cached artifacts under the continuation cache),
  * the fitted state / history buffers / pending outcomes it owns,
  * a progress cursor (the research end it has been advanced to),
  * the producer patch records used to build it.

A restart, or a new quarter-hour, re-enters `advance()`: stages whose cursor is
already at or past the requested end are skipped entirely, and stages behind the
end are asked to advance incrementally from their cursor. Nothing rebuilds the
full history unless the cache is empty or the stage declares its inputs changed.
"""
from __future__ import annotations

import json
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable

import pandas as pd

from .config import CHECKPOINTS, ensure_dirs, research_end

BOOTSTRAP = "bootstrap"
INCREMENTAL = "incremental"


@dataclass
class StageResult:
    cursor: pd.Timestamp
    rows: int = 0
    outputs: list[str] = field(default_factory=list)
    patches: list[dict] = field(default_factory=list)
    notes: dict = field(default_factory=dict)


@dataclass
class Stage:
    name: str
    depends_on: tuple[str, ...]
    run: Callable[[pd.Timestamp, dict | None], StageResult]
    # Stages that can only rebuild from scratch declare incremental=False; the
    # runner then re-runs them whole when the end moves, but still skips them
    # when the cursor already matches.
    incremental: bool = True
    description: str = ""
    # Input-bound stages read recovered capture ledgers that stop at the frozen
    # research end. Their ceiling is FROZEN_END: asking for a later end cannot
    # produce more rows, so the runner treats them (and their dependants)
    # as satisfied at FROZEN_END rather than blocking the graph forever.
    frozen_end: bool = False

    def target(self, end: pd.Timestamp) -> pd.Timestamp:
        return min(end, FROZEN_END) if self.frozen_end else end


class Checkpoint:
    def __init__(self, name: str) -> None:
        ensure_dirs()
        self.name = name
        self.path = CHECKPOINTS / f"{name}.json"

    def read(self) -> dict | None:
        if not self.path.exists():
            return None
        return json.loads(self.path.read_text())

    def write(self, payload: dict) -> None:
        tmp = self.path.with_suffix(".part")
        tmp.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
        tmp.replace(self.path)

    @property
    def cursor(self) -> pd.Timestamp | None:
        data = self.read()
        if not data or not data.get("cursor"):
            return None
        return pd.Timestamp(data["cursor"])


class Runner:
    def __init__(self, stages: Iterable[Stage]) -> None:
        self.stages = {s.name: s for s in stages}
        self._validate()

    def _validate(self) -> None:
        for stage in self.stages.values():
            for dep in stage.depends_on:
                if dep not in self.stages:
                    raise RuntimeError(f"stage {stage.name} depends on unknown stage {dep}")

    def order(self) -> list[Stage]:
        """Deterministic topological order (dependency first, then name)."""
        resolved: list[Stage] = []
        seen: set[str] = set()
        visiting: set[str] = set()

        def visit(name: str) -> None:
            if name in seen:
                return
            if name in visiting:
                raise RuntimeError(f"dependency cycle at stage {name}")
            visiting.add(name)
            stage = self.stages[name]
            for dep in sorted(stage.depends_on):
                visit(dep)
            visiting.discard(name)
            seen.add(name)
            resolved.append(stage)

        for name in sorted(self.stages):
            visit(name)
        return resolved

    def status(self, end: pd.Timestamp | None = None) -> list[dict]:
        end = end or research_end()
        rows = []
        for stage in self.order():
            data = Checkpoint(stage.name).read() or {}
            cursor = data.get("cursor")
            rows.append({
                "stage": stage.name,
                "depends_on": list(stage.depends_on),
                "cursor": cursor,
                "rows": data.get("rows"),
                "complete": bool(cursor) and pd.Timestamp(cursor) >= end,
                "mode": data.get("mode"),
                "updated_at": data.get("updated_at"),
                "error": data.get("error"),
            })
        return rows

    def advance(self, end: pd.Timestamp | None = None, only: str | None = None) -> list[dict]:
        end = end or research_end()
        report = []
        for stage in self.order():
            if only and stage.name != only:
                continue
            checkpoint = Checkpoint(stage.name)
            previous = checkpoint.read()
            cursor = pd.Timestamp(previous["cursor"]) if previous and previous.get("cursor") else None
            if cursor is not None and cursor >= end:
                report.append({"stage": stage.name, "action": "skipped", "cursor": str(cursor)})
                continue
            blocked = [d for d in stage.depends_on
                       if (Checkpoint(d).cursor or pd.Timestamp(0, tz="UTC")) < end]
            if blocked:
                report.append({"stage": stage.name, "action": "blocked", "on": blocked})
                continue
            mode = INCREMENTAL if (cursor is not None and stage.incremental) else BOOTSTRAP
            started = time.time()
            try:
                result = stage.run(end, previous if mode == INCREMENTAL else None)
            except Exception as exc:  # keep independent blockers visible
                checkpoint.write({**(previous or {}), "error": f"{type(exc).__name__}: {exc}",
                                  "traceback": traceback.format_exc()[-4000:],
                                  "updated_at": pd.Timestamp.utcnow().isoformat()})
                report.append({"stage": stage.name, "action": "failed", "error": str(exc)})
                continue
            checkpoint.write({
                "stage": stage.name,
                "cursor": str(result.cursor),
                "rows": result.rows,
                "outputs": result.outputs,
                "patches": result.patches,
                "notes": result.notes,
                "mode": mode,
                "seconds": round(time.time() - started, 1),
                "updated_at": pd.Timestamp.utcnow().isoformat(),
                "error": None,
            })
            report.append({"stage": stage.name, "action": mode, "cursor": str(result.cursor),
                           "rows": result.rows})
        return report
