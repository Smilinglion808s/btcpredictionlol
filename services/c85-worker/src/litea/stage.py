"""The Version 1 direction stage, built from Version 1's OWN required sources.

Why this exists instead of calling `LivePacketSource.direction_stage`:

The shared C85 stage reads the Kalshi `[T, T+5s)` TRADE aggregate to obtain
`market_q1`, `last_yes_price` AND the target's `floor_strike`. That aggregate
can only be requested after T+5s — the very deadline it feeds — so at a live
Version 1 boundary it is structurally unavailable and every packet fails with
`C85_MARKET_WINDOW_NOT_RECEIVED_BY_FREEZE`.

Version 1 does not use `market_q1` or `last_yes_price`. It needs the target's
STRIKE, which the venue publishes when the contract is listed, long before T.
So this stage reads the listed market record (`MarketBuffer`) for the strike
and the contract identity, and never touches the quote aggregate. Nothing is
synthesised: if the target's market has not been received, the packet fails
closed with a named blocker.

Everything else — the Binance spot/UM `[T-15m, T+5s)` aggregate-trade windows,
the T+5 spot anchor and its five-second completeness, the USDCUSDT quote-rate
minute, the spot and index prior minutes, the 16-minute COIN-M context and the
derived anchor/quote/index blocks — is the unchanged supplied recipe, computed
by the same `features` functions the offline recovery path uses.

Required feeds for Version 1 (and only these):

    binance_spot        BTCUSDT   spot aggTrades
    binance_um          BTCUSDT   USD-M perp aggTrades
    binance_1m          BTCUSDT   completed 1m klines
    binance_usdcusdt_1m USDCUSDT  completed 1m klines (the USDT-per-USDC rate)
    binance_index       BTCUSD    COIN-M index 1m klines
    binance_cm_1m       BTCUSD_PERP COIN-M 1m klines
    kalshi_markets      KXBTC15M  listed contract metadata (strike)

BTCUSDC and COIN-M aggregate TRADES are not Version 1 inputs and are not
required here.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd

from ..features import (
    base_anchor_fields,
    binance_cross_fields,
    binance_window_features,
    build_direction_features,
    cm_context_features,
    index_fields,
    quote_fields,
)
from ..packets import _events, _kline_row
from .reconstruct import empty_window_template


NS = 1_000_000_000
MINUTE_MS = 60_000
INTERVAL_MS = 15 * MINUTE_MS

#: Exactly the feeds the 60 direction inputs are built from.
REQUIRED_FEEDS = (
    "binance_spot",
    "binance_um",
    "binance_1m",
    "binance_usdcusdt_1m",
    "binance_index",
    "binance_cm_1m",
    "kalshi_markets",
)


@dataclass
class V1Stage:
    target_open: datetime
    target_ns: int
    target_ms: int
    cutoff_ns: int
    freeze_ns: int
    reasons: list[str]
    row: dict[str, Any]
    direction_features: dict[str, float] | None
    market: dict[str, Any] | None = None
    watermarks: dict[str, Any] = field(default_factory=dict)
    #: Small, secret-free record of what the venue actually served for this
    #: target's contract, so a late publication can be told from a defect.
    market_diagnostics: dict[str, Any] | None = None



class V1DirectionStage:
    """Version 1's own sourcing path over the live feed registry."""

    def __init__(self, feeds: Any) -> None:
        self.feeds = feeds

    # -- feed views ------------------------------------------------------------
    def _buffer(self, name: str) -> Any:
        trades = getattr(self.feeds, "trades", None)
        if isinstance(trades, dict) and name in trades:
            return trades[name]
        klines = getattr(self.feeds, "klines", None)
        if isinstance(klines, dict) and name in klines:
            return klines[name]
        if name == "kalshi_markets":
            return getattr(self.feeds, "markets", None)
        return getattr(self.feeds, "buffers", {}).get(name)

    def stale_feeds(self, at_ns: int) -> list[str]:
        stale: list[str] = []
        for name in REQUIRED_FEEDS:
            buffer = self._buffer(name)
            if buffer is None or not buffer.is_fresh(at_ns):
                stale.append(name)
        return stale

    def missing_context_minutes(self, at_ns: int) -> dict[str, list[str]]:
        """Which of the 16 required completed minutes are absent, by feed.

        "The context is incomplete" is a symptom. The boundary needs BTCUSD_PERP,
        the COIN-M index and spot for all 16 completed minutes ending at T-1, so
        readiness has to be judged on held HISTORY, not on how fresh the latest
        packet happens to look.
        """
        import datetime as _dt

        now_ms = at_ns // 1_000_000
        prior_open = (now_ms // MINUTE_MS) * MINUTE_MS - MINUTE_MS
        first_open = prior_open - 15 * MINUTE_MS
        gaps: dict[str, list[str]] = {}
        for name in ("binance_cm_1m", "binance_index", "binance_1m"):
            buffer = self._buffer(name)
            if buffer is None or not hasattr(buffer, "missing_minutes"):
                gaps[name] = ["unavailable"]
                continue
            absent = buffer.missing_minutes(first_open, prior_open, at_ns)
            if absent:
                gaps[name] = [
                    _dt.datetime.fromtimestamp(ms / 1000, _dt.timezone.utc).strftime("%H:%M")
                    for ms in absent
                ]
        return gaps

    def blocking_reasons(self, at_ns: int) -> list[str]:
        reasons: list[str] = []
        stale = self.stale_feeds(at_ns)
        if stale:
            reasons.append(
                "LITEA_FEEDS_STALE_AT_CUTOFF: no fresh received data for "
                + ", ".join(stale)
                + " — the packet is not built from a partial feed set"
            )
        gaps = self.missing_context_minutes(at_ns)
        if gaps:
            detail = "; ".join(
                f"{name} missing {', '.join(minutes)} UTC" for name, minutes in sorted(gaps.items())
            )
            reasons.append(
                "LITEA_CONTEXT_HISTORY_INCOMPLETE: the 16 completed minutes ending at "
                f"T-1 are not all held — {detail}"
            )
        return reasons


    def watermarks(self, freeze_ns: int) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for name in REQUIRED_FEEDS:
            buffer = self._buffer(name)
            if buffer is not None:
                out[name] = buffer.freshness(freeze_ns)
        return out

    # -- the stage -------------------------------------------------------------
    def build(
        self,
        target_open: datetime,
        cutoff_ns: int,
        freeze_ns: int | None = None,
    ) -> V1Stage:
        target_open = target_open.astimezone(timezone.utc)
        target_ns = int(target_open.timestamp() * NS)
        target_ms = target_ns // 1_000_000
        if freeze_ns is None:
            freeze_ns = cutoff_ns
        freeze_ns = max(int(freeze_ns), int(cutoff_ns))

        reasons: list[str] = self.blocking_reasons(cutoff_ns)
        # The canonical row starts from the reference EMPTY-WINDOW template:
        # an unobserved sub-window is NaN in every aggregate, exactly as the
        # archive builder leaves it. Starting from a bare row instead made a
        # genuinely empty first second (no trade in [T, T+1s)) delete the
        # column entirely, and the derived blocks then raised KeyError. NaN is
        # the model-allowed per-feature missingness handled by the fitted
        # median imputation; it is NOT zero-fill and does not fabricate events.
        row: dict[str, Any] = {
            "ts": target_open,
            "target_ms": target_ms,
            **empty_window_template(),
        }

        # 1. Binance direction windows from received aggregate trades.
        for feed_name in ("binance_spot", "binance_um"):
            buffer = self._buffer(feed_name)
            if buffer is None:
                reasons.append(f"LITEA_FEED_NOT_CONFIGURED: {feed_name}")
                continue
            events = _events(buffer, target_ns, cutoff_ns, freeze_ns)
            if events.empty:
                # Acquisition genuinely produced nothing for this venue over
                # [T-15m, T+5s) — a source failure, not per-feature missingness.
                reasons.append(f"LITEA_NO_EVENTS_RECEIVED: {feed_name}")
                continue
            row.update(binance_window_features(events, target_ms, feed_name))

        if "binance_spot_t5_w005_return_bps" in row:
            row.update(binance_cross_fields(row))

        # 2. The T+5 spot anchor and its five-second completeness.
        spot_buffer = self._buffer("binance_spot")
        if spot_buffer is not None:
            opening = spot_buffer.slice(target_ns, cutoff_ns, freeze_ns)
            if opening:
                row["spot_t0_price"] = float(opening[0].price)
                seconds = {(t.event_ns - target_ns) // NS for t in opening}
                last_second = [t for t in opening if (t.event_ns - target_ns) // NS == 4]
                complete = seconds.issuperset({0, 1, 2, 3, 4}) and bool(last_second)
                row["t45_spot_complete"] = int(
                    complete
                    and np.isfinite(float(opening[0].price))
                    and np.isfinite(float(last_second[-1].price))
                )
                row["t45_spot_open"] = float(opening[0].price)
                row["t45_close_5s"] = float(last_second[-1].price) if complete else float("nan")
                row["observed_second_rows"] = float(len(seconds))
            else:
                reasons.append(
                    "LITEA_SPOT_ANCHOR_OPEN_MISSING: no BTCUSDT spot trade received in "
                    "[T, T+5s); spot_t0_price is the open of the candle starting at T "
                    "and is not interpolated"
                )

        # 3. The LISTED contract: strike and identity, received before the freeze.
        #    The [T, T+5s) quote aggregate is deliberately not consulted.
        markets = self._buffer("kalshi_markets")
        market = markets.get(target_ms, freeze_ns) if markets is not None else None
        market_diagnostics = (
            markets.diagnostics(target_ms, freeze_ns)
            if markets is not None and hasattr(markets, "diagnostics")
            else None
        )

        if market is None:
            reasons.append(
                "LITEA_MARKET_NOT_LISTED_BY_FREEZE: no KXBTC15M contract opening at this "
                "target had been received at the declared freeze; the strike is taken "
                "from the venue's own market record and is never derived from a price"
            )
        else:
            strike = market.get("floor_strike")
            if strike is None or not np.isfinite(float(strike)) or float(strike) <= 0:
                reasons.append(
                    "LITEA_FLOOR_STRIKE_MISSING: the target market did not supply a finite "
                    "positive floor_strike"
                )
            else:
                row["floor_strike"] = float(strike)
                row["anchor_valid"] = True

        # 4. Reference minutes: USDCUSDT rate, spot prior, COIN-M index prior.
        prior_open = target_ms - MINUTE_MS
        usdc = self._buffer("binance_usdcusdt_1m")
        spot_1m = self._buffer("binance_1m")
        index_1m = self._buffer("binance_index")
        cm_1m = self._buffer("binance_cm_1m")

        usdc_prior = usdc.minute(prior_open, freeze_ns) if usdc else None
        spot_prior = spot_1m.minute(prior_open, freeze_ns) if spot_1m else None
        index_prior = index_1m.minute(prior_open, freeze_ns) if index_1m else None

        if usdc_prior is None:
            reasons.append(
                "LITEA_QUOTE_MINUTE_MISSING: USDCUSDT completed minute T-1 not received"
            )
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
            reasons.append("LITEA_SPOT_MINUTE_MISSING: BTCUSDT completed minute T-1 not received")
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
            reasons.append(
                "LITEA_INDEX_MINUTE_MISSING: BTCUSD COIN-M index completed minute T-1 "
                "not received"
            )
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

        # 5. The 16 completed minutes ending at T-1 for the COIN-M context.
        first_open = target_ms - 16 * MINUTE_MS
        cm_window = cm_1m.window(first_open, prior_open, freeze_ns) if cm_1m else []
        idx_window = index_1m.window(first_open, prior_open, freeze_ns) if index_1m else []
        spot_window = spot_1m.window(first_open, prior_open, freeze_ns) if spot_1m else []
        if not (cm_window and idx_window and spot_window):
            reasons.append(
                "LITEA_CM_CONTEXT_INCOMPLETE: the COIN-M feature block requires all 16 "
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
                        "LITEA_CM_CONTEXT_NO_TARGET_ROW: the COIN-M block produced no row "
                        "for this target boundary"
                    )
                else:
                    row.update({k: v for k, v in tail.iloc[0].items() if k != "ts"})
            except Exception as exc:  # noqa: BLE001 — fail closed with the cause
                reasons.append(f"LITEA_CM_CONTEXT_FAILED: {type(exc).__name__}: {exc}")

        # 6. Derived anchor / quote / index blocks, then the 60-column matrix.
        direction_features: dict[str, float] | None = None
        if not reasons:
            try:
                frame = base_anchor_fields(pd.DataFrame([row]))
                frame = pd.concat([frame, quote_fields(frame), index_fields(frame)], axis=1)
                direction_features = (
                    build_direction_features(frame).iloc[0].astype(float).to_dict()
                )
            except Exception as exc:  # noqa: BLE001
                reasons.append(
                    f"LITEA_DIRECTION_MATRIX_UNAVAILABLE: {type(exc).__name__}: {exc}"
                )

        return V1Stage(
            target_open=target_open,
            target_ns=target_ns,
            target_ms=target_ms,
            cutoff_ns=cutoff_ns,
            freeze_ns=freeze_ns,
            reasons=reasons,
            row=row,
            direction_features=direction_features,
            market=market,
            watermarks=self.watermarks(freeze_ns),
            market_diagnostics=market_diagnostics,
        )

