"""Binance spot/UM raw aggTrade window aggregation — the model's own producer.

SOURCE INVENTORY (the only authority; nothing here is invented)
--------------------------------------------------------------
producer   build_multivenue_features_r1.py
           sha256 c3acb1ea58fd77d36f49aef870ec3c0d230e949c47fb329820de752a99d2b446
           recovered copy: /mnt/documents/.lovable/c85-cache/upx/ancestor/
                           source/6cf37dff6f5a/build_multivenue_features_r1.py
functions  read_binance_archive (169-220), standardized_event_aggregate (67-131),
           aggregate_event_windows (133-166), the cross-venue block of
           build_binance (247-259), merge_frames (57-64)
raw inputs raw/binance_spot/*.zip and raw/binance_um/*.zip — Binance public
           daily aggTrade archives (data.binance.vision). Spot: headerless,
           8 columns, `transact_time` in MICROseconds. UM: header row,
           7 columns, `transact_time` in MILLIseconds (multiplied by 1000).
           Fields used: price, quantity, first_trade_id, last_trade_id,
           transact_time, is_buyer_maker. No other field exists in the source
           and none is invented here.
contract   "T0 windows end strictly before T. T+5 windows include exchange
           events timestamped in [T,T+5s)." (build_binance audit, line 268)

UNITS AND BOUNDS, copied exactly
--------------------------------
* All arithmetic is in integer microseconds; FIFTEEN_MIN_US = 900_000_000,
  ONE_SECOND_US = 1_000_000.
* bucket = (ts_us // FIFTEEN_MIN_US) * FIFTEEN_MIN_US; offset = ts_us - bucket.
* T0 window of `s` seconds: `offset >= FIFTEEN_MIN_US - s*ONE_SECOND_US`,
  attributed to target `bucket + FIFTEEN_MIN_US` — i.e. the half-open interval
  [T-s, T), ending strictly before T.
* T+5 window of `s` seconds: `offset < s*ONE_SECOND_US`, attributed to target
  `bucket` — i.e. [T, T+s), half-open, so an event exactly at T+5s belongs to
  the NEXT target's T0 side and never to this one.
* Sign: `is_buyer_maker` true => -1 (aggressive sell), false => +1. Quantity is
  base volume; quote = price * quantity. `underlying_n` =
  last_trade_id - first_trade_id + 1.
* Missing data is never imputed: an empty window produces no row (the original
  returns an empty frame), and a zero quote volume becomes NaN through
  `replace(0, np.nan)` before every ratio.

EVENT TIME vs RECEIPT TIME
--------------------------
The archive audit states plainly: "Binance archives expose exchange timestamps
only; no collector timestamp is available." So event time is the ONLY clock in
the historical path, and the archive mode below applies no receipt filter --
claiming one would be fabricated provenance. The live accumulator records a
receipt timestamp per event and, in LIVE mode, admits only events whose receipt
preceded the packet freeze, while window membership is still decided by event
time. That keeps the model rule and the availability rule separate.

WHAT THIS IS / IS NOT
---------------------
This IS the raw-tape producer for the `binance_*_t0_*` / `binance_*_t5_*` /
`binance_cross_*` columns: raw exchange events in, feature columns out.
`direction_matrix.py` is the *derived* transform that consumes those columns; it
is not raw-feed inference on its own.
It is NOT a complete live packet: Deribit and Hyperliquid raw producers, the
fitted direction pipeline selection, and the nine leaf outputs remain missing.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd

FIFTEEN_MIN_US = 900_000_000
ONE_SECOND_US = 1_000_000

T0_WINDOW_SECONDS = (5, 15, 30, 60, 180, 900)
T5_WINDOW_SECONDS = (1, 2, 3, 5)

#: Longest look-back any window needs, in microseconds (the 900s T0 window).
RETENTION_US = max(T0_WINDOW_SECONDS) * ONE_SECOND_US

RAW_COLUMNS = ("ts_us", "price", "quantity", "quote", "signed", "underlying_n")


# --------------------------------------------------------------------------
# verbatim transcriptions
# --------------------------------------------------------------------------
def merge_frames(frames: list[pd.DataFrame], key: str = "target_ts") -> pd.DataFrame:
    """build_multivenue_features_r1.py lines 57-64, verbatim."""
    usable = [frame for frame in frames if frame is not None and not frame.empty]
    if not usable:
        return pd.DataFrame(columns=[key])
    result = usable[0]
    for frame in usable[1:]:
        result = result.merge(frame, on=key, how="outer", validate="one_to_one")
    return result.sort_values(key).reset_index(drop=True)


def standardized_event_aggregate(
    frame: pd.DataFrame, *, mask: np.ndarray, target_us: np.ndarray, prefix: str
) -> pd.DataFrame:
    """build_multivenue_features_r1.py lines 67-131, verbatim."""
    columns = ["ts_us", "price", "quantity", "quote", "signed", "underlying_n"]
    subset = frame.loc[mask, columns].copy()
    if subset.empty:
        return pd.DataFrame(columns=["target_us"])
    subset["target_us"] = target_us[mask]
    subset["signed_quote"] = subset["signed"] * subset["quote"]
    subset["signed_count"] = subset["signed"]
    subset["quote_sq"] = subset["quote"] ** 2
    subset["buy_quote"] = np.where(subset["signed"] > 0, subset["quote"], 0.0)
    subset["sell_quote"] = np.where(subset["signed"] < 0, subset["quote"], 0.0)

    grouped = subset.groupby("target_us", sort=True, observed=True)
    output = grouped.agg(
        event_count=("price", "size"),
        underlying_trade_count=("underlying_n", "sum"),
        base_volume=("quantity", "sum"),
        quote_volume=("quote", "sum"),
        signed_quote=("signed_quote", "sum"),
        signed_event_count=("signed_count", "sum"),
        buy_quote=("buy_quote", "sum"),
        sell_quote=("sell_quote", "sum"),
        first_price=("price", "first"),
        last_price=("price", "last"),
        high_price=("price", "max"),
        low_price=("price", "min"),
        quote_sq_sum=("quote_sq", "sum"),
        max_trade_quote=("quote", "max"),
        first_event_us=("ts_us", "min"),
        last_event_us=("ts_us", "max"),
    ).reset_index()
    denominator = output["quote_volume"].replace(0, np.nan)
    output["flow_imbalance"] = output["signed_quote"] / denominator
    output["aggressive_buy_share"] = output["buy_quote"] / denominator
    output["trade_hhi"] = output["quote_sq_sum"] / (denominator**2)
    output["max_trade_share"] = output["max_trade_quote"] / denominator
    output["return_bps"] = 10_000.0 * (output["last_price"] / output["first_price"] - 1.0)
    output["range_bps"] = 10_000.0 * (output["high_price"] / output["low_price"] - 1.0)
    output["price_flow_alignment"] = np.sign(output["return_bps"]) * np.sign(output["signed_quote"])

    subset["second"] = subset["ts_us"] // ONE_SECOND_US
    per_second = subset.groupby(["target_us", "second"], observed=True).agg(
        second_event_count=("price", "size"),
        second_abs_signed_quote=("signed_quote", lambda values: abs(values.sum())),
    )
    burst = per_second.groupby(level=0).agg(
        max_events_one_second=("second_event_count", "max"),
        max_abs_flow_one_second=("second_abs_signed_quote", "max"),
    ).reset_index()
    output = output.merge(burst, on="target_us", how="left", validate="one_to_one")

    raw_fields = {"quote_sq_sum", "max_trade_quote", "first_price", "last_price", "high_price", "low_price"}
    keep = ["target_us"] + [c for c in output.columns if c != "target_us" and c not in raw_fields]
    output = output[keep].rename(columns={c: f"{prefix}_{c}" for c in keep if c != "target_us"})
    return output


def aggregate_event_windows(frame: pd.DataFrame, *, venue_prefix: str) -> pd.DataFrame:
    """build_multivenue_features_r1.py lines 133-166, verbatim."""
    ts_us = frame["ts_us"].to_numpy(np.int64)
    bucket = (ts_us // FIFTEEN_MIN_US) * FIFTEEN_MIN_US
    offset = ts_us - bucket
    pieces: list[pd.DataFrame] = []
    for seconds in T0_WINDOW_SECONDS:
        mask = offset >= FIFTEEN_MIN_US - seconds * ONE_SECOND_US
        target = bucket + FIFTEEN_MIN_US
        pieces.append(
            standardized_event_aggregate(
                frame, mask=mask, target_us=target, prefix=f"{venue_prefix}_t0_w{seconds:03d}"
            )
        )
    for seconds in T5_WINDOW_SECONDS:
        mask = offset < seconds * ONE_SECOND_US
        pieces.append(
            standardized_event_aggregate(
                frame, mask=mask, target_us=bucket, prefix=f"{venue_prefix}_t5_w{seconds:03d}"
            )
        )
    result = merge_frames(pieces, key="target_us")
    result["target_ts"] = pd.to_datetime(result.pop("target_us"), unit="us", utc=True)
    return result


def read_binance_archive(path: Path, venue: str) -> pd.DataFrame:
    """build_multivenue_features_r1.py lines 169-220, verbatim."""
    columns = [
        "agg_trade_id", "price", "quantity", "first_trade_id",
        "last_trade_id", "transact_time", "is_buyer_maker",
    ]
    dtype = {
        "price": "float64", "quantity": "float64", "first_trade_id": "int64",
        "last_trade_id": "int64", "transact_time": "int64",
    }
    if venue == "spot":
        names = columns + ["is_best_match"]
        frame = pd.read_csv(path, compression="zip", header=None, names=names,
                            usecols=columns, dtype=dtype, low_memory=False)
        ts_us = frame["transact_time"].to_numpy(np.int64)
    else:
        frame = pd.read_csv(path, compression="zip", header=0, usecols=columns,
                            dtype=dtype, low_memory=False)
        ts_us = frame["transact_time"].to_numpy(np.int64) * 1000
    maker = frame["is_buyer_maker"].astype(str).str.lower().eq("true").to_numpy()
    result = pd.DataFrame(
        {
            "ts_us": ts_us,
            "price": frame["price"].to_numpy(float),
            "quantity": frame["quantity"].to_numpy(float),
            "underlying_n": (frame["last_trade_id"] - frame["first_trade_id"] + 1).to_numpy(np.int64),
            "signed": np.where(maker, -1.0, 1.0),
        }
    )
    result["quote"] = result["price"] * result["quantity"]
    return result


def cross_venue_features(result: pd.DataFrame) -> pd.DataFrame:
    """The cross-venue block of build_binance, lines 247-259, verbatim."""
    for horizon in ("t0", "t5"):
        spot_flow = f"binance_spot_{horizon}_w005_flow_imbalance"
        um_flow = f"binance_um_{horizon}_w005_flow_imbalance"
        spot_ret = f"binance_spot_{horizon}_w005_return_bps"
        um_ret = f"binance_um_{horizon}_w005_return_bps"
        if all(c in result for c in (spot_flow, um_flow)):
            result[f"binance_cross_{horizon}_flow_agreement_5s"] = np.sign(result[spot_flow]) * np.sign(result[um_flow])
            result[f"binance_cross_{horizon}_flow_gap_5s"] = result[spot_flow] - result[um_flow]
        if all(c in result for c in (spot_ret, um_ret)):
            result[f"binance_cross_{horizon}_return_agreement_5s"] = np.sign(result[spot_ret]) * np.sign(result[um_ret])
            result[f"binance_cross_{horizon}_return_gap_5s"] = result[spot_ret] - result[um_ret]
    return result


def build_binance_features(spot: pd.DataFrame | None, um: pd.DataFrame | None) -> pd.DataFrame:
    """Both venues plus the cross columns, in the original merge order."""
    frames = []
    for venue, raw in (("spot", spot), ("um", um)):
        if raw is None or raw.empty:
            continue
        frames.append(
            aggregate_event_windows(raw, venue_prefix=f"binance_{venue}")
            .drop_duplicates("target_ts", keep="last")
        )
    return cross_venue_features(merge_frames(frames))


# --------------------------------------------------------------------------
# live accumulator
# --------------------------------------------------------------------------
@dataclass
class VenueBuffer:
    """Bounded raw-event buffer for one venue, keyed by agg_trade_id.

    * De-duplication is by `agg_trade_id`; a repeated delivery of the same
      aggregate trade is dropped, never double-counted.
    * Out-of-order receipt is fine: membership is decided by EVENT time, and
      the buffer is sorted by event time before aggregation, exactly as the
      archive path is.
    * Retention is the longest window (900s) plus the current T+5 tail, so a
      restart that reloads this buffer reproduces the same features.
    """

    venue: str
    events: dict[int, dict[str, float]] = field(default_factory=dict)

    def add(self, *, agg_trade_id: int, price: float, quantity: float,
            first_trade_id: int, last_trade_id: int, transact_time: int,
            is_buyer_maker: bool, receipt_ns: int | None = None) -> bool:
        """Raw exchange fields only — the same seven the archive exposes.

        `transact_time` is in the venue's native unit (spot microseconds, UM
        milliseconds), converted here exactly as `read_binance_archive` does.
        Returns False when the event was a duplicate.
        """
        if agg_trade_id in self.events:
            return False
        ts_us = int(transact_time) if self.venue == "spot" else int(transact_time) * 1000
        price = float(price)
        quantity = float(quantity)
        self.events[int(agg_trade_id)] = {
            "ts_us": ts_us,
            "price": price,
            "quantity": quantity,
            "underlying_n": int(last_trade_id) - int(first_trade_id) + 1,
            "signed": -1.0 if bool(is_buyer_maker) else 1.0,
            "quote": price * quantity,
            "receipt_ns": -1 if receipt_ns is None else int(receipt_ns),
        }
        return True

    def prune(self, keep_from_us: int) -> None:
        for key in [k for k, e in self.events.items() if e["ts_us"] < keep_from_us]:
            del self.events[key]

    def frame(self, *, freeze_ns: int | None = None) -> pd.DataFrame:
        rows = [
            e for e in self.events.values()
            # Availability, kept separate from the model's window rule: in LIVE
            # mode an event that had not been RECEIVED by the freeze instant did
            # not legitimately exist for this decision, whatever its event time.
            if freeze_ns is None or e["receipt_ns"] < 0 or e["receipt_ns"] <= freeze_ns
        ]
        if not rows:
            return pd.DataFrame(columns=list(RAW_COLUMNS))
        frame = pd.DataFrame(rows).sort_values(["ts_us"], kind="stable").reset_index(drop=True)
        return frame[list(RAW_COLUMNS)]

    def to_dict(self) -> dict[str, Any]:
        return {"venue": self.venue, "events": {str(k): v for k, v in self.events.items()}}

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "VenueBuffer":
        return cls(
            venue=payload["venue"],
            events={int(k): dict(v) for k, v in (payload.get("events") or {}).items()},
        )


class BinanceWindowAccumulator:
    """Rolling raw-event state for the live path.

    Feature construction runs the SAME verbatim aggregation used for archives,
    over the retained raw events, so the live and historical paths cannot drift.
    """

    def __init__(self) -> None:
        self.buffers = {venue: VenueBuffer(venue) for venue in ("spot", "um")}

    def add(self, venue: str, **event: Any) -> bool:
        return self.buffers[venue].add(**event)

    def ingest_archive(self, venue: str, path: Path) -> int:
        """Seed the buffer from a publisher archive (historical/bootstrap only).

        `read_binance_archive` drops `agg_trade_id`, so archive rows are keyed by
        a local sequence. They carry no receipt timestamp — the archives expose
        exchange timestamps only — so `receipt_ns` stays -1 (unknown), and LIVE
        availability filtering does not silently pretend otherwise.
        """
        raw = read_binance_archive(Path(path), venue)
        buffer = self.buffers[venue]
        base = min(buffer.events, default=0)
        for offset, row in enumerate(raw.itertuples(index=False), start=1):
            buffer.events[base - offset] = {
                "ts_us": int(row.ts_us), "price": float(row.price),
                "quantity": float(row.quantity), "underlying_n": int(row.underlying_n),
                "signed": float(row.signed), "quote": float(row.quote), "receipt_ns": -1,
            }
        return len(raw)

    def prune(self, target_us: int) -> None:
        """Drop anything older than the longest window needs for this target."""
        for buffer in self.buffers.values():
            buffer.prune(target_us - RETENTION_US)

    def has_history(self, target_us: int, venue: str = "spot") -> bool:
        """False when the buffer cannot cover the 900s T0 window for this target."""
        events = self.buffers[venue].events
        if not events:
            return False
        return min(e["ts_us"] for e in events.values()) <= target_us - RETENTION_US

    def features_for(self, target_us: int, *, freeze_ns: int | None = None) -> dict[str, float | None]:
        """The Binance columns for exactly one target. Missing => absent, not zero."""
        built = build_binance_features(
            self.buffers["spot"].frame(freeze_ns=freeze_ns),
            self.buffers["um"].frame(freeze_ns=freeze_ns),
        )
        if built.empty or "target_ts" not in built:
            return {}
        want = pd.Timestamp(target_us, unit="us", tz="UTC")
        rows = built.loc[built["target_ts"] == want]
        if rows.empty:
            return {}
        row = rows.iloc[0].drop(labels=["target_ts"])
        return {name: (None if pd.isna(value) else float(value)) for name, value in row.items()}

    # -- rolling state ------------------------------------------------------
    def to_dict(self) -> dict[str, Any]:
        return {venue: buffer.to_dict() for venue, buffer in self.buffers.items()}

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "BinanceWindowAccumulator":
        self = cls()
        for venue, buffer in (payload or {}).items():
            self.buffers[venue] = VenueBuffer.from_dict(buffer)
        return self

    def dumps(self) -> str:
        return json.dumps(self.to_dict(), separators=(",", ":"), sort_keys=True)

    @classmethod
    def loads(cls, blob: str) -> "BinanceWindowAccumulator":
        return cls.from_dict(json.loads(blob))
