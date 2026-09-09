"""Live provider for the shared T0/T5 coverage-control precursor.

This is the first inherited ancestor computation that runs incrementally inside
the worker instead of as a whole-history batch. It wraps
`coverage_control.CoverageControlProducer` with durable state so one target can
be scored when its inputs arrive and a restart resumes on the next one.

Scope, stated honestly:

  * What it produces is the CONTROL branch of C30 — the `prediction_cov30` /
    `stage_cov30` columns of `c30_c70_lab_manager_r2_output/
    selected_shadow_ledger.csv`, plus the confidence scores and six rank series
    that C30, C36 and C37 all consume.
  * It is NOT the whole of C30. The selected C30 ledger also carries
    `selected_*_c70`, `selected_blend_*` (SELECTED_EXTERNAL_BLEND dual-score
    heads) and `selected_hot_*_f010` (the fee-0.10 hot calibration policy).
    Those are separately fitted heads that are not ported yet, so this provider
    is registered as a PRECURSOR and `c30` stays missing in the fail-closed
    registry. Registering it as `c30` would silently substitute one branch for
    the whole expert.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from . import ExpertCall, ExpertUnavailable
from .coverage_control import CoverageControlProducer, CoverageInputError

NAME = "coverage_control"
DEFAULT_STATE = "artifacts/coverage_control/state.json"


class CoverageControlProvider:
    """Durable, chronological, one-target coverage-control provider."""

    def __init__(self, state_path: Path | str | None = None) -> None:
        self.state_path = Path(
            state_path or os.environ.get("C85_COVERAGE_STATE_PATH", DEFAULT_STATE)
        )
        self.restored = False
        self.restore_error: str | None = None
        if self.state_path.exists():
            try:
                self.producer = CoverageControlProducer.restore(self.state_path)
                self.restored = True
            except Exception as exc:  # noqa: BLE001 - surfaced, never swallowed
                self.restore_error = f"{type(exc).__name__}: {exc}"
                self.producer = CoverageControlProducer()
        else:
            self.producer = CoverageControlProducer()
        self.last: dict[str, Any] | None = None

    # ------------------------------------------------------------------ run
    def observe(self, row: dict[str, Any], *, persist: bool = True) -> dict[str, Any]:
        """Score ONE chronological target and persist the advanced state."""

        scored = self.producer.observe(row)
        self.last = scored
        if persist:
            self.state_path.parent.mkdir(parents=True, exist_ok=True)
            self.producer.save(self.state_path)
        return scored

    def call(self, coverage_tag: str = "cov30") -> ExpertCall:
        """The control-branch call for the most recently observed target."""

        if self.last is None:
            raise ExpertUnavailable(
                "C85_COVERAGE_NO_TARGET: no target has been observed yet"
            )
        policy = self.last["policies"].get(coverage_tag)
        if policy is None:
            raise ExpertUnavailable(
                f"C85_COVERAGE_NO_POLICY: {coverage_tag!r} is not configured"
            )
        rank = self.last["t5_reliability_rank"]
        return ExpertCall(
            name=f"{NAME}:{coverage_tag}",
            prediction=int(policy["prediction"]),
            called=policy["stage"] != "ABSTAIN",
            rank=None if rank != rank else float(rank),  # NaN stays None
            probability_correct=None,
            available=True,
            detail={
                "ts": self.last["ts"],
                "stage": policy["stage"],
                "active_threshold": policy["active_threshold"],
                "opportunity": policy["opportunity"],
                "candidate_stage": self.last["candidate_stage"],
                "external_rank": self.last["external_rank"],
            },
        )

    # --------------------------------------------------------------- status
    def status(self) -> dict[str, Any]:
        controllers = {
            tag: {"threshold": c.threshold, "opportunities_seen": c.seen}
            for tag, c in self.producer.controllers.items()
        }
        return {
            "provider": NAME,
            "kind": "precursor",
            "produces": [
                "r2/r4 adjusted probability_correct",
                "reliability blend",
                "active direction margin",
                "six directional past-only rank series",
                "adaptive coverage policy (cov30 / cov70) == C30 control branch",
            ],
            "state_path": str(self.state_path),
            "state_restored": self.restored,
            "restore_error": self.restore_error,
            "cursor": self.producer.cursor,
            "targets_processed": self.producer.processed,
            "controllers": controllers,
            "not_covered": [
                "C30 SELECTED_EXTERNAL_BLEND dual-score heads",
                "C30 fee-0.10 hot calibration policy",
                "C36 timing / frontier selection",
                "C37 balanced maturation",
            ],
            "why_c30_still_missing": (
                "this is the control branch only; the C30 expert also needs its "
                "selected blend and hot-calibration heads before `c30` may be "
                "registered as a required expert"
            ),
        }


def install(registry: Any, state_path: Path | str | None = None) -> CoverageControlProvider:
    """Construct the provider and attach it to the registry as a precursor."""

    provider = CoverageControlProvider(state_path)
    register = getattr(registry, "register_precursor", None)
    if register is not None:
        register(NAME, provider)
    return provider


__all__ = [
    "CoverageControlProvider",
    "CoverageInputError",
    "install",
    "NAME",
]
