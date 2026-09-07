"""Durable persistence for the C85 worker (Lovable Cloud / Supabase, service role).

Nanoseconds are written as 64-bit integers, and every nullable numeric is written
as JSON null — never 0, never NaN — so the source's missing-value semantics
survive the round trip.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import Client, create_client

from .config import MODEL_VERSION
from .engine import Decision
from .state import C85State


def _num(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _iso(dt: datetime | None) -> str | None:
    return None if dt is None else dt.astimezone(timezone.utc).isoformat()


class C85Store:
    def __init__(self, url: str, service_key: str, worker_id: str) -> None:
        self.client: Client = create_client(url, service_key)
        self.worker_id = worker_id

    # -- checkpoints -----------------------------------------------------------
    def latest_checkpoint(self) -> dict[str, Any] | None:
        res = (
            self.client.table("c85_state_checkpoints")
            .select("*")
            .eq("model_version", MODEL_VERSION)
            .order("checkpoint_seq", desc=True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0] if rows else None

    def save_checkpoint(self, state: C85State, stage: str) -> int:
        """Append a monotonic, hashed checkpoint. Never overwrites an earlier one."""
        latest = self.latest_checkpoint()
        seq = (int(latest["checkpoint_seq"]) + 1) if latest else 1
        parent = latest["state_sha256"] if latest else None
        state.checkpoint_seq = seq
        state.parent_sha256 = parent
        payload = state.to_dict()
        row = {
            "model_version": MODEL_VERSION,
            "checkpoint_seq": seq,
            "as_of_utc": datetime.now(timezone.utc).isoformat(),
            "last_processed_target_utc": state.last_processed_target_utc,
            "next_target_utc": state.next_target_utc,
            "stage": stage,
            "admission_rank_state": payload["admission_rank_state"],
            "filter_rank_state": payload["filter_rank_state"],
            "deterioration_state": payload["deterioration_state"],
            "pending_base_calls": list(state.deterioration.pending.keys()),
            "consumed_settlements": state.deterioration.consumed[-5000:],
            "expert_state": state.expert_state,
            "applicable_fits": state.applicable_fits,
            "source_watermarks": state.source_watermarks,
            "state_sha256": state.sha256(),
            "parent_sha256": parent,
        }
        self.client.table("c85_state_checkpoints").insert(row).execute()
        return seq

    def restore_state(self) -> tuple[C85State, dict[str, Any] | None]:
        row = self.latest_checkpoint()
        if row is None:
            return C85State(), None
        return C85State.from_dict(row), row

    # -- targets ---------------------------------------------------------------
    def upsert_target(self, decision: Decision, *, published: bool) -> dict[str, Any]:
        """Write exactly one logical row per (model_version, ticker, target).

        Called for abstentions, invalid input and missed deadlines too, so the
        grid is never silently sparse.
        """
        open_utc = decision.target_open.astimezone(timezone.utc)
        timing = decision.timing
        row: dict[str, Any] = {
            "model_version": MODEL_VERSION,
            "ticker": decision.ticker,
            "target_open_utc": open_utc.isoformat(),
            "deadline_utc": (open_utc + timedelta(seconds=5)).isoformat(),
            "run_mode": decision.run_mode,
            "status": decision.status,
            "status_reason": decision.status_reason,
            "binance_complete": decision.validity.get("binance_complete"),
            "anchor_valid": decision.validity.get("anchor_valid"),
            "cm_valid": decision.validity.get("cm_valid"),
            "auxiliary_valid": decision.validity.get("auxiliary_valid"),
            "source_ok": decision.validity.get("source_ok"),
            "core_valid": decision.validity.get("core_valid"),
            "structure_valid": decision.validity.get("structure_valid"),
            "market_q1": decision.validity.get("market_q1"),
            "probability_yes": _num(decision.probability_yes),
            "proposal": decision.proposal,
            "probability_correct": _num(decision.probability_correct),
            "aux_long_logit": _num(decision.features.get("LONG_logit")),
            "aux_long_logscale": _num(decision.features.get("LONG_logscale")),
            "aux_recent_logit": _num(decision.features.get("RECENT_logit")),
            "aux_recent_logscale": _num(decision.features.get("RECENT_logscale")),
            "admission_rank": _num(decision.admission_rank),
            "admission_rank_count": decision.admission_rank_count,
            "filter_rank": _num(decision.filter_rank),
            "filter_rank_count": decision.filter_rank_count,
            "core_side": decision.core_side,
            "extension": decision.extension,
            "last_yes_price": _num(decision.last_yes_price),
            "base_side": decision.base_side,
            "weak": decision.weak,
            "deterioration_ewma16": _num(decision.deterioration.get("ewma16")),
            "deterioration_ewma128": _num(decision.deterioration.get("ewma128")),
            "deterioration_settled_count": decision.deterioration.get("count"),
            "deterioration_warmup": decision.deterioration.get("warm"),
            "final_side": decision.final_side,
            "gate_reasons": decision.gate_reasons,
            "consumed_state_cutoff_ns": decision.deterioration.get("latest_available_ns"),
            "direction_fit_id": decision.fits.get("direction_fit_id"),
            "meta_fit_id": decision.fits.get("meta_fit_id"),
            "aux_fit_month": decision.fits.get("aux_fit_month"),
            "feature_order_sha256": decision.fits.get("feature_order_sha256"),
            "features": decision.features or None,
            "source_ids": timing.get("source_ids"),
            "source_hash": timing.get("source_hash"),
            "target_open_ns": timing.get("target_open_ns"),
            "packet_freeze_ns": timing.get("packet_freeze_ns"),
            "last_event_ns": timing.get("last_event_ns"),
            "last_receipt_ns": timing.get("last_receipt_ns"),
            "feed_watermarks": timing.get("feed_watermarks"),
            "compute_started_ns": timing.get("compute_started_ns"),
            "compute_complete_ns": timing.get("compute_complete_ns"),
            "decision_durable_ns": timing.get("decision_durable_ns"),
            "dispatch_ns": timing.get("dispatch_ns"),
            "publication_offset_ms": _num(timing.get("publication_offset_ms")),
            "deadline_met": timing.get("deadline_met"),
        }
        if published:
            row["published_at"] = datetime.now(timezone.utc).isoformat()
        res = (
            self.client.table("c85_targets")
            .upsert(row, on_conflict="model_version,ticker,target_open_utc")
            .execute()
        )
        return (res.data or [{}])[0]

    def mark_missed(self, ticker: str, target_open: datetime, reason: str) -> None:
        """An expired target becomes an explicit row and never a catch-up webhook."""
        open_utc = target_open.astimezone(timezone.utc)
        self.client.table("c85_targets").upsert(
            {
                "model_version": MODEL_VERSION,
                "ticker": ticker,
                "target_open_utc": open_utc.isoformat(),
                "deadline_utc": (open_utc + timedelta(seconds=5)).isoformat(),
                "run_mode": "LIVE",
                "status": "MISSED",
                "status_reason": reason,
                "final_side": 0,
                "deadline_met": False,
            },
            on_conflict="model_version,ticker,target_open_utc",
        ).execute()

    # -- settlements -----------------------------------------------------------
    def record_settlement(self, **kwargs: Any) -> None:
        self.client.table("c85_settlements").upsert(
            {"model_version": MODEL_VERSION, **kwargs},
            on_conflict="model_version,ticker,target_open_utc,settlement_source",
        ).execute()

    def unconsumed_settlements(self, since: datetime | None = None) -> list[dict[str, Any]]:
        query = (
            self.client.table("c85_settlements")
            .select("*")
            .eq("model_version", MODEL_VERSION)
            .is_("consumed_by_deterioration_at", "null")
            .order("settlement_ts")
        )
        if since is not None:
            query = query.gte("settlement_ts", _iso(since))
        return (query.execute().data) or []

    # -- outbox ----------------------------------------------------------------
    def enqueue_outbox(self, target_id: str, dedupe_key: str, payload: dict[str, Any],
                       expires_at: datetime) -> dict[str, Any] | None:
        res = (
            self.client.table("c85_outbox")
            .upsert(
                {
                    "dedupe_key": dedupe_key,
                    "target_id": target_id,
                    "payload": payload,
                    "state": "PENDING",
                    "expires_at": _iso(expires_at),
                },
                on_conflict="dedupe_key",
                ignore_duplicates=True,
            )
            .execute()
        )
        rows = res.data or []
        return rows[0] if rows else None

    # -- health ----------------------------------------------------------------
    def heartbeat(self, **fields: Any) -> None:
        self.client.table("c85_worker_health").upsert(
            {
                "model_version": MODEL_VERSION,
                "worker_id": self.worker_id,
                "last_heartbeat_at": datetime.now(timezone.utc).isoformat(),
                **fields,
            },
            on_conflict="model_version,worker_id",
        ).execute()
