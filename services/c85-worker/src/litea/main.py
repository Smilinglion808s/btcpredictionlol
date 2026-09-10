"""Version 1 process entrypoint — `python -m src.litea.main`.

Deliberately a SEPARATE process path from `src.main`. It shares the feed
adapters, the boundary scheduler and the signed backend, and starts none of the
C85 ancestor chain, correctness model or auxiliary bundles. Old C85 readiness is
never consulted and never forced true.

There is no gateway client anywhere in this process. Execution is not "disabled
by configuration"; the code that could dispatch is simply not constructed.
"""
from __future__ import annotations

from .. import runtime_env  # noqa: F401  isort:skip

import asyncio
import os
from datetime import datetime, timezone
from pathlib import Path

import uvicorn

from ..backend import BackendClient
from ..config import load_settings
from ..feeds import FeedRegistry
from ..health import create_app
from ..packets import LivePacketSource
from ..scheduler import BoundaryScheduler, next_boundary
from ..tickers import KalshiTickerResolver
from .fit_service import run_due_fits
from .heads import DailyHeadStore
from .identity import MODEL_ID
from .state import LiteAState
from .store import LiteAStore, checkpoint_payload
from .training import TrainingFrame
from .worker import LiteAWorker


class LiteAService:
    def __init__(self) -> None:
        self.settings = load_settings()
        # The backend refuses any row whose model_version disagrees with the
        # signed envelope, so binding the identity here is what keeps Version 1
        # rows out of every C85 table partition.
        self.backend = BackendClient(
            self.settings.ops_url,
            self.settings.gateway_secret,
            self.settings.worker_id,
            model_version=MODEL_ID,
        )
        self.store = LiteAStore(self.backend, self.settings.worker_id)
        self.feeds = FeedRegistry(dict(os.environ))
        self.packets = LivePacketSource(feeds=self.feeds, experts=None, artifacts=None)
        self.ticker_resolver = KalshiTickerResolver(
            self.settings.kalshi_series, self._fetch_market_metadata
        )

        root = Path(os.environ.get("LITEA_STATE_DIR", "/var/lib/litea"))
        self.root = root
        self.heads = DailyHeadStore(root / "heads")
        self.state_path = root / "state.json"
        self.training_path = root / "training.parquet"
        # The container has no persistent volume: the private bucket is the
        # durability. Restore BEFORE reading any local file.
        self.remote = RemoteArtifacts(self.backend, root)
        self.restore_report = self._restore_artifacts()
        self.state = self._restore_state()
        self.training = (
            TrainingFrame.load(self.training_path)
            if self.training_path.exists()
            else TrainingFrame.empty()
        )

        self.worker = LiteAWorker(
            packet_source=self.packets,
            store=self.store,
            heads=self.heads,
            state=self.state,
            state_path=self.state_path,
            ticker_resolver=self.ticker_resolver,
            feeds=self.feeds,
            training=self.training,
            training_path=self.training_path,
            lease_ttl_seconds=self.settings.lease_ttl_seconds,
        )
        self.scheduler = BoundaryScheduler(self.worker.on_boundary)

    # -- startup ---------------------------------------------------------------
    def _restore_state(self) -> LiteAState:
        """Local snapshot first, then the durable backend checkpoint.

        A restore failure is never repaired by starting fresh: a blank state
        would re-warm the rank queues and reset the daily floor, which is a
        silent behaviour change. It raises.
        """
        if self.state_path.exists():
            return LiteAState.load(self.state_path)
        checkpoint = self.store.latest_checkpoint()
        if checkpoint and checkpoint.get("admission_rank_state"):
            envelope = {
                "state": {
                    "schema": 1,
                    "model_id": MODEL_ID,
                    "engine": checkpoint["admission_rank_state"],
                    "guard": checkpoint["deterioration_state"],
                    "cursors": checkpoint.get("cursors") or {},
                },
            }
            from .engine import digest

            envelope["sha256"] = digest(envelope["state"])
            return LiteAState.restore(envelope)
        return LiteAState()

    def _fetch_market_metadata(self, ticker: str) -> list[dict]:
        import httpx

        url = f"{self.settings.kalshi_api_base.rstrip('/')}/markets"
        response = httpx.get(url, params={"tickers": ticker}, timeout=3.0)
        response.raise_for_status()
        return response.json().get("markets", [])

    def _catch_up_fits(self) -> list[dict]:
        """Every due UTC-midnight fit, chronologically, off the timed path."""
        if not self.training_path.exists():
            return []
        training = TrainingFrame.load(self.training_path)
        results = run_due_fits(training, self.heads, after=self.state.cursors.last_fit_cutoff)
        if results:
            last = results[-1]
            self.state.cursors.last_fit_cutoff = last.cutoff
            self.state.cursors.last_fit_result = "FITTED" if last.fitted else (last.reason or "")
        self.state.cursors.training_sha256 = training.sha256
        self.state.cursors.training_rows = training.rows
        self.state.cursors.training_last_target = training.last_target
        self.state.save(self.state_path)
        return [r.__dict__ for r in results]

    # -- reporting -------------------------------------------------------------
    def snapshot(self) -> dict:
        report = self.worker.snapshot()
        report["stage"] = "SHADOW_LOGGING"
        report["training"] = {
            "rows": self.state.cursors.training_rows,
            "last_target": self.state.cursors.training_last_target,
            "sha256": self.state.cursors.training_sha256,
        }
        report["feeds"] = self.feeds.watermarks()
        report["build_sha"] = self.settings.build_sha
        return report

    # -- loops -----------------------------------------------------------------
    async def heartbeat_loop(self) -> None:
        while True:
            report = {}
            try:
                report = self.snapshot()
                armed = report["readiness"] == "LOGGING_READY"
                if armed and self.scheduler._task is None:  # noqa: SLF001
                    self.scheduler.start()
                elif not armed and self.scheduler._task is not None:  # noqa: SLF001
                    await self.scheduler.stop()
            except Exception:  # noqa: BLE001
                pass
            try:
                self.store.heartbeat(
                    readiness=report.get("readiness", "UNKNOWN"),
                    stage="SHADOW_LOGGING",
                    blocking_reason=report.get("blocking_reason"),
                    progress=report,
                    feed_freshness=self.feeds.watermarks(),
                    next_target_utc=next_boundary().isoformat(),
                    build_sha=self.settings.build_sha,
                )
            except Exception:  # noqa: BLE001
                pass
            await asyncio.sleep(self.settings.heartbeat_seconds)

    async def settlement_loop(self) -> None:
        while True:
            try:
                applied = self.worker.apply_settlements(self.store.pending_settlements())
                if applied:
                    # Local paired state first, then the durable checkpoint, so
                    # a crash in between replays settlements that the consumed
                    # cursor has already recorded — never double-counts them.
                    self.state.save(self.state_path)
                    self.backend.call(
                        "checkpoint.append",
                        checkpoint=checkpoint_payload(self.state, next_target=next_boundary()),
                    )
            except Exception:  # noqa: BLE001
                pass
            await asyncio.sleep(60)

    async def run(self) -> None:
        await self.feeds.start()
        self._catch_up_fits()

        status, reason = self.worker.evaluate_readiness()
        if status == "LOGGING_READY":
            self.scheduler.start()
        else:
            print(f"[{MODEL_ID}] not logging yet: {reason}", flush=True)

        asyncio.create_task(self.heartbeat_loop())
        asyncio.create_task(self.settlement_loop())

        config = uvicorn.Config(
            create_app(self.snapshot),
            host="0.0.0.0",
            port=int(os.environ.get("LITEA_HTTP_PORT", self.settings.http_port)),
            log_level="info",
        )
        await uvicorn.Server(config).serve()


def main() -> None:
    print(
        f"[{MODEL_ID}] starting at {datetime.now(timezone.utc).isoformat()} "
        "— execution HARD OFF, no gateway client is constructed",
        flush=True,
    )
    asyncio.run(LiteAService().run())


if __name__ == "__main__":
    main()
