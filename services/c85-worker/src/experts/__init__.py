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

from .dependencies import report as _dependency_report

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


class ChainCommitError(RuntimeError):
    """The head advanced but the rank window did not; state is inconsistent.

    Raised only when a validated rank commit still fails, which cannot be
    undone in place. The caller must stop and restore the last checkpoint,
    where head and rank are one verified generation, rather than continue on a
    half-advanced pair.
    """


@dataclass
class ChainUpdate:
    """The pending state advance of one target, applied exactly once.

    Holds the prepared external leaf pair (which owns the positional rank
    window) and the long-context bootstrap (which owns the fitted head's staged
    advance). Both sides are VALIDATED first — version fences, replays,
    out-of-order keys — so the ordinary failure modes abort before anything
    moves. Only then does the head commit, then the rank window.
    """

    leaf_update: Any = None
    long_context: Any = None
    committed: bool = False
    rolled_back: bool = False

    def commit(self) -> None:
        if self.committed:
            return
        if self.rolled_back:
            raise RuntimeError("this chain update was rolled back and cannot commit")
        staged = None
        if self.long_context is not None:
            staged = getattr(self.long_context, "_staged", None)
            if staged is not None:
                staged.validate()
        if self.leaf_update is not None:
            self.leaf_update.validate()
        if self.long_context is not None:
            self.long_context.commit()
        if self.leaf_update is not None:
            try:
                self.leaf_update.commit()
            except Exception as exc:  # noqa: BLE001
                raise ChainCommitError(
                    "the long-context head advanced but the positional rank window "
                    f"refused ({type(exc).__name__}: {exc}); restore the last "
                    "checkpoint before processing another target"
                ) from exc
        self.committed = True

    def rollback(self) -> None:
        if self.committed:
            return
        if self.long_context is not None:
            self.long_context.rollback()
        self.leaf_update = None
        self.rolled_back = True




class LiveExpertChain:
    """The transcribed ancestor chain: leaves -> C42 -> C51 -> C54.

    Every stage is the ported original (``src/experts/leaf.py``, ``c42.py``,
    ``c51.py``, ``c54.py``). Each stage fails closed on its own missing
    inputs; nothing here substitutes, approximates or skips an ancestor.
    """

    def __init__(self, c51_fitted_state: Any | None = None, as_of: Any | None = None) -> None:
        from datetime import datetime, timezone

        from .c42 import C42Expert
        from .c51 import C51Expert
        from .c54 import C54Expert
        from .c51_state import C51StateStore
        from .leaf import LeafExperts

        self.leaf = LeafExperts()
        # The C85 RECONSTRUCTION long-context bootstrap, when the deployment
        # installed one. It carries the fitted head at its ABSOLUTE grid
        # position plus the complete positional rank queue, so `external_
        # direction` / `external_rank` are produced by the real head rather
        # than by a supplied probability. It is STALE by construction (fitted
        # through 2026-08-31, last observed target 2026-09-01T00:00Z) and
        # `long_context_readiness()` reports exactly how stale; attaching it
        # does NOT make the chain ready.
        from .long_context_serving import restore_from_env

        self.long_context: Any = None
        self.long_context_error: str | None = None
        try:
            self.long_context = restore_from_env()
        except Exception as exc:  # noqa: BLE001 - reported, never swallowed
            self.long_context_error = f"{type(exc).__name__}: {exc}"
        if self.long_context is not None:
            self.long_context.attach(self.leaf)

        self.c42 = C42Expert()
        self.c51 = C51Expert()
        self.c54 = C54Expert()
        # C51 has installed historical walk-forward states (245 direction /
        # 216 correctness fits, through 2026-08-31). Restore them instead of
        # claiming no fitted state exists; staleness is reported separately by
        # `c51_state_readiness()` and gates live use.
        self.c51_store: C51StateStore | None
        try:
            self.c51_store = C51StateStore()
        except Exception:  # states not installed in this deployment
            self.c51_store = None
        if c51_fitted_state is None and self.c51_store is not None:
            c51_fitted_state = self.c51_store.restore(as_of or datetime.now(timezone.utc))
        self.c51_fitted_state = c51_fitted_state

    def c51_state_readiness(self) -> dict[str, Any]:
        if self.c51_store is None:
            return {
                "ready": False,
                "blocking_reasons": ["C85_C51_STATES_NOT_INSTALLED: artifacts/c51 missing"],
            }
        return self.c51_store.readiness()

    def long_context_readiness(self, target_open: Any | None = None) -> dict[str, Any]:
        """Honest state of the reconstruction long-context leaf."""

        if self.long_context is None:
            return {
                "installed": False,
                "ready": False,
                "blocking_reasons": [
                    self.long_context_error
                    or "C85_LONG_CONTEXT_NOT_INSTALLED: set C85_LONG_CONTEXT_STATE_DIR "
                    "to the restored bootstrap checkpoint"
                ],
            }
        return {"installed": True, **self.long_context.readiness(target_open)}



    def prepare(self, packet: dict[str, Any]) -> tuple[dict[str, Any], "ChainUpdate"]:
        """Evaluate the chain WITHOUT advancing any persistent state.

        Two pieces of state move when a target is processed: the fitted
        long-context head (its trailing window, label map and fit schedule) and
        the positional rank window that turns the head's probability into
        `external_rank`. They describe the same series, so they must advance
        together or not at all. `evaluate` used to commit the rank window while
        the head advance stayed staged inside the bootstrap, which meant a
        boundary that failed after packet assembly left the two on different
        targets and the next restart could not tell which was authoritative.

        The caller therefore prepares here and commits the returned
        `ChainUpdate` in the same transaction that persists the decision.
        """

        leaves, leaf_update = self.leaf.prepare(packet)
        c42 = self.c42.evaluate(packet, leaves)
        c51_packet = dict(packet)
        c51_packet["fitted_state"] = self.c51_fitted_state
        c51 = self.c51.evaluate(c51_packet)
        c54 = self.c54.evaluate(
            packet,
            {
                "c42_prediction": c42["c42_prediction"],
                "c51_prediction": c51["c51_prediction"],
            },
        )
        update = ChainUpdate(leaf_update=leaf_update, long_context=self.long_context)
        return {**leaves, **c42, **c51, **c54}, update

    def evaluate(self, packet: dict[str, Any]) -> dict[str, Any]:
        """Produce every ancestor column the C85 feature frame consumes.

        Commits immediately; used by callers with nothing to roll back. The
        orchestrated boundary path uses :meth:`prepare` instead.
        """

        outputs, update = self.prepare(packet)
        update.commit()
        return outputs


    @staticmethod
    def blocking_reasons() -> list[str]:
        """Concrete, independently-verifiable blockers, one per dependency.

        Statuses come from `dependencies.py`, which distinguishes source that is
        available-but-unported from artifacts that are genuinely absent.
        """
        from .dependencies import blocking

        return [d.summary() for d in blocking()]


class ExpertRegistry:
    """Fail-closed registry. `connected` stays False until every ancestor runs."""

    def __init__(self) -> None:
        self._providers: dict[str, Any] = {}
        self.chain: LiveExpertChain | None = None

    def register(self, name: str, provider: Any) -> None:
        if name not in REQUIRED_EXPERTS:
            raise ValueError(f"unknown inherited expert {name!r}")
        self._providers[name] = provider

    @property
    def missing(self) -> list[str]:
        return [name for name in REQUIRED_EXPERTS if name not in self._providers]

    @property
    def connected(self) -> bool:
        # The chain is only usable when every stage can actually run: leaf
        # computations ported and fed, and the C51 walk-forward state current
        # (restored AND advanced to today). Ports alone are not enough, so this
        # stays False until those blockers clear.
        if self.missing or self.chain is None or self.chain.c51_fitted_state is None:
            return False
        return bool(self.chain.c51_state_readiness().get("ready"))

    def calls(self, target_open_ns: int) -> dict[str, ExpertCall]:
        if not self.connected:
            raise ExpertUnavailable(
                "C85_EXPERTS_NOT_CONNECTED: " + "; ".join(LiveExpertChain.blocking_reasons())
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
            "blocking_reasons": LiveExpertChain.blocking_reasons(),
            # Package-relative: `python -m src.main` puts the WORKER ROOT on
            # sys.path, not `src/`, so `__import__("experts.dependencies")`
            # raised ModuleNotFoundError in the real runtime while passing
            # under test-only sys.path hacks that insert `src/`.
            "dependencies": _dependency_report(),
            "ports_present": ["leaf", "c42", "c51", "c54"],
            "long_context": (
                self.chain.long_context_readiness()
                if self.chain is not None
                else {"installed": False, "ready": False,
                      "blocking_reasons": ["C85_CHAIN_NOT_CONSTRUCTED"]}
            ),
        }
