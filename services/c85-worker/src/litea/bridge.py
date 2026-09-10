"""Startup bridge: causally process the targets between the restored
checkpoint and the moment this container actually starts.

Without this, a restart silently skipped every 15-minute opportunity between
the last durable checkpoint and launch: the raw-60 -> rank -> guard history
would jump a gap, the confidence rank window would contain a hole and the daily
floor would never see the exposure those intervals carried.

What it does, in order, per UTC day of the gap:

  1. recover the missed targets from the public venue with the unchanged
     60-feature recipe (`reconstruct.recover_targets`) — a short windowed read,
     never a reload of the historical frame;
  2. append them to the rolling training frame with their OFFICIAL Kalshi label
     when the market has already settled, unlabelled otherwise;
  3. run the daily fits that are now due, chronologically, before any target of
     the following day is scored;
  4. advance the paired engine + guard through the recovered targets in
     observed-time order, interleaving official settlements exactly where they
     became available, and commit each decision durably as `RESEARCH` (recovered
     after the fact, never presented as a live forward prediction);
  5. persist the training frame, the paired state and the real cursor, and
     publish them to the private bucket.

Two safety rules:

  * a target whose sources are incomplete is still RECORDED with
    `input_valid=False` — the opportunity never vanishes;
  * if the source itself cannot be read at all, or the gap is too large to
    bridge honestly, the bridge records the explicit gap and BLOCKS scoring.
    Recording of forward inputs continues; the model does not claim to be
    scoring-ready over a hole.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd

from ..features import DIRECTION_ORDER
from .fit_service import run_due_fits
from .heads import HeadUnavailable
from .identity import MODEL_ID
from .reconstruct import RecoveryUnavailable, recover_targets
from .store import checkpoint_payload, target_row

INTERVAL = timedelta(minutes=15)
#: The venue needs a moment to publish the last trades of a window; a target is
#: only treated as recoverable once it is comfortably complete.
SETTLE_MARGIN = timedelta(seconds=120)
#: A gap larger than this is not bridged silently. Seven days of 15-minute
#: opportunities; beyond that a human decides.
MAX_BRIDGE_TARGETS = 672
#: Recovered in small runs so one venue hiccup cannot lose the whole bridge.
CHUNK = 24


@dataclass
class RecoveredPacket:
    """The `target_row` packet contract, for an after-the-fact recovery."""

    input_valid: bool
    features: dict[str, Any]
    direction60: dict[str, Any]
    blockers: str | None
    source: dict[str, Any] = field(default_factory=dict)

    def as_engine_features(self) -> dict[str, Any]:
        return dict(self.direction60)


def _floor(moment: datetime) -> datetime:
    moment = moment.astimezone(timezone.utc)
    return moment.replace(
        minute=(moment.minute // 15) * 15, second=0, microsecond=0
    )


def last_available_target(now: datetime | None = None) -> datetime:
    """The most recent target whose own [T, T+5s) window is fully observable."""
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return _floor(now - SETTLE_MARGIN)


class StartupBridge:
    def __init__(self, service: Any) -> None:
        self.service = service
        self.report: dict[str, Any] = {"status": "NOT_RUN"}
        self._pending: list[dict] = []

    # -- planning --------------------------------------------------------------
    def _resume_from(self) -> tuple[datetime | None, datetime | None]:
        """(training position, decided position) — they can disagree.

        A restored backend checkpoint is normally NEWER than the bucket's
        training snapshot, because the snapshot is only republished on a daily
        fit. Deciding on top of an older frame would pair a new rank state with
        a stale history, so targets between the two are rebuilt for the frame
        ONLY and are never re-decided.
        """
        training_last = self.service.training.last_target
        decided = self.service.state.engine.last_target
        return (
            pd.Timestamp(training_last).to_pydatetime() if training_last else None,
            pd.Timestamp(decided).to_pydatetime() if decided else None,
        )

    def plan(self, now: datetime | None = None) -> dict[str, Any]:
        training_at, decided_at = self._resume_from()
        end = last_available_target(now)
        # The EARLIER of the two: a training frame behind a newer checkpoint is
        # rebuilt for the frame only, so a new rank state is never paired with a
        # stale history. Targets at or before the decided position are not re-decided.
        start = min([t for t in (training_at, decided_at) if t is not None], default=None)
        if start is None:
            return {
                "status": "NO_POSITION",
                "reason": "LITEA_NO_RESTORED_POSITION: nothing to bridge from",
                "targets": [],
            }
        targets: list[datetime] = []
        cursor = start + INTERVAL
        while cursor <= end:
            targets.append(cursor)
            cursor += INTERVAL
        return {
            "status": "PLANNED",
            "training_last_target": training_at.isoformat() if training_at else None,
            "decided_last_target": decided_at.isoformat() if decided_at else None,
            "bridge_from": (start + INTERVAL).isoformat(),
            "bridge_to": end.isoformat(),
            "targets": targets,
        }

    def _frame_rows(self, targets: list[datetime]) -> dict[str, dict]:
        """Targets whose authentic inputs are already in the local frame.

        A previous bridge pass can record a target and then stop before the
        decision (a venue refusal further down the chunk list, a restart). The
        inputs are the frozen ones this identity already reconstructed, so the
        second pass decides from them instead of asking the venue again.
        """
        frame = getattr(getattr(self.service, "training", None), "frame", None)
        if frame is None or frame.empty or not targets:
            return {}
        wanted = {pd.Timestamp(t).tz_convert("UTC").isoformat() for t in targets}
        out: dict[str, dict] = {}
        for row in frame.to_dict("records"):
            stamp = pd.Timestamp(row["ts"])
            if stamp.tzinfo is None:
                stamp = stamp.tz_localize("UTC")
            key = stamp.tz_convert("UTC").isoformat()
            if key not in wanted:
                continue
            built = dict(row)
            built["ts"] = stamp.tz_convert("UTC")
            built.setdefault("blockers", None)
            out[key] = built
        return out

    # -- already-recorded rows --------------------------------------------------
    def _recorded_rows(self, targets: list[datetime]) -> dict[str, dict]:
        """The rows this identity ALREADY committed, keyed by target ISO.

        A frame that lags a newer checkpoint must be repaired from the inputs
        that were actually frozen at each target. Rebuilding them from a public
        read taken hours later can produce different numbers for a target the
        engine has already decided on, which would pair a new rank state with a
        history that never happened.
        """
        if not targets:
            return {}
        store = getattr(self.service, "store", None)
        if store is None or not hasattr(store, "recorded_targets"):
            return {}
        try:
            rows = store.recorded_targets(targets[0], targets[-1], limit=MAX_BRIDGE_TARGETS + 8)
        except Exception as exc:  # noqa: BLE001 — fall back to recovery
            print(f"[{MODEL_ID}] recorded-row read failed: {exc}", flush=True)
            return {}

        wanted = {pd.Timestamp(t).tz_convert("UTC").isoformat() for t in targets}
        out: dict[str, dict] = {}
        for row in rows:
            stamp = pd.Timestamp(row.get("target_open_utc"))
            if stamp.tzinfo is None:
                stamp = stamp.tz_localize("UTC")
            stamp = stamp.tz_convert("UTC")
            if stamp.isoformat() not in wanted:
                continue
            features = ((row.get("features") or {}).get("direction60")) or {}
            if not features:
                continue  # nothing frozen was stored; treat as unrecorded
            built = {
                "ts": stamp,
                "ticker": row.get("ticker"),
                "input_valid": bool(row.get("binance_complete")),
                "label": float("nan"),
                "settlement_ts": pd.NaT,
                "blockers": None,
            }
            for name in DIRECTION_ORDER:
                value = features.get(name)
                built[name] = float("nan") if value is None else float(value)
            out[stamp.isoformat()] = built
        return out

    # -- execution -------------------------------------------------------------
    def run(self, now: datetime | None = None) -> dict[str, Any]:
        plan = self.plan(now)
        targets: list[datetime] = plan.get("targets") or []
        if plan["status"] != "PLANNED":
            self.report = {**plan, "targets": 0}
            return self.report
        if not targets:
            self.report = {
                "status": "CURRENT",
                "bridge_to": plan["bridge_to"],
                "targets": 0,
                "decided": 0,
            }
            return self.report
        if len(targets) > MAX_BRIDGE_TARGETS:
            reason = (
                f"LITEA_GAP_TOO_LARGE: {len(targets)} missed 15-minute targets between "
                f"{plan['bridge_from']} and {plan['bridge_to']} exceeds the {MAX_BRIDGE_TARGETS} "
                "the startup bridge will recover automatically"
            )
            self._block(reason)
            self.report = {**{k: v for k, v in plan.items() if k != "targets"},
                           "status": "BLOCKED", "reason": reason, "targets": len(targets)}
            return self.report

        decided_at = plan["decided_last_target"]
        decided_after = pd.Timestamp(decided_at) if decided_at else None

        # Targets at or before the decided position are FRAME REPAIR only. Their
        # authentic frozen inputs are read back from the durable ledger; only a
        # genuinely unrecorded target is reconstructed from the public venue.
        settled = [t for t in targets
                   if decided_after is not None and pd.Timestamp(t) <= decided_after]
        recorded = self._recorded_rows(settled)
        # A target this process already reconstructed and wrote into the local
        # frame is not fetched again: those are the same authentic inputs, and
        # re-reading the venue for them is what turns a transient rate-limit
        # refusal into a bridge that can never finish.
        recorded.update(
            {
                key: row
                for key, row in self._frame_rows(targets).items()
                if key not in recorded
            }
        )
        reused = [recorded[pd.Timestamp(t).tz_convert("UTC").isoformat()]
                  for t in targets
                  if pd.Timestamp(t).tz_convert("UTC").isoformat() in recorded]
        to_recover = [t for t in targets
                      if pd.Timestamp(t).tz_convert("UTC").isoformat() not in recorded]

        recovered: list[dict] = list(reused)
        gap: str | None = None
        for index in range(0, len(to_recover), CHUNK):
            chunk = to_recover[index:index + CHUNK]
            try:
                recovered.extend(recover_targets(chunk))
            except Exception as exc:  # noqa: BLE001
                gap = (
                    f"LITEA_SOURCE_GAP: {chunk[0].isoformat()}..{chunk[-1].isoformat()} "
                    f"could not be recovered ({type(exc).__name__}: {str(exc)[:160]})"
                )
                break

        decisions: list[dict] = []
        committed = 0
        undelivered: list[str] = []
        if recovered:
            decisions, committed, undelivered = self._apply(recovered, decided_after)

        if undelivered and not gap:
            gap = (
                f"LITEA_BRIDGE_COMMIT_UNDELIVERED: {len(undelivered)} recovered decision(s) "
                f"from {undelivered[0]} are queued but not durable"
            )

        report = {
            "status": "BLOCKED" if gap else "BRIDGED",
            "bridge_from": plan["bridge_from"],
            "bridge_to": plan["bridge_to"],
            "targets": len(targets),
            "recovered": len(recovered),
            "reused_recorded": len(reused),
            "recorded_only": max(0, len(recovered) - len(decisions)),
            "decided": len(decisions),
            "committed": committed,
            "undelivered": len(undelivered),
            "calls": sum(1 for d in decisions if d["floor_prediction"] != 0),
            "input_unavailable": sum(1 for r in recovered if not r["input_valid"]),
            "labelled": sum(1 for r in recovered if pd.notna(r["label"])),
            "training_rows": self.service.training.rows,
            "training_last_target": self.service.training.last_target,
            "last_committed_target": self.service.state.cursors.last_committed_target,
            "state_sha256": self.service.state.snapshot()["sha256"],
            "gap": gap,
        }
        if gap:
            self._block(gap)
        self.report = report
        return report

    def run_until_current(self, now: datetime | None = None, passes: int = 3) -> dict[str, Any]:
        """Bridge, then bridge the residual gap the bridge itself took to run.

        Recovering hundreds of targets can cross a 15-minute boundary; without
        this the freshly armed scheduler would start one interval behind and
        that interval would silently vanish.
        """
        report = self.run(now)
        for _ in range(passes - 1):
            if report.get("status") not in ("BRIDGED",):
                break
            follow_up = self.plan(None if now is None else now)
            if not (follow_up.get("targets") or []):
                break
            report = self.run(None if now is None else now)
        return report

    def _block(self, reason: str) -> None:
        """Record the gap and stop scoring. Recording keeps running."""
        self.service.worker.external_scoring_block = reason
        print(f"[{MODEL_ID}] startup bridge blocked scoring: {reason}", flush=True)

    # -- the causal pass -------------------------------------------------------
    def _apply(
        self, recovered: list[dict], decided_after: pd.Timestamp | None
    ) -> tuple[list[dict], int, list[str]]:
        service = self.service
        state, training, heads = service.state, service.training, service.heads
        frame = pd.DataFrame(recovered).sort_values("ts")

        decisions: list[dict] = []
        committed = 0
        undelivered: list[str] = []
        for _, day_rows in frame.groupby(frame.ts.dt.date, sort=True):
            training.append(day_rows.drop(columns=["blockers"], errors="ignore")
                            .to_dict("records"))
            service._catch_up_fits()  # noqa: SLF001 — the day's due fit, before scoring it

            for row in day_rows.to_dict("records"):
                if decided_after is not None and row["ts"] <= decided_after:
                    continue  # frame-only reconciliation; already decided
                outcome = self._decide(row)
                decisions.append(outcome["decision"])
                committed += int(outcome["committed"])
                if not outcome["committed"]:
                    undelivered.append(pd.Timestamp(row["ts"]).isoformat())

        state.cursors.training_sha256 = training.save(service.training_path)
        state.cursors.training_rows = training.rows
        state.cursors.training_last_target = training.last_target
        state.save(service.state_path)
        try:
            service.remote.publish(
                heads_root=service.root / "heads",
                training=service.training_path,
                state=service.state_path,
            )
        except Exception as exc:  # noqa: BLE001 — local position is already durable
            print(f"[{MODEL_ID}] bridge publish failed: {exc}", flush=True)
        return decisions, committed, undelivered

    def _decide(self, row: dict) -> dict[str, Any]:
        state, heads = self.service.state, self.service.heads
        target = pd.Timestamp(row["ts"]).to_pydatetime()
        observed = target + timedelta(seconds=5)

        # An official settlement that became available BEFORE this target is
        # applied first, so the daily floor sees the exposure in real order.
        self._settle_due(observed)

        try:
            head = heads.head_for(target)
        except HeadUnavailable:
            head = None

        features = {name: row.get(name) for name in DIRECTION_ORDER}
        engine_output = state.engine.decide(
            target=target,
            ticker=row["ticker"],
            features=features,
            input_valid=bool(row["input_valid"]),
            head=head,
            observed_at=observed,
        )
        guard_output = state.guard.decide(
            target=target,
            ticker=row["ticker"],
            candidate=int(engine_output["candidate"]),
            rank=engine_output["rank"],
            observed_at=observed,
        )

        packet = RecoveredPacket(
            input_valid=bool(row["input_valid"]),
            features={"anchor_valid": bool(row["input_valid"])},
            direction60=features,
            blockers=row.get("blockers"),
            source={"feed_watermarks": {}, "recovery": "PUBLIC_VENUE_REST"},
        )
        payload = target_row(
            target_open=target,
            ticker=row["ticker"],
            engine_output=engine_output,
            guard_output=guard_output,
            packet=packet,
            timing={
                "target_open_ns": int(target.timestamp() * 1_000_000_000),
                "deadline_met": False,
            },
            run_mode="RESEARCH",
        )
        payload["status_reason"] = " -> ".join(
            filter(None, [payload.get("status_reason"), "STARTUP_BRIDGE_RECOVERED"])
        )

        # The decision is queued for durable delivery BEFORE the cursor moves.
        # A failed commit used to advance `last_committed_target` and then be
        # swallowed, so a row that never reached the ledger looked committed.
        # It now goes through the worker's own retry queue and the cursor only
        # follows a genuine acknowledgement.
        state.save(self.service.state_path)
        checkpoint = checkpoint_payload(state, next_target=target + INTERVAL)
        worker = self.service.worker
        outcome = worker._commit(payload, checkpoint)  # noqa: SLF001 — same package
        ok = bool(outcome.get("ok"))
        if ok:
            state.cursors.last_committed_target = target.isoformat()
            state.save(self.service.state_path)
        else:
            print(
                f"[{MODEL_ID}] bridge commit queued (not durable) at {target}: "
                f"{outcome.get('error')}",
                flush=True,
            )

        # The recovered settlement, if it is already official, lands right after
        # its own target so the floor's day arithmetic matches a live run.
        self._remember_settlement(row)
        return {
            "committed": ok,
            "decision": {
                **engine_output,
                "floor_reason": guard_output["reason"],
                "floor_prediction": guard_output["prediction"],
                "exception": guard_output.get("exception"),
            },
        }

    # -- settlement interleaving ----------------------------------------------
    def _remember_settlement(self, row: dict) -> None:
        if pd.notna(row.get("label")) and pd.notna(row.get("settlement_ts")):
            self._pending.append(row)

    def _settle_due(self, before: datetime) -> None:
        state = self.service.state
        consumed = set(state.cursors.consumed_settlements)
        remaining: list[dict] = []
        for row in sorted(self._pending, key=lambda r: r["settlement_ts"]):
            available = pd.Timestamp(row["settlement_ts"]).to_pydatetime()
            if available > before:
                remaining.append(row)
                continue
            key = f"{row['ticker']}@{pd.Timestamp(row['ts']).isoformat()}"
            if key in consumed:
                continue
            label = int(row["label"])
            state.engine.settle(
                row["ticker"], label, available_at=available, observed_at=available
            )
            state.guard.settle(
                row["ticker"], label, available_at=available, observed_at=available
            )
            self.service.training.apply_label(row["ts"], label, available)
            consumed.add(key)
        self._pending = remaining
        state.cursors.consumed_settlements = sorted(consumed)
