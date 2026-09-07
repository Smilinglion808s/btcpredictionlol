"""Inherited expert registry (C54, C42, C51, C30, C36, C37, R4, external).

STATUS: NOT CONNECTED — fails closed.

The C85 correctness head consumes these ancestors' live calls and rank features,
and the confirmed extension is driven by C54 specifically. Replacing any of them
with a constant, a generic technical indicator or a fresh vote changes C85, so
this registry reports each one as unavailable until its original definition is
transcribed and its own training protocol is running.

Each ancestor keeps its ORIGINAL target and regime rules, including Polymarket
and proxy dependencies where applicable. Retargeting them all to Kalshi is a
model change and is not permitted.

Recovered definitions (paths inside the handoff archives):

  C54  vault_work/legacy_lab4/BTC15M_LAB4_FRONTIER_2026-09-04/research_c54/
         build_c54_error_complementarity_router_r1.py
  C42  vault_work/legacy_c42/…/build_c42_maturation_consensus_r1.py
  C51  …/build_c51_target_native_rebase_r1.py  (+ acquire_c51_target_native_data_r1.py)
  C30  vault_work/legacy_c30/…
  C36  …/build_c36_*  (regime rules preserved)
  C37  vault_work/legacy_c37/…
  R4   …/reliability rank family (probability_correct + directional rank)
  external  external_direction / external_rank inputs

`structure_valid` is the inherited C75 -> C76 -> C79/C81 source-validation
result. It must be reproduced from source, including the completed-minute
history and finite-indicator checks. It is never pinned true, and imputation
never turns an invalid feed into a valid one.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

REQUIRED_EXPERTS = ("c54", "c42", "c51", "c30", "c36", "c37", "r4", "external")


class ExpertUnavailable(RuntimeError):
    """Raised when an inherited expert cannot produce a faithful call."""


@dataclass(frozen=True)
class ExpertCall:
    name: str
    prediction: int          # -1, 0, +1
    called: bool
    rank: float | None = None
    probability_correct: float | None = None
    available: bool = True
    detail: dict[str, Any] | None = None


class ExpertRegistry:
    """Fail-closed registry. `connected` stays False until every ancestor runs."""

    def __init__(self) -> None:
        self._providers: dict[str, Any] = {}

    def register(self, name: str, provider: Any) -> None:
        if name not in REQUIRED_EXPERTS:
            raise ValueError(f"unknown inherited expert {name!r}")
        self._providers[name] = provider

    @property
    def missing(self) -> list[str]:
        return [name for name in REQUIRED_EXPERTS if name not in self._providers]

    @property
    def connected(self) -> bool:
        return not self.missing

    def calls(self, target_open_ns: int) -> dict[str, ExpertCall]:
        if not self.connected:
            raise ExpertUnavailable(
                "C85_EXPERTS_NOT_CONNECTED: " + ", ".join(self.missing)
            )
        return {name: self._providers[name](target_open_ns) for name in REQUIRED_EXPERTS}

    def structure_valid(self, target_open_ns: int) -> bool:
        raise ExpertUnavailable(
            "C85_STRUCTURE_VALIDATION_NOT_PORTED: reproduce the inherited "
            "C75->C76->C79/C81 source validation from the recovered source; it must "
            "never be pinned true."
        )

    def status(self) -> dict[str, Any]:
        return {
            "connected": self.connected,
            "required": list(REQUIRED_EXPERTS),
            "missing": self.missing,
        }
