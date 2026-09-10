"""Direction-only packet production for Version 1.

Version 1 needs the 60 direction inputs and nothing else. Those inputs are
already produced authentically by `LivePacketSource.direction_stage`: Binance
spot/UM aggregate-trade T0/T5 windows, the T+5 spot anchor and its five-second
completeness, the Kalshi strike/spot anchor for this target's own market, the
USDCUSDT quote rate, the index minute, and the 16-minute COIN-M context.

This module reuses that exact calculation and stops there. It never reaches
into the C85 ancestor chain, the correctness model or the monthly auxiliaries,
and it never fills those columns with placeholders.

The `[T, T+5s)` window is used in full: the packet is frozen at the model's own
input cutoff, and the actual freeze/receipt instants are recorded as measured.
Nothing is backdated.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from ..features import DIRECTION_ORDER

NS = 1_000_000_000


@dataclass
class Direction60Packet:
    """One target's Version 1 inputs, with honest availability."""

    target_open: datetime
    ticker: str | None
    features: dict[str, float | None]
    input_valid: bool
    blockers: list[str] = field(default_factory=list)
    source: dict[str, Any] = field(default_factory=dict)

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
    """Adapts the shared live packet source to the Version 1 contract."""

    def __init__(self, packet_source: Any) -> None:
        self.packets = packet_source

    def build(
        self,
        target_open: datetime,
        cutoff_ns: int,
        freeze_ns: int | None = None,
        ticker: str | None = None,
    ) -> Direction60Packet:
        stage = self.packets.direction_stage(target_open, cutoff_ns, freeze_ns)
        source = self.packets._source_metadata(  # noqa: SLF001 - same package contract
            stage.target_ns, stage.cutoff_ns, stage.freeze_ns
        )
        features = dict(stage.direction_features or {})
        blockers = list(stage.reasons)

        missing = [name for name in DIRECTION_ORDER if name not in features]
        if missing and not blockers:
            blockers.append(
                "LITEA_DIRECTION_COLUMNS_MISSING: " + ", ".join(missing[:8])
            )

        # `input_valid` is a SOURCING statement, not a quality score: every
        # required stage produced a value from received data. A non-finite
        # individual feature is left to the head's fitted imputation, exactly as
        # in the research frame.
        input_valid = not blockers and not missing

        return Direction60Packet(
            target_open=target_open.astimezone(timezone.utc),
            ticker=ticker,
            features=features,
            input_valid=input_valid,
            blockers=blockers,
            source=source,
        )

    def blocking_reasons(self, at_ns: int) -> list[str]:
        """Feed-level readiness only.

        The C85 expert-chain blockers are deliberately NOT consulted: Version 1
        does not consume the ancestor chain, so an unported ancestor is not a
        Version 1 blocker.
        """
        return self.packets._feed_blockers(at_ns)  # noqa: SLF001
