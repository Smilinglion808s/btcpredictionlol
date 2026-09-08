"""Subsecond boundary scheduler enforcing the hard T+5s publication ceiling.

Not a browser timer and not a minute-granularity cron. For each quarter-hour
target the worker:

  1. wakes early, discovers the exact Kalshi ticker/strike/open time,
  2. freezes the input packet at T + (5000ms - compute budget), recording the
     freeze instant and every feed watermark,
  3. computes the decision, recording compute start/complete,
  4. re-checks the deadline immediately before dispatch,
  5. dispatches only if now < T+5s; otherwise the target becomes an explicit
     EXPIRED/MISSED row with no catch-up webhook.

Timestamps are never backdated. If a faithful packet cannot be received and
computed inside the ceiling, the run records the measured overrun as the blocker.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from .config import (
    CUTOFF_DEADLINE_CONFLICT_MS,
    FEATURE_INPUT_CUTOFF_MS,
    PUBLICATION_DEADLINE_MS,
)

NS = 1_000_000_000
INTERVAL = timedelta(minutes=15)


def next_boundary(after: datetime | None = None) -> datetime:
    moment = (after or datetime.now(timezone.utc)).astimezone(timezone.utc)
    floor = moment.replace(minute=(moment.minute // 15) * 15, second=0, microsecond=0)
    return floor + INTERVAL


@dataclass
class RunTiming:
    target_open_ns: int
    packet_freeze_ns: int | None = None
    compute_started_ns: int | None = None
    compute_complete_ns: int | None = None
    decision_durable_ns: int | None = None
    dispatch_ns: int | None = None

    @property
    def deadline_ns(self) -> int:
        return self.target_open_ns + PUBLICATION_DEADLINE_MS * 1_000_000

    def offset_ms(self, moment_ns: int | None) -> float | None:
        if moment_ns is None:
            return None
        return (moment_ns - self.target_open_ns) / 1_000_000

    def as_dict(self) -> dict[str, Any]:
        return {
            # 64-bit values are serialised as decimal strings so no consumer can
            # lose ordering precision through a JavaScript Number.
            "target_open_ns": str(self.target_open_ns),
            "packet_freeze_ns": None if self.packet_freeze_ns is None else str(self.packet_freeze_ns),
            "compute_started_ns": None if self.compute_started_ns is None else str(self.compute_started_ns),
            "compute_complete_ns": None if self.compute_complete_ns is None else str(self.compute_complete_ns),
            "decision_durable_ns": None if self.decision_durable_ns is None else str(self.decision_durable_ns),
            "dispatch_ns": None if self.dispatch_ns is None else str(self.dispatch_ns),
            "publication_offset_ms": self.offset_ms(self.dispatch_ns),
            "compute_ms": (
                None
                if self.compute_complete_ns is None or self.compute_started_ns is None
                else (self.compute_complete_ns - self.compute_started_ns) / 1_000_000
            ),
            "deadline_met": (
                None if self.dispatch_ns is None else self.dispatch_ns < self.deadline_ns
            ),
        }


async def sleep_until_ns(when_ns: int) -> None:
    """Sleep with a short spin tail so wakeups land within ~1ms of the target."""
    while True:
        remaining = (when_ns - time.time_ns()) / NS
        if remaining <= 0:
            return
        await asyncio.sleep(remaining - 0.002 if remaining > 0.01 else 0)


class BoundaryScheduler:
    def __init__(
        self,
        handler: Callable[[datetime, RunTiming], Awaitable[None]],
        *,
        prepare_lead_s: float = 20.0,
    ) -> None:
        self.handler = handler
        self.prepare_lead_s = prepare_lead_s
        self._task: asyncio.Task | None = None
        self.current_target: datetime | None = None

    async def _loop(self) -> None:
        while True:
            target = next_boundary()
            self.current_target = target
            target_ns = int(target.timestamp() * NS)
            await sleep_until_ns(target_ns - int(self.prepare_lead_s * NS))

            timing = RunTiming(target_open_ns=target_ns)
            # The model's own input window is [T, T+5s) (FEATURE_INPUT_CUTOFF_MS,
            # transcribed from the original causal contract). The packet cannot
            # be frozen earlier without changing the model, so the handler wakes
            # at the cutoff even though publication is also due at T+5s; that
            # unavoidable overrun is CUTOFF_DEADLINE_CONFLICT_MS and is reported
            # by the orchestrator rather than hidden by an early freeze.
            freeze_ns = target_ns + FEATURE_INPUT_CUTOFF_MS * 1_000_000
            await sleep_until_ns(freeze_ns)
            timing.packet_freeze_ns = time.time_ns()

            try:
                await self.handler(target, timing)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 — one bad boundary must not kill the loop
                pass
            # Guard against re-entering the same boundary.
            await sleep_until_ns(target_ns + 2 * NS)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
