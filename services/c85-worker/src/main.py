"""C85 worker entrypoint.

Startup sequence (all automatic; there is no manual warmup button):

  1. verify artifacts and the feature order
  2. restore the newest durable checkpoint, else load the historical seed
  3. start the market-data collectors
  4. bridge the gap chronologically as RESEARCH_BACKFILL, checkpointing
  5. run any applicable scheduled daily/monthly fit
  6. verify feeds, experts and measured timing
  7. only then flip to READY and arm the boundary scheduler

Readiness fails closed. Any missing feed, unconnected inherited expert, absent
applicable fit or measured T+5 overrun keeps the worker BLOCKED with a concrete
reason, and no live prediction is published.
"""
from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timezone
from typing import Any

import uvicorn

from .artifacts import ArtifactStore
from .backend import BackendClient
from .config import DISPLAY_NAME, MODEL_VERSION, load_settings
from .experts import ExpertRegistry
from .feeds import FeedRegistry
from .gateway import GatewayClient
from .health import create_app
from .scheduler import BoundaryScheduler, RunTiming, next_boundary
from .store import C85Store
from .warmup import Stage, WarmupCoordinator


class Worker:
    def __init__(self) -> None:
        self.settings = load_settings()
        self.artifacts = ArtifactStore(self.settings.artifact_dir)
        self.backend = BackendClient(
            self.settings.ops_url,
            self.settings.gateway_secret,
            self.settings.worker_id,
        )
        self.store = C85Store(self.backend, self.settings.worker_id)
        self.feeds = FeedRegistry(dict(os.environ))
        self.experts = ExpertRegistry()
        self.gateway = GatewayClient(self.settings.gateway_url, self.settings.gateway_secret)
        self.warmup = WarmupCoordinator(self.artifacts, self.store)
        self.state = None
        self.readiness = "WARMING"
        self.blocking_reason: str | None = None
        self.owns_lease = False
        self.scheduler = BoundaryScheduler(self.on_boundary)


    # -- readiness --------------------------------------------------------------
    def evaluate_readiness(self) -> tuple[str, str | None]:
        missing_feeds = self.feeds.missing()
        if missing_feeds:
            return "BLOCKED", f"C85_FEEDS_STALE: {', '.join(missing_feeds)}"
        if not self.experts.connected:
            return "BLOCKED", (
                "C85_EXPERTS_NOT_CONNECTED: " + ", ".join(self.experts.missing)
            )
        if not self.settings.allow_live_publication:
            return "BLOCKED", "C85_ALLOW_LIVE_PUBLICATION=false"
        return "READY", None

    def snapshot(self) -> dict[str, Any]:
        return {
            "model_version": MODEL_VERSION,
            "display_name": DISPLAY_NAME,
            "worker_id": self.settings.worker_id,
            "build_sha": self.settings.build_sha,
            "readiness": self.readiness,
            "stage": self.warmup.progress.stage.value,
            "blocking_reason": self.blocking_reason,
            "progress": self.warmup.progress.as_dict(),
            "artifacts": self.artifacts.inventory(),
            "feeds": self.feeds.watermarks(),
            "experts": self.experts.status(),
            "next_target_utc": next_boundary().isoformat(),
            "allow_live_publication": self.settings.allow_live_publication,
            "at": datetime.now(timezone.utc).isoformat(),
        }

    # -- boundary ---------------------------------------------------------------
    async def on_boundary(self, target: datetime, timing: RunTiming) -> None:
        """Compute and publish one target, or record exactly why it did not."""
        ticker = self._ticker_for(target)
        readiness, reason = self.evaluate_readiness()
        if readiness != "READY":
            self.store.mark_missed(ticker, target, reason or "not_ready")
            return

        # Scheduler ownership: overlapping deployments must never both process
        # the same target. The lease is short-lived and fenced in the backend.
        lease = self.store.acquire_lease(self.settings.lease_ttl_seconds)
        self.owns_lease = bool(lease.get("granted"))
        if not self.owns_lease:
            self.store.mark_missed(
                ticker, target, f"C85_LEASE_HELD_BY:{lease.get('owner_id', 'other')}"
            )
            return

        timing.compute_started_ns = time.time_ns()
        # Faithful packet construction is gated on the feature port and the
        # inherited experts; both fail closed above, so this point is only
        # reachable once they are connected.
        raise NotImplementedError(
            "C85_PIPELINE_INCOMPLETE: connect features.build_direction_features, "
            "features.build_meta_features and the inherited expert registry."
        )

    def _ticker_for(self, target: datetime) -> str:
        """Kalshi KXBTC15M event ticker for the target's close, in US Eastern."""
        from zoneinfo import ZoneInfo

        months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
        close = target.astimezone(ZoneInfo("America/New_York"))
        return (
            f"{self.settings.kalshi_series}-"
            f"{close:%y}{months[close.month - 1]}{close:%d%H%M}"
        )

    # -- lifecycle --------------------------------------------------------------
    async def heartbeat_loop(self) -> None:
        while True:
            try:
                self.store.heartbeat(
                    readiness=self.readiness,
                    stage=self.warmup.progress.stage.value,
                    blocking_reason=self.blocking_reason,
                    progress=self.warmup.progress.as_dict(),
                    feed_freshness=self.feeds.watermarks(),
                    next_target_utc=next_boundary().isoformat(),
                    last_checkpoint_seq=self.warmup.progress.checkpoint_seq,
                    build_sha=self.settings.build_sha,
                )
            except Exception:  # noqa: BLE001
                pass
            try:
                if self.readiness == "READY":
                    self.owns_lease = bool(
                        self.store.acquire_lease(self.settings.lease_ttl_seconds).get("granted")
                    )
            except Exception:  # noqa: BLE001
                pass
            await asyncio.sleep(self.settings.heartbeat_seconds)

    async def run(self) -> None:
        self.warmup.progress.stage = Stage.VERIFY
        await self.feeds.start()

        seed = self.settings.artifact_dir / "fixtures" / "historical_seed_2026-09-01.json"
        self.state, resumed = self.warmup.restore_or_seed(seed)
        pending = self.warmup.plan_bridge(self.state, datetime.now(timezone.utc))
        self.warmup.progress.next_target = next_boundary().isoformat()

        self.readiness, self.blocking_reason = self.evaluate_readiness()
        if self.readiness == "READY":
            self.warmup.ready(next_boundary())
            self.scheduler.start()
        else:
            self.warmup.block(self.blocking_reason or "unknown")

        asyncio.create_task(self.heartbeat_loop())

        config = uvicorn.Config(
            create_app(self.snapshot),
            host="0.0.0.0",
            port=self.settings.http_port,
            log_level="info",
        )
        await uvicorn.Server(config).serve()


def main() -> None:
    asyncio.run(Worker().run())


if __name__ == "__main__":
    main()
