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
    FeatureUnavailable,
    auxiliary_features,
    auxiliary_logits,
    base_anchor_fields,
    binance_cross_fields,
    binance_window_features,
    build_direction_features,
    cm_context_features,
    cm_valid,
    frame_anchor_valid,
    index_fields,
    metaframe,
    quote_fields,
)
from .orchestration import RawPacketUnavailable, TargetInputs

NS = 1_000_000_000
MINUTE_MS = 60_000

#: `auxiliary_source.features` needs a 240-minute rolling volatility AND a
#: 240-minute return shift, so the last row is only finite with 481 completed
#: minutes behind it. Nothing shorter is padded or back-filled.
AUX_LOOKBACK_MINUTES = 481


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
    #: The artifact store. Required for the meta block: `metaframe` is
    #: conditioned on the direction head's own probability/proposal, and the
    #: auxiliary block is real monthly LONG/RECENT inference.
    artifacts: Any = None

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

    def _quote_window(self, target_ms: int, freeze_ns: int) -> dict[str, Any] | None:
        if self.market is not None:
            return self.market.snapshot(target_ms, freeze_ns)
        quotes = getattr(self.feeds, "quotes", None)
        return None if quotes is None else quotes.window(target_ms, freeze_ns)

    # ------------------------------------------------------------------ build
    def build(
        self,
        target_open: datetime,
        cutoff_ns: int,
        freeze_ns: int | None = None,
    ) -> TargetInputs:
        """Assemble one target, frozen at ONE instant for every source.

        `cutoff_ns` is the model's immutable T+5 input deadline. `freeze_ns` is
        the instant this packet actually froze; it defaults to the deadline. A
        shadow-logging caller may pass a LATER freeze to record what was
        knowable at compute time — every source is then read at that same later
        instant, and the returned `source` metadata carries `on_time=False`
        with the measured lateness. No source is ever read past the declared
        freeze, so a late REST body cannot leak into an earlier declared one.
        """
        target_open = target_open.astimezone(timezone.utc)
        target_ns = int(target_open.timestamp() * NS)
        target_ms = target_ns // 1_000_000
        if freeze_ns is None:
            freeze_ns = cutoff_ns
        if freeze_ns < cutoff_ns:
            raise RawPacketUnavailable(
                "C85_FREEZE_BEFORE_CUTOFF: a packet may not be frozen before its own "
                f"T+5 input deadline (freeze={freeze_ns}, cutoff={cutoff_ns})"
            )
        # Every window read below ends at the model cutoff (event time) and is
        # receipt-filtered at the freeze (availability time). Those are separate
        # axes and are never conflated.
        event_end_ns = cutoff_ns

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
            opening = spot_buffer.slice(target_ns, event_end_ns, freeze_ns)
            if opening:
                row["spot_t0_price"] = float(opening[0].price)
                # t45_spot_complete: acquire_c52_binance_spot_boundary_r1 marks a
                # target complete only when ALL FIVE one-second spot candles at
                # offsets 0..4 exist with finite open and close. A 1s candle
                # exists exactly when that second contains at least one trade, so
                # the live equivalent is five non-empty second buckets inside
                # [T, T+5s) — never a constant 1, and never a T45 observation
                # from after the cutoff.
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
                    "C85_SPOT_ANCHOR_OPEN_MISSING: no BTCUSDT spot trade received in "
                    "[T, T+5s); spot_t0_price is the open of the candle starting at T "
                    "and is not interpolated"
                )

        # 3. Kalshi target window: floor_strike, market_q1, last_yes_price.
        quote = self._quote_window(target_ms, freeze_ns)
        market_q1: bool | None = None
        last_yes_price: float | None = None
        if quote is None:
            reasons.append(
                "C85_MARKET_WINDOW_NOT_RECEIVED_BY_FREEZE: the KXBTC15M [T, T+5s) trade "
                "window for this target had not been received at the declared freeze "
                f"({freeze_ns}); the window itself only closes at T+5s, so at the model "
                "deadline it is structurally unavailable. A fresh Kalshi connection is "
                "not a substitute for this target's own aggregate."
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
        # research_c68/audit_quote_data.py::main asserts symbol == 'USDCUSDT'.
        # The quote reference is the USDT-per-USDC exchange RATE minute, which is
        # what `quote_fields` divides the BTC anchor by and what the 0.9..1.1
        # range check is written against. BTCUSDC minutes are a BTC price and
        # were the wrong pair.
        usdc = klines.get("binance_usdcusdt_1m")
        spot_1m = klines.get("binance_1m")
        index_1m = klines.get("binance_index")
        cm_1m = klines.get("binance_cm_1m")

        usdc_prior = usdc.minute(prior_open, freeze_ns) if usdc else None
        spot_prior = spot_1m.minute(prior_open, freeze_ns) if spot_1m else None
        index_prior = index_1m.minute(prior_open, freeze_ns) if index_1m else None

        if usdc_prior is None:
            reasons.append(
                "C85_QUOTE_MINUTE_MISSING: USDCUSDT completed minute T-1 not received"
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
        frame: pd.DataFrame | None = None
        if not reasons:
            try:
                frame = base_anchor_fields(pd.DataFrame([row]))
                frame = pd.concat([frame, quote_fields(frame), index_fields(frame)], axis=1)
                direction_features = (
                    build_direction_features(frame).iloc[0].astype(float).to_dict()
                )
            except Exception as exc:  # noqa: BLE001
                reasons.append(f"C85_DIRECTION_MATRIX_UNAVAILABLE: {type(exc).__name__}: {exc}")

        return DirectionStage(
            target_open=target_open,
            target_ns=target_ns,
            target_ms=target_ms,
            cutoff_ns=cutoff_ns,
            freeze_ns=freeze_ns,
            reasons=reasons,
            row=row,
            frame=frame,
            direction_features=direction_features,
            market_q1=market_q1,
            last_yes_price=last_yes_price,
        )

    def build(
        self,
        target_open: datetime,
        cutoff_ns: int,
        freeze_ns: int | None = None,
    ) -> TargetInputs:
        """Assemble one full C85 target: the direction stage plus the ancestor,
        meta and auxiliary blocks. Behaviour is unchanged; stages 1-6 now live in
        `direction_stage` so a direction-only consumer can reuse exactly the same
        sourced calculations without pulling in the ancestor chain.
        """
        stage = self.direction_stage(target_open, cutoff_ns, freeze_ns)
        target_open = stage.target_open
        target_ns = stage.target_ns
        cutoff_ns = stage.cutoff_ns
        freeze_ns = stage.freeze_ns
        reasons = stage.reasons
        row = stage.row
        frame = stage.frame
        direction_features = stage.direction_features
        market_q1 = stage.market_q1
        last_yes_price = stage.last_yes_price


        # 7. The transcribed ancestor chain. It emits LEAF COLUMNS
        #    (c30/c36/c37/r4/external/c42/c51/c54 predictions and ranks); it does
        #    not, and never did, return nested `meta_features_without_aux` or
        #    `auxiliary_outputs`. Building those two blocks is THIS assembler's
        #    job, and the previous code mislabelled its own omission as a missing
        #    C54 output.
        chain = getattr(self.experts, "chain", None)
        leaf_outputs: dict[str, Any] = {}
        pending_update: Any = None
        if chain is None:
            reasons.append("C85_EXPERT_CHAIN_NOT_INSTANTIATED")
        else:
            try:
                # PREPARE, do not commit: the head and the rank window advance
                # only once the decision itself is durable. The orchestrator
                # owns that transaction and calls commit/rollback on the
                # returned update.
                leaf_outputs, pending_update = chain.prepare({**row, "ts": target_open})
            except Exception as exc:  # noqa: BLE001 - fail-closed message is the payload
                reasons.append(f"C85_ANCESTOR_CHAIN_UNAVAILABLE: {exc}")


        c54_prediction = leaf_outputs.get("c54_prediction") if leaf_outputs else None
        meta_features: dict[str, float] | None = None
        auxiliary_outputs: dict[str, float] | None = None
        aux_fit_month: str | None = None
        validity: dict[str, bool] = {}

        if not reasons and frame is not None:
            enriched = frame.copy()
            for name, value in leaf_outputs.items():
                enriched[name] = [value]
            try:
                meta_features, auxiliary_outputs, aux_fit_month = self._meta_and_auxiliary(
                    enriched, direction_features or {}, target_open, freeze_ns
                )
            except FeatureUnavailable as exc:
                reasons.append(str(exc))
            except Exception as exc:  # noqa: BLE001
                reasons.append(f"C85_META_BLOCK_UNAVAILABLE: {type(exc).__name__}: {exc}")
            try:
                validity = self._validity(enriched, leaf_outputs, bool(market_q1))
            except Exception as exc:  # noqa: BLE001
                reasons.append(f"C85_VALIDITY_UNAVAILABLE: {type(exc).__name__}: {exc}")

        if c54_prediction is None and not reasons:
            reasons.append(
                "C85_C54_PREDICTION_MISSING: the ancestor chain produced no c54_prediction"
            )

        if reasons:
            # The target is not being processed, so nothing may advance.
            if pending_update is not None:
                pending_update.rollback()
            raise RawPacketUnavailable(" || ".join(reasons))

        return TargetInputs(
            direction_features=direction_features or {},
            meta_features_without_aux=meta_features or {},
            auxiliary_outputs=auxiliary_outputs or {},
            validity=validity,
            c54_prediction=int(c54_prediction),
            market_q1=bool(market_q1),
            last_yes_price=last_yes_price,
            aux_fit_month=aux_fit_month,
            source=self._source_metadata(target_ns, cutoff_ns, freeze_ns),
            pending_update=pending_update,
        )


    # ------------------------------------------------------- meta / auxiliary
    def _meta_and_auxiliary(
        self,
        frame: pd.DataFrame,
        direction_features: dict[str, float],
        target_open: datetime,
        freeze_ns: int,
    ) -> tuple[dict[str, float], dict[str, float], str]:
        """The 51-column correctness frame and the four auxiliary inputs.

        `metaframe` consumes the direction head's own probability and proposal,
        so the applicable C71_DIRECTION head is scored here with exactly the
        engine's `score_head`; the engine re-scores it identically, so the two
        cannot disagree. The auxiliary block is real inference with the monthly
        LONG/RECENT bundles over `auxiliary_source.features`, never a constant.
        """
        from .engine import proposal_from_probability, score_head

        if self.artifacts is None:
            raise FeatureUnavailable(
                "C85_ARTIFACTS_NOT_WIRED: the packet source needs the artifact store to "
                "score the direction head the meta frame is conditioned on"
            )
        head = self.artifacts.head_for("C71_DIRECTION", target_open)
        if head is None:
            raise FeatureUnavailable(
                f"C85_NO_APPLICABLE_FIT: C71_DIRECTION for {target_open.date()}"
            )
        probability = np.array([score_head(head.bundle, direction_features)], dtype=float)
        proposal = np.array([proposal_from_probability(float(probability[0]))], dtype=float)

        aux_row, month = self._auxiliary_row(target_open, freeze_ns)
        logits = auxiliary_logits(aux_row)
        meta = metaframe(frame, probability, proposal)
        auxiliary = {
            column: float(
                logits[column].iloc[0] * (proposal[0] if column.endswith("logit") else 1.0)
            )
            for column in logits.columns
        }
        return (
            {k: float(v) for k, v in meta.iloc[0].items()},
            auxiliary,
            month,
        )

    def _auxiliary_row(self, target_open: datetime, freeze_ns: int) -> tuple[pd.DataFrame, str]:
        """Live auxiliary inference from received BTCUSDT minutes ending T-1ms."""
        klines = getattr(self.feeds, "klines", {})
        spot_1m = klines.get("binance_1m")
        target_ms = int(target_open.timestamp() * 1000)
        minutes = (
            spot_1m.window(target_ms - AUX_LOOKBACK_MINUTES * MINUTE_MS, target_ms - MINUTE_MS, freeze_ns)
            if spot_1m
            else []
        )
        if len(minutes) < AUX_LOOKBACK_MINUTES:
            raise FeatureUnavailable(
                "C85_AUXILIARY_MINUTES_INCOMPLETE: the auxiliary block reads 240 completed "
                f"BTCUSDT minutes ending at T-1ms; {len(minutes)} were received by the "
                "freeze and the history is not padded"
            )
        frame = pd.DataFrame(
            [
                {
                    "open_time": k.open_ms,
                    "close_time": k.close_ms,
                    "open": k.open,
                    "high": k.high,
                    "low": k.low,
                    "close": k.close,
                    "volume": k.base_volume,
                    "quote_volume": k.quote_volume,
                    "count": float(k.trade_count),
                    # auxiliary_source.features reads `taker_buy`, not
                    # `taker_buy_base`; the archive builder used that name.
                    "taker_buy": k.taker_buy_base,
                }
                for k in minutes
            ]
        )
        aux = auxiliary_features(frame)
        aux = aux.loc[aux["ts"] == target_open]
        if aux.empty:
            raise FeatureUnavailable(
                "C85_AUXILIARY_NO_TARGET_ROW: the auxiliary frame produced no row for this "
                "boundary"
            )
        month = f"{target_open.year:04d}{target_open.month:02d}"
        order, classifier, regressor, _ = self.artifacts.auxiliary_bundle(month, "LONG")
        features_x = aux.loc[:, order].to_numpy(float)
        out = aux.copy()
        out["LONG_p"] = classifier.predict_proba(features_x)[:, 1]
        out["LONG_logscale"] = regressor.predict(features_x)
        _, r_clf, r_reg, _ = self.artifacts.auxiliary_bundle(month, "RECENT")
        out["RECENT_p"] = r_clf.predict_proba(features_x)[:, 1]
        out["RECENT_logscale"] = r_reg.predict(features_x)
        return out, month

    # ---------------------------------------------------------------- validity
    def _validity(
        self, frame: pd.DataFrame, leaf_outputs: dict[str, Any], market_q1: bool
    ) -> dict[str, bool]:
        """The complete boolean map the engine and the store both read.

        Each entry is computed from the original validity rule on received data.
        `structure_valid` is the inherited C75->C79/C81 result and is taken from
        the chain, never defaulted true.
        """
        anchor = bool(frame_anchor_valid(frame).iloc[0])
        return {
            "binance_complete": bool(frame["binance_complete"].iloc[0]),
            "anchor_valid": anchor,
            "quote_source_valid": bool(frame["quote_source_valid"].iloc[0]),
            "index_source_checked_valid": bool(frame["index_source_checked_valid"].iloc[0]),
            "cm_valid": bool(cm_valid(frame)[0]),
            "auxiliary_valid": bool(frame["valid"].iloc[0]) if "valid" in frame else False,
            "source_ok": bool(leaf_outputs.get("source_ok", False)),
            "structure_valid": bool(leaf_outputs.get("structure_valid", False)),
            "market_q1": bool(market_q1),
        }

    # ---------------------------------------------------------------- metadata
    def _source_metadata(self, target_ns: int, cutoff_ns: int, freeze_ns: int) -> dict[str, Any]:
        """Honest provenance: what was frozen, when, and whether it was on time."""
        watermarks = self.feeds.watermarks(freeze_ns) if hasattr(self.feeds, "watermarks") else {}
        receipts = [
            int(w["last_receipt_ns"])
            for w in watermarks.values()
            if isinstance(w, dict) and w.get("last_receipt_ns") not in (None, "-1")
        ]
        return {
            "mode": "live",
            "target_open_ns": target_ns,
            "event_window_end_ns": cutoff_ns,
            "deadline_ns": cutoff_ns,
            "freeze_ns": freeze_ns,
            "late_by_ns": max(0, freeze_ns - cutoff_ns),
            "on_time": freeze_ns == cutoff_ns,
            "last_receipt_ns": max(receipts) if receipts else None,
            "feed_watermarks": watermarks,
        }

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

