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
from ..scheduler import BoundaryScheduler, next_boundary
from ..tickers import KalshiTickerResolver
from .fit_service import run_due_fits
from .heads import DailyHeadStore
from .identity import MODEL_ID
from .outcomes import OfficialOutcomes
from .remote import RemoteArtifacts
from .state import LiteAState
from .store import LiteAStore, checkpoint_payload
from .training import TrainingFrame
from .bridge import StartupBridge
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
        # Version 1 sources its own direction stage from the feed registry; the
        # shared C85 packet source is deliberately NOT constructed here — its
        # Kalshi stage needs a [T, T+5s) trade aggregate that only exists after
        # the deadline it feeds.
        self.ticker_resolver = KalshiTickerResolver(
            self.settings.kalshi_series,
            self._fetch_market_metadata,
            listed=self._listed_market,
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
        self.bridge = StartupBridge(self)
        # The only thing in this process that writes an official outcome.
        self.outcomes = OfficialOutcomes(self)

    # -- startup ---------------------------------------------------------------
    def _restore_artifacts(self) -> dict:
        """Install the durable training frame, heads and state, hash-checked.

        A required object that the manifest lists but the bucket cannot serve
        is a HARD failure: scoring cold from a partial restore would silently
        re-warm the rank queues and reset the daily floor.
        """
        return self.remote.restore()

    def _restore_state(self) -> LiteAState:
        """The NEWEST coherent position wins — never simply the local file.

        The bucket snapshot is only republished when a fit happens (daily), so
        it can be almost a day behind the signed decision checkpoints. Both
        candidates are restored through their own sealed digest, and the one
        whose committed position is later is adopted. Neither is ever repaired
        by starting fresh.
        """
        candidates: list[tuple[str, LiteAState]] = []
        if self.state_path.exists():
            candidates.append(("LOCAL_SNAPSHOT", LiteAState.load(self.state_path)))

        bucket = self.state_path.with_name("state.remote.json")
        if bucket.exists():
            candidates.append(("BUCKET_SNAPSHOT", LiteAState.load(bucket)))

        checkpoint = self.store.latest_checkpoint() or {}
        envelope = (checkpoint.get("expert_state") or {}).get("litea_paired_envelope")
        if envelope:
            candidates.append(("BACKEND_CHECKPOINT", LiteAState.restore(envelope)))
        elif checkpoint.get("admission_rank_state"):
            raise RuntimeError(
                "LITEA_CHECKPOINT_UNRESTORABLE: the latest durable checkpoint predates "
                "the sealed paired envelope; refusing to manufacture a state digest over "
                "reassembled parts"
            )

        def position(state: LiteAState) -> str:
            return str(state.cursors.last_committed_target or state.engine.last_target or "")

        chosen: LiteAState | None = None
        self.state_origin = "COLD_START"
        for origin, state in candidates:
            if chosen is None or position(state) > position(chosen):
                chosen, self.state_origin = state, origin

        if chosen is None:
            self.state_origin = "COLD_START"
            return LiteAState()
        chosen.save(self.state_path)
        return chosen


    def _fetch_market_metadata(self, ticker: str) -> list[dict]:
        import httpx

        url = f"{self.settings.kalshi_api_base.rstrip('/')}/markets"
        response = httpx.get(url, params={"tickers": ticker}, timeout=3.0)
        response.raise_for_status()
        return response.json().get("markets", [])

    def _listed_market(self, target_open: datetime) -> dict | None:
        """The contract the venue itself listed for this target, if received."""
        target_ms = int(target_open.timestamp() * 1000)
        return self.feeds.markets.markets.get(target_ms)

    def _catch_up_fits(self) -> list[dict]:
        """Every due UTC-midnight fit, chronologically, off the timed path.

        The cutoff to fit after is the LATEST HEAD that actually exists, not a
        cursor: a head that was fitted and then lost would otherwise never be
        refitted. A day with no available midnight opportunity simply has no
        head, and the previous head still expires.
        """
        training = self.worker.training
        if training.rows == 0:
            return []
        latest = self.heads.latest_cutoff()
        after = f"{latest}T00:00:00+00:00" if latest else self.state.cursors.last_fit_cutoff
        results = run_due_fits(training, self.heads, after=after)
        if results:
            last = results[-1]
            self.state.cursors.last_fit_cutoff = last.cutoff
            self.state.cursors.last_fit_result = "FITTED" if last.fitted else (last.reason or "")
        self.state.cursors.training_sha256 = training.sha256
        self.state.cursors.training_rows = training.rows
        self.state.cursors.training_last_target = training.last_target
        self.state.save(self.state_path)
        if results:
            try:
                self.remote.publish(
                    heads_root=self.root / "heads",
                    training=self.training_path,
                    state=self.state_path,
                )
            except Exception as exc:  # noqa: BLE001
                print(f"[{MODEL_ID}] head publish failed: {exc}", flush=True)
        return [r.__dict__ for r in results]

    async def fit_loop(self) -> None:
        """Keep the daily heads current for as long as the process lives."""
        while True:
            await asyncio.sleep(300)
            try:
                await asyncio.to_thread(self._catch_up_fits)
            except Exception as exc:  # noqa: BLE001
                print(f"[{MODEL_ID}] daily fit failed: {exc}", flush=True)

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
        report["artifact_restore"] = self.restore_report
        report["startup_bridge"] = self.bridge.report
        report["official_outcomes"] = self.outcomes.last_report
        report["build_sha"] = self.settings.build_sha
        return report

    # -- loops -----------------------------------------------------------------
    async def heartbeat_loop(self) -> None:
        while True:
            report = {}
            try:
                report = self.snapshot()
                # RECORDING_ONLY still arms the scheduler. Only a genuine
                # recording blocker disarms it.
                armed = report["readiness"] in ("LOGGING_READY", "RECORDING_ONLY")
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

    async def recovery_loop(self) -> None:
        """Drain undelivered decisions away from the boundary path.

        Delivery failures used to be retried only at the next boundary, which
        the same failure had already blocked. This loop is what makes a
        transport outage self-healing.
        """
        while True:
            await asyncio.sleep(30)
            try:
                outcome = await asyncio.to_thread(self.worker.reconcile_pending)
                if outcome and outcome.get("delivered"):
                    self.state.save(self.state_path)
            except Exception as exc:  # noqa: BLE001
                print(f"[{MODEL_ID}] pending retry failed: {exc}", flush=True)

    def drain_settlements(self) -> int:
        """Produce official outcomes, then apply every unconsumed one.

        Producing comes first: `settlements.pending` can only return what has
        actually been recorded, and nothing else in this process records an
        outcome.
        """
        try:
            self.outcomes.poll()
        except Exception as exc:  # noqa: BLE001 — retried on the next pass
            print(f"[{MODEL_ID}] outcome poll failed: {exc}", flush=True)
        applied = self.worker.apply_settlements(self.store.pending_settlements())
        if applied:
            self.state.save(self.state_path)
        return applied

    async def settlement_loop(self) -> None:
        while True:
            try:
                applied = await asyncio.to_thread(self.drain_settlements)
                if applied:
                    # Local paired state first, then the durable checkpoint, so
                    # a crash in between replays settlements that the consumed
                    # cursor has already recorded — never double-counts them.
                    self.state.save(self.state_path)
                    self.backend.call(
                        "checkpoint.append",
                        checkpoint=checkpoint_payload(self.state, next_target=next_boundary()),
                    )
                    # Newly known labels can make a due daily fit eligible.
                    await asyncio.to_thread(self._catch_up_fits)
            except Exception:  # noqa: BLE001
                pass
            await asyncio.sleep(60)

    async def run(self) -> None:
        # Feeds start FIRST and keep collecting while the gap is bridged, so
        # the next future boundary has real raw windows of its own.
        await self.feeds.start()

        # Outcomes that became official while this container was down are
        # applied BEFORE the gap is bridged, so the daily floor and the rank
        # queues advance through the missed intervals in the real order.
        try:
            await asyncio.to_thread(self.drain_settlements)
        except Exception as exc:  # noqa: BLE001
            print(f"[{MODEL_ID}] startup settlement drain failed: {exc}", flush=True)
        self._catch_up_fits()

        # Everything between the restored checkpoint and this launch is
        # recovered causally before the first scheduled target is scored. A gap
        # that cannot be recovered blocks scoring instead of vanishing. The
        # residual gap the bridge itself takes to run is bridged too, so the
        # scheduler never arms one interval behind.
        try:
            bridged = await asyncio.to_thread(self.bridge.run_until_current)
        except Exception as exc:  # noqa: BLE001
            bridged = {"status": "ERROR", "reason": f"{type(exc).__name__}: {exc}"}
            self.worker.external_scoring_block = (
                f"LITEA_STARTUP_BRIDGE_FAILED: {type(exc).__name__}"
            )
            self.bridge.report = bridged
        print(f"[{MODEL_ID}] startup bridge: {bridged}", flush=True)

        # A queued, undelivered bridge decision must drain before scoring.
        try:
            await asyncio.to_thread(self.worker.reconcile_pending)
            if not self.worker.pending_targets() and str(
                self.worker.external_scoring_block or ""
            ).startswith("LITEA_BRIDGE_COMMIT_UNDELIVERED"):
                self.worker.external_scoring_block = None
        except Exception as exc:  # noqa: BLE001
            print(f"[{MODEL_ID}] startup pending drain failed: {exc}", flush=True)

        status, reason = self.worker.evaluate_readiness()
        if status in ("LOGGING_READY", "RECORDING_ONLY"):
            self.scheduler.start()
            if reason:
                print(f"[{MODEL_ID}] recording without scoring: {reason}", flush=True)
        else:
            print(f"[{MODEL_ID}] not recording yet: {reason}", flush=True)

        asyncio.create_task(self.heartbeat_loop())
        asyncio.create_task(self.recovery_loop())
        asyncio.create_task(self.settlement_loop())
        asyncio.create_task(self.fit_loop())


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
