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

import numpy as np
import pandas as pd

from .features import (
    base_anchor_fields,
    binance_cross_fields,
    binance_window_features,
    build_direction_features,
    cm_context_features,
    index_fields,
    quote_fields,
)
from .orchestration import RawPacketUnavailable, TargetInputs

NS = 1_000_000_000
MINUTE_MS = 60_000


def _events(buffer: Any, target_ns: int, cutoff_ns: int, freeze_ns: int) -> pd.DataFrame:
    """Received events in [T-15m, cutoff), in the feature builder's schema.

    The receipt filter is applied by `FeedBuffer.slice`: an event that happened
    inside the window but arrived after the freeze was not available to decide
    with and must not enter the packet.

    `underlying_n` is the aggregate's own `l - f + 1` trade count, matching the
    archive builder; it is never flattened to one per aggregate.
    """
    window_start_ns = target_ns - 15 * 60 * NS
    trades = buffer.slice(window_start_ns, cutoff_ns, freeze_ns)
    columns = ["ts_us", "price", "quantity", "underlying_n", "signed", "quote"]
    if not trades:
        return pd.DataFrame(columns=columns)
    rows = []
    for t in trades:
        quantity = float(t.quantity)
        price = float(t.price)
        rows.append(
            {
                "ts_us": t.event_ns // 1000,
                "price": price,
                "quantity": quantity,
                "underlying_n": float(t.underlying_n),
                "signed": 1.0 if t.taker_buy else -1.0,
                "quote": price * quantity,
            }
        )
    return pd.DataFrame.from_records(rows).sort_values("ts_us", kind="stable").reset_index(drop=True)


def _kline_row(kline: Any) -> dict[str, float]:
    return {
        "open_ms": float(kline.open_ms),
        "close_ms": float(kline.close_ms),
        "open": kline.open,
        "high": kline.high,
        "low": kline.low,
        "close": kline.close,
        "base_volume": kline.base_volume,
        "quote_volume": kline.quote_volume,
        "trade_count": float(kline.trade_count),
        "taker_buy_base": kline.taker_buy_base,
    }


@dataclass
class LivePacketSource:
    """Builds one target's inputs from the live collectors and the expert chain.

    Assembly is staged, and every stage that cannot be completed from received
    data appends a named blocker instead of substituting a value. The build
    either returns a fully sourced `TargetInputs` or raises with the complete
    list of what was missing at this boundary.
    """

    feeds: Any
    experts: Any
    market: Any = None  # optional override; the Kalshi feed buffer is the default.

    def _trade_buffer(self, name: str) -> Any:
        trades = getattr(self.feeds, "trades", None)
        if isinstance(trades, dict) and name in trades:
            return trades[name]
        return getattr(self.feeds, "buffers", {}).get(name)

    # ---------------------------------------------------------------- blockers
    def _feed_blockers(self, at_ns: int) -> list[str]:
        missing = self.feeds.missing(at_ns)
        if not missing:
            return []
        return [
            "C85_FEEDS_STALE_AT_CUTOFF: no fresh received data for "
            + ", ".join(missing)
            + " — the packet is not built from a partial feed set"
        ]

    def _quote_window(self, target_ms: int) -> dict[str, Any] | None:
        if self.market is not None:
            return self.market.snapshot(target_ms)
        quotes = getattr(self.feeds, "quotes", None)
        return None if quotes is None else quotes.window(target_ms)

    # ------------------------------------------------------------------ build
    def build(self, target_open: datetime, cutoff_ns: int) -> TargetInputs:
        target_open = target_open.astimezone(timezone.utc)
        target_ns = int(target_open.timestamp() * NS)
        target_ms = target_ns // 1_000_000
        freeze_ns = cutoff_ns

        reasons: list[str] = self._feed_blockers(cutoff_ns)
        row: dict[str, Any] = {"ts": target_open, "target_ms": target_ms}

        # 1. Binance direction windows from received aggregate trades.
        for feed_name in ("binance_spot", "binance_um"):
            buffer = self._trade_buffer(feed_name)
            if buffer is None:
                reasons.append(f"C85_FEED_NOT_CONFIGURED: {feed_name}")
                continue
            row.update(
                binance_window_features(
                    _events(buffer, target_ns, cutoff_ns, freeze_ns), target_ms, feed_name
                )
            )
        if "binance_spot_t5_w005_return_bps" in row:
            row.update(binance_cross_fields(row))

        # 2. spot_t0_price. The archive reads the OPEN of the spot candle that
        #    begins at T; Binance defines that open as the first trade at or
        #    after T, which live trades give directly. If no spot trade has been
        #    received in [T, cutoff) there is no anchor open, and none is guessed.
        spot_buffer = self._trade_buffer("binance_spot")
        if spot_buffer is not None:
            opening = spot_buffer.slice(target_ns, cutoff_ns, freeze_ns)
            if opening:
                row["spot_t0_price"] = float(opening[0].price)
            else:
                reasons.append(
                    "C85_SPOT_ANCHOR_OPEN_MISSING: no BTCUSDT spot trade received in "
                    "[T, T+5s); spot_t0_price is the open of the candle starting at T "
                    "and is not interpolated"
                )

        # 3. Kalshi target window: floor_strike, market_q1, last_yes_price.
        quote = self._quote_window(target_ms)
        market_q1: bool | None = None
        last_yes_price: float | None = None
        if quote is None:
            reasons.append(
                "C85_MARKET_WINDOW_MISSING: the KXBTC15M [T, T+5s) trade window for this "
                "target has not been received; market_q1 and last_yes_price are unavailable"
            )
        else:
            market_q1 = bool(quote.get("market_q1"))
            last_yes_price = quote.get("last_yes_price")
            strike = quote.get("floor_strike")
            if strike is None or not np.isfinite(float(strike)) or float(strike) <= 0:
                reasons.append(
                    "C85_FLOOR_STRIKE_MISSING: the target market did not supply a finite "
                    "positive floor_strike"
                )
            else:
                row["floor_strike"] = float(strike)
                row["anchor_valid"] = True

        # 4. Reference minutes: USDC quote, index, spot prior, COIN-M context.
        klines = getattr(self.feeds, "klines", {})
        prior_open = target_ms - MINUTE_MS
        usdc = klines.get("binance_usdc_1m")
        spot_1m = klines.get("binance_1m")
        index_1m = klines.get("binance_index")
        cm_1m = klines.get("binance_cm_1m")

        usdc_prior = usdc.minute(prior_open, freeze_ns) if usdc else None
        spot_prior = spot_1m.minute(prior_open, freeze_ns) if spot_1m else None
        index_prior = index_1m.minute(prior_open, freeze_ns) if index_1m else None

        if usdc_prior is None:
            reasons.append("C85_QUOTE_MINUTE_MISSING: BTCUSDC completed minute T-1 not received")
        else:
            vwap = (
                usdc_prior.quote_volume / usdc_prior.base_volume
                if usdc_prior.base_volume > 0
                else float("nan")
            )
            row.update(
                {
                    "quote_open_ms": float(usdc_prior.open_ms),
                    "quote_close_ms": float(usdc_prior.close_ms),
                    "quote_vwap_usdt_per_usdc": vwap,
                    "quote_valid": bool(
                        usdc_prior.close_ms == target_ms - 1
                        and usdc_prior.base_volume > 0
                        and usdc_prior.trade_count > 0
                        and 0.9 <= vwap <= 1.1
                    ),
                }
            )

        if spot_prior is None:
            reasons.append("C85_SPOT_MINUTE_MISSING: BTCUSDT completed minute T-1 not received")
        else:
            row.update(
                {
                    "spot_prior_open_ms": float(spot_prior.open_ms),
                    "spot_prior_close_ms": float(spot_prior.close_ms),
                    "spot_prior_close": spot_prior.close,
                    "spot_prior_base_volume": spot_prior.base_volume,
                    "spot_prior_trade_count": float(spot_prior.trade_count),
                }
            )
        if index_prior is None:
            reasons.append("C85_INDEX_MINUTE_MISSING: BTCUSDT index completed minute T-1 not received")
        else:
            row.update(
                {
                    "index_prior_open_ms": float(index_prior.open_ms),
                    "index_prior_close_ms": float(index_prior.close_ms),
                    "index_prior_close": index_prior.close,
                    "index_basic_count": float(index_prior.trade_count),
                }
            )
        if index_prior is not None and spot_prior is not None and spot_prior.close > 0:
            row["index_spot_ratio"] = index_prior.close / spot_prior.close
            row["index_source_valid"] = True

        # 5. COIN-M context needs the 16 completed minutes ending at T-1.
        cm_window = (
            cm_1m.window(target_ms - 16 * MINUTE_MS, prior_open, freeze_ns) if cm_1m else []
        )
        idx_window = (
            index_1m.window(target_ms - 16 * MINUTE_MS, prior_open, freeze_ns) if index_1m else []
        )
        spot_window = (
            spot_1m.window(target_ms - 16 * MINUTE_MS, prior_open, freeze_ns) if spot_1m else []
        )
        if not (cm_window and idx_window and spot_window):
            reasons.append(
                "C85_CM_CONTEXT_INCOMPLETE: the COIN-M feature block requires all 16 "
                "completed minutes of BTCUSD_PERP, index and spot ending at T-1ms; "
                "the received set is incomplete and is not padded"
            )
        else:
            cm_frame = pd.DataFrame([_kline_row(k) for k in cm_window]).rename(
                columns={"base_volume": "contract_volume", "taker_buy_base": "buy_contract_volume"}
            )
            try:
                context = cm_context_features(
                    cm_frame,
                    pd.DataFrame(
                        [{**_kline_row(k), "basic_count": float(k.trade_count)} for k in idx_window]
                    ),
                    pd.DataFrame([_kline_row(k) for k in spot_window]),
                )
                tail = context.loc[context["ts"] == target_open]
                if tail.empty:
                    reasons.append(
                        "C85_CM_CONTEXT_NO_TARGET_ROW: the COIN-M block produced no row for "
                        "this target boundary"
                    )
                else:
                    row.update({k: v for k, v in tail.iloc[0].items() if k != "ts"})
            except Exception as exc:  # noqa: BLE001 - fail closed with the cause
                reasons.append(f"C85_CM_CONTEXT_FAILED: {type(exc).__name__}: {exc}")

        # 6. Derived anchor / quote / index blocks, then the direction matrix.
        direction_features: dict[str, float] | None = None
        if not reasons:
            try:
                frame = base_anchor_fields(pd.DataFrame([row]))
                frame = pd.concat([frame, quote_fields(frame), index_fields(frame)], axis=1)
                direction_features = (
                    build_direction_features(frame).iloc[0].astype(float).to_dict()
                )
            except Exception as exc:  # noqa: BLE001
                reasons.append(f"C85_DIRECTION_MATRIX_UNAVAILABLE: {type(exc).__name__}: {exc}")

        # 7. The transcribed ancestor chain and the meta/auxiliary blocks.
        chain = getattr(self.experts, "chain", None)
        leaf_outputs: dict[str, Any] = {}
        if chain is None:
            reasons.append("C85_EXPERT_CHAIN_NOT_INSTANTIATED")
        else:
            try:
                leaf_outputs = chain.evaluate({**row, "ts": target_open})
            except Exception as exc:  # noqa: BLE001 - fail-closed message is the payload
                reasons.append(f"C85_ANCESTOR_CHAIN_UNAVAILABLE: {exc}")

        meta_features = leaf_outputs.get("meta_features_without_aux") if leaf_outputs else None
        auxiliary_outputs = leaf_outputs.get("auxiliary_outputs") if leaf_outputs else None
        c54_prediction = leaf_outputs.get("c54_prediction") if leaf_outputs else None
        if not reasons:
            for label, value in (
                ("meta_features_without_aux", meta_features),
                ("auxiliary_outputs", auxiliary_outputs),
                ("c54_prediction", c54_prediction),
            ):
                if value is None:
                    reasons.append(
                        f"C85_LEAF_OUTPUT_MISSING: the expert chain returned no {label}; "
                        "the packet is not completed from a partial expert set"
                    )

        if reasons:
            raise RawPacketUnavailable(" || ".join(reasons))

        return TargetInputs(
            direction_features=direction_features or {},
            meta_features_without_aux=meta_features,
            auxiliary_outputs=auxiliary_outputs,
            validity=bool(leaf_outputs.get("validity", False)),
            c54_prediction=c54_prediction,
            market_q1=bool(market_q1),
            last_yes_price=last_yes_price,
            aux_fit_month=leaf_outputs.get("aux_fit_month"),
            source="live",
        )

    def blocking_reasons(self, at_ns: int) -> list[str]:
        """Same reasons the boundary would report, for readiness reporting."""
        reasons = self._feed_blockers(at_ns)
        chain = getattr(self.experts, "chain", None)
        if chain is None:
            reasons.append("C85_EXPERT_CHAIN_NOT_INSTANTIATED")
        else:
            status = self.experts.status()
            reasons.extend(status.get("blocking_reasons") or [])
        return reasons

