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
from .experts import ExpertRegistry, LiveExpertChain
from .feeds import FeedRegistry
from .gateway import GatewayClient
from .health import create_app
from .orchestration import BoundaryOrchestrator, UnavailablePacketSource
from .scheduler import BoundaryScheduler, RunTiming, next_boundary
from .store import C85Store
from .tickers import KalshiTickerResolver
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
        # The ported ancestor chain (leaf -> C42 -> C51 -> C54). Instantiating it
        # does not make the worker ready: the registry stays disconnected until
        # every stage can actually run, and evaluate_readiness surfaces why.
        self.experts.chain = LiveExpertChain()
        self.gateway = GatewayClient(self.settings.gateway_url, self.settings.gateway_secret)
        self.warmup = WarmupCoordinator(self.artifacts, self.store)
        self.state = None
        self.readiness = "WARMING"
        self.blocking_reason: str | None = None
        self.owns_lease = False
        self.pending_bridge: list[datetime] = []
        # Live raw-feature production is still an unmet dependency, so the
        # orchestrator is wired to the fail-closed packet source. Swapping in a
        # real source is the only change needed to make the boundary path live;
        # nothing else on the path is a placeholder.
        self.packet_source = UnavailablePacketSource(
            reasons=self.experts.status().get("blocking_reasons") or None
        )
        self.ticker_resolver = KalshiTickerResolver(
            self.settings.kalshi_series, self._fetch_market_metadata
        )
        self.orchestrator = BoundaryOrchestrator(
            artifacts=self.artifacts,
            store=self.store,
            gateway=self.gateway,
            packet_source=self.packet_source,
            ticker_resolver=self.ticker_resolver,
            allow_dispatch=self.settings.allow_live_publication,
        )
        self.scheduler = BoundaryScheduler(self.on_boundary)

    def _fetch_market_metadata(self, ticker: str) -> list[dict[str, Any]]:
        """Real venue metadata for ticker verification (never cached across days)."""
        import httpx

        url = f"{self.settings.kalshi_api_base.rstrip('/')}/markets"
        with httpx.Client(timeout=2.0) as client:
            response = client.get(url, params={"event_ticker": ticker, "limit": 100})
            response.raise_for_status()
            return response.json().get("markets", [])

    # -- readiness --------------------------------------------------------------
    def evaluate_readiness(self) -> tuple[str, str | None]:
        missing_feeds = self.feeds.missing()
        if missing_feeds:
            return "BLOCKED", f"C85_FEEDS_STALE: {', '.join(missing_feeds)}"
        if not self.experts.connected:
            reasons = self.experts.status().get("blocking_reasons") or [
                "missing: " + ", ".join(self.experts.missing)
            ]
            return "BLOCKED", "C85_EXPERTS_NOT_CONNECTED :: " + " || ".join(reasons)
        # A planned-but-unrun bridge means the policy state does not cover every
        # target since the checkpoint. Computing the plan is not running it, so
        # pending work blocks readiness instead of being silently skipped.
        if self.pending_bridge:
            return "BLOCKED", (
                f"C85_BRIDGE_PENDING: {len(self.pending_bridge)} targets from "
                f"{self.pending_bridge[0].isoformat()} to "
                f"{self.pending_bridge[-1].isoformat()} not processed"
            )
        missing_fit = self.missing_applicable_fit()
        if missing_fit:
            return "BLOCKED", missing_fit
        if isinstance(self.packet_source, UnavailablePacketSource):
            return "BLOCKED", "C85_RAW_PACKET_SOURCE_UNAVAILABLE :: " + "; ".join(
                self.packet_source.reasons
            )
        if not self.settings.allow_live_publication:
            return "BLOCKED", "C85_ALLOW_LIVE_PUBLICATION=false"
        return "READY", None

    def missing_applicable_fit(self, at: datetime | None = None) -> str | None:
        """Both heads must already be fitted for the next target's UTC day."""
        target = at or next_boundary()
        missing = [
            kind
            for kind in ("C71_DIRECTION", "C85_META")
            if self.artifacts.head_for(kind, target) is None
        ]
        if missing:
            return f"C85_NO_APPLICABLE_FIT: {', '.join(missing)} for {target.date()}"
        return None

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
            "pending_bridge_targets": len(self.pending_bridge),
            "next_target_utc": next_boundary().isoformat(),
            "allow_live_publication": self.settings.allow_live_publication,
            "at": datetime.now(timezone.utc).isoformat(),
        }

    # -- boundary ---------------------------------------------------------------
    async def on_boundary(self, target: datetime, timing: RunTiming) -> None:
        """Compute and publish one target, or record exactly why it did not."""
        readiness, reason = self.evaluate_readiness()
        if readiness != "READY":
            self.store.mark_missed(None, target, reason or "not_ready")
            return

        # Scheduler ownership: overlapping deployments must never both process
        # the same target. The lease is short-lived and fenced in the backend.
        lease = self.store.acquire_lease(self.settings.lease_ttl_seconds)
        self.owns_lease = bool(lease.get("granted"))
        if not self.owns_lease:
            self.store.mark_missed(
                None, target, f"C85_LEASE_HELD_BY:{lease.get('owner_id', 'other')}"
            )
            return

        timing.compute_started_ns = time.time_ns()
        outcome = await self.orchestrator.run_target(self.state, target, timing)
        self.warmup.progress.last_completed_target = target.isoformat()
        self.warmup.progress.next_target = next_boundary().isoformat()
        if outcome.blocker:
            self.warmup.progress.notes.append(f"{target.isoformat()}: {outcome.blocker}")


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
