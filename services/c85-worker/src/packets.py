"""Live packet production for the reconstruction build.

This is the real wiring between the running collectors and the boundary
orchestrator. It replaces `UnavailablePacketSource`, which could never produce
anything: this source actually freezes the live feeds at the model's own T+5s
input cutoff, builds the Binance window features from the received events, and
drives the transcribed ancestor chain.

What it deliberately does NOT do:

* it never substitutes, interpolates or imputes a feed that did not arrive,
* it never reads an archived ledger value and calls it a live signal,
* it never emits a packet when any required producer is still unported.

When a required input or producer is absent it raises `RawPacketUnavailable`
carrying EVERY blocking reason at once, so one boundary log line names the full
remaining gap instead of only the first failure. The orchestrator persists that
as a MISSED row — an honest "no forward model output for this target", never a
heartbeat dressed up as a prediction.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import pandas as pd

from .features import binance_cross_fields, binance_window_features
from .orchestration import RawPacketUnavailable, TargetInputs

NS = 1_000_000_000


def _events(buffer: Any, target_ns: int, cutoff_ns: int, freeze_ns: int) -> pd.DataFrame:
    """Received events in [T-15m, cutoff), in the feature builder's schema.

    The receipt filter is applied by `FeedBuffer.slice`: an event that happened
    inside the window but arrived after the freeze was not available to decide
    with and must not enter the packet.
    """
    window_start_ns = target_ns - 15 * 60 * NS
    trades = buffer.slice(window_start_ns, cutoff_ns, freeze_ns)
    if not trades:
        return pd.DataFrame(columns=["ts_us", "price", "quantity", "underlying_n", "signed", "quote"])
    rows = []
    for t in trades:
        quantity = float(t.quantity)
        price = float(t.price)
        rows.append(
            {
                "ts_us": t.event_ns // 1000,
                "price": price,
                "quantity": quantity,
                "underlying_n": 1.0,
                "signed": 1.0 if t.taker_buy else -1.0,
                "quote": price * quantity,
            }
        )
    return pd.DataFrame.from_records(rows).sort_values("ts_us", kind="stable").reset_index(drop=True)


@dataclass
class LivePacketSource:
    """Builds one target's inputs from the live collectors and the expert chain."""

    feeds: Any
    experts: Any
    market: Any = None  # Kalshi quote source; None until a collector exists.

    def _feed_blockers(self, at_ns: int) -> list[str]:
        missing = self.feeds.missing(at_ns)
        if not missing:
            return []
        return [
            "C85_FEEDS_STALE_AT_CUTOFF: no fresh received data for "
            + ", ".join(missing)
            + " — the packet is not built from a partial feed set"
        ]

    def _market_blockers(self) -> tuple[list[str], bool | None, float | None]:
        if self.market is None:
            return (
                [
                    "C85_MARKET_QUOTE_SOURCE_MISSING: market_q1 / last_yes_price require a "
                    "live Kalshi KXBTC15M quote collector; none is wired, and a stale or "
                    "manually entered price is not a live quote"
                ],
                None,
                None,
            )
        try:
            quote = self.market.snapshot()
        except Exception as exc:  # noqa: BLE001
            return ([f"C85_MARKET_QUOTE_UNAVAILABLE: {type(exc).__name__}: {exc}"], None, None)
        return ([], bool(quote.get("market_q1")), quote.get("last_yes_price"))

    def build(self, target_open: datetime, cutoff_ns: int) -> TargetInputs:
        target_open = target_open.astimezone(timezone.utc)
        target_ns = int(target_open.timestamp() * NS)
        target_ms = target_ns // 1_000_000
        freeze_ns = cutoff_ns

        reasons: list[str] = self._feed_blockers(cutoff_ns)

        # 1. real window features from received events (no substitution).
        window: dict[str, float] = {}
        for feed_name, prefix in (("binance_spot", "binance_spot"), ("binance_um", "binance_um")):
            buffer = self.feeds.buffers.get(feed_name)
            if buffer is None:
                reasons.append(f"C85_FEED_NOT_CONFIGURED: {feed_name}")
                continue
            window.update(
                binance_window_features(
                    _events(buffer, target_ns, cutoff_ns, freeze_ns), target_ms, prefix
                )
            )
        if window:
            window.update(binance_cross_fields(window))

        # 2. market quote.
        market_reasons, market_q1, last_yes_price = self._market_blockers()
        reasons.extend(market_reasons)

        # 3. the transcribed ancestor chain, fail-closed per unported producer.
        chain = getattr(self.experts, "chain", None)
        if chain is None:
            reasons.append("C85_EXPERT_CHAIN_NOT_INSTANTIATED")
        else:
            packet = {
                "ts": target_open,
                "target_ms": target_ms,
                **window,
            }
            try:
                chain.evaluate(packet)
            except Exception as exc:  # noqa: BLE001 - fail-closed message is the payload
                reasons.append(f"C85_ANCESTOR_CHAIN_UNAVAILABLE: {exc}")

        if reasons:
            raise RawPacketUnavailable(" || ".join(reasons))

        raise RawPacketUnavailable(
            "C85_PACKET_ASSEMBLY_INCOMPLETE: every dependency reported available but the "
            "reconstruction packet assembler has no path that produces direction/meta "
            "feature vectors yet; refusing to emit an unvalidated packet"
        )

    def blocking_reasons(self, at_ns: int) -> list[str]:
        """Same reasons the boundary would report, for readiness reporting."""
        reasons = self._feed_blockers(at_ns)
        reasons.extend(self._market_blockers()[0])
        chain = getattr(self.experts, "chain", None)
        if chain is None:
            reasons.append("C85_EXPERT_CHAIN_NOT_INSTANTIATED")
        else:
            status = self.experts.status()
            reasons.extend(status.get("blocking_reasons") or [])
        return reasons
