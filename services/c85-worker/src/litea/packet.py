"""Direction-only packet production for Version 1.

Version 1 needs the 60 direction inputs and nothing else, and it sources them
through its OWN stage (`litea.stage.V1DirectionStage`) rather than the shared
C85 direction stage.

The reason is a real timing conflict, not a preference: the shared stage takes
the target's `floor_strike` out of the Kalshi `[T, T+5s)` TRADE aggregate, and
that aggregate can only be requested AFTER T+5s — the very deadline it feeds.
A live Version 1 boundary could therefore never build a packet. Version 1 uses
neither `market_q1` nor `last_yes_price`; it needs the strike, which the venue
publishes with the LISTED contract well before T. The V1 stage reads that
listed record and leaves the quote aggregate to the model that actually uses it.

The `[T, T+5s)` window is used in full: the packet is frozen at the model's own
input cutoff, and the actual freeze/receipt instants are recorded as measured.
Nothing is backdated, and no missing source is substituted.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from ..features import DIRECTION_ORDER
from .stage import REQUIRED_FEEDS, V1DirectionStage

NS = 1_000_000_000

__all__ = ["Direction60Packet", "Direction60Source", "REQUIRED_FEEDS"]


@dataclass
class Direction60Packet:
    """One target's Version 1 inputs, with honest availability."""

    target_open: datetime
    ticker: str | None
    features: dict[str, float | None]
    input_valid: bool
    blockers: list[str] = field(default_factory=list)
    source: dict[str, Any] = field(default_factory=dict)
    market: dict[str, Any] | None = None
    strike_policy: dict[str, Any] | None = None

    @property
    def feature_window_end(self) -> datetime:
        return self.target_open + timedelta(seconds=5)

    def as_engine_features(self) -> dict[str, float | None]:
        """Exactly the 60 named columns; missing/non-finite become None.

        The head's own fitted median imputation then applies, which is the
        original behaviour. Nothing is substituted here.
        """
        out: dict[str, float | None] = {}
        for name in DIRECTION_ORDER:
            value = self.features.get(name)
            if value is None:
                out[name] = None
                continue
            try:
                number = float(value)
            except (TypeError, ValueError):
                out[name] = None
                continue
            out[name] = number if math.isfinite(number) else None
        return out


class Direction60Source:
    """Adapts the Version 1 stage to the Version 1 packet contract."""

    def __init__(self, feeds: Any) -> None:
        self.stage = V1DirectionStage(feeds)

    def build(
        self,
        target_open: datetime,
        cutoff_ns: int,
        freeze_ns: int | None = None,
        ticker: str | None = None,
    ) -> Direction60Packet:
        stage = self.stage.build(target_open, cutoff_ns, freeze_ns)
        features = dict(stage.direction_features or {})
        blockers = list(stage.reasons)

        missing = [name for name in DIRECTION_ORDER if name not in features]
        if missing and not blockers:
            blockers.append(
                "LITEA_DIRECTION_COLUMNS_MISSING: " + ", ".join(missing[:8])
            )

        receipts = [
            int(w["last_receipt_ns"])
            for w in stage.watermarks.values()
            if isinstance(w, dict) and w.get("last_receipt_ns") not in (None, "-1")
        ]
        source = {
            "mode": "live",
            "model": "litea-v1",
            "target_open_ns": stage.target_ns,
            "event_window_end_ns": stage.cutoff_ns,
            "deadline_ns": stage.cutoff_ns,
            "freeze_ns": stage.freeze_ns,
            "late_by_ns": max(0, stage.freeze_ns - stage.cutoff_ns),
            "on_time": stage.freeze_ns == stage.cutoff_ns,
            "last_receipt_ns": max(receipts) if receipts else None,
            "feed_watermarks": stage.watermarks,
            "market_receipt_ns": (
                None if stage.market is None else str(stage.market.get("receipt_ns"))
            ),
            "market_diagnostics": stage.market_diagnostics,
            "strike_policy": stage.strike_policy,
        }


        # `input_valid` is a SOURCING statement, not a quality score: every
        # required stage produced a value from received data. A non-finite
        # individual feature is left to the head's fitted imputation, exactly as
        # in the research frame.
        input_valid = not blockers and not missing

        return Direction60Packet(
            target_open=stage.target_open,
            ticker=ticker or (stage.market or {}).get("ticker"),
            features=features,
            input_valid=input_valid,
            blockers=blockers,
            source=source,
            market=stage.market,
            strike_policy=stage.strike_policy,
        )

    def blocking_reasons(self, at_ns: int) -> list[str]:
        """Feed-level readiness only, over Version 1's own required feeds.

        The C85 expert-chain blockers are deliberately NOT consulted: Version 1
        does not consume the ancestor chain, so an unported ancestor is not a
        Version 1 blocker. Nor are BTCUSDC / COIN-M aggregate trades, which are
        not Version 1 inputs.
        """
        return self.stage.blocking_reasons(at_ns)
