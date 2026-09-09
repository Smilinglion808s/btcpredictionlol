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
# transport adapters
# --------------------------------------------------------------------------
# Timestamp units are a property of the TRANSPORT, not of the venue. Observed,
# not assumed (probe saved at
# /mnt/documents/.lovable/c85-cache/transport_probes/binance_timestamp_units.json):
#
#   spot daily aggTrades CSV   transact_time = MICROseconds  (archive parity)
#   um   daily aggTrades CSV   transact_time = MILLIseconds  (archive parity)
#   spot REST /api/v3/aggTrades          T = MILLIseconds (13 digits, observed)
#   um   REST /fapi/v1/aggTrades         T = MILLIseconds (13 digits, observed)
#   spot WS  btcusdt@aggTrade            T = MILLIseconds (13 digits, observed)
#   um   WS  btcusdt@aggTrade            NOT observed from this sandbox
#            (egress timeout). Declared ms on the strength of the UM REST
#            observation and the shared payload schema; the adapter's range
#            check rejects the value outright if that is ever wrong, and this
#            gap is reported rather than hidden.
#
# `spot_archive_csv` and `spot_ws_aggTrade` therefore differ in unit for the
# SAME venue, which is exactly what the previous venue-keyed conversion got
# wrong. Nothing here derives a unit from the venue name.

#: Plausible event-time band, used to catch a mis-declared unit instead of
#: silently producing a 1970 or year-58000 timestamp. 2020-01-01 .. 2035-01-01.
_MIN_TS_US = 1_577_836_800_000_000
_MAX_TS_US = 2_051_222_400_000_000


class TransportError(ValueError):
    """A payload that does not satisfy its declared schema. Never coerced."""


def _as_int(value: Any, field_name: str) -> int:
    if isinstance(value, bool) or value is None:
        raise TransportError(f"{field_name}: expected an integer, got {value!r}")
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    raise TransportError(f"{field_name}: expected an integer, got {value!r}")


def _as_float(value: Any, field_name: str) -> float:
    if isinstance(value, bool) or value is None:
        raise TransportError(f"{field_name}: expected a number, got {value!r}")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise TransportError(f"{field_name}: expected a number, got {value!r}") from exc
    if not np.isfinite(number):
        raise TransportError(f"{field_name}: expected a finite number, got {value!r}")
    return number


def _as_bool(value: Any, field_name: str) -> bool:
    """Strict. `bool('false')` is True in Python; that must never decide a side."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip().lower() in ("true", "false"):
        return value.strip().lower() == "true"
    raise TransportError(f"{field_name}: expected a boolean, got {value!r}")


_UNIT_MULTIPLIER = {"us": 1, "ms": 1000}


@dataclass(frozen=True)
class Transport:
    """Schema + unit metadata for one concrete source of aggregate trades."""

    name: str
    venue: str
    time_unit: str            # "us" | "ms"
    fields: dict[str, str]    # canonical name -> payload key
    provenance: str           # "live" | "archive" | "bootstrap"
    receipt_available: bool

    def to_us(self, raw_time: Any) -> int:
        ts_us = _as_int(raw_time, f"{self.name}.{self.fields['transact_time']}")
        ts_us *= _UNIT_MULTIPLIER[self.time_unit]
        if not _MIN_TS_US <= ts_us <= _MAX_TS_US:
            raise TransportError(
                f"{self.name}: event time {ts_us} us is outside the plausible band - "
                f"the declared unit '{self.time_unit}' does not match the payload"
            )
        return ts_us

    def parse(self, payload: dict[str, Any], *, receipt_ns: int | None = None) -> dict[str, Any]:
        keys = self.fields
        first = _as_int(payload[keys["first_trade_id"]], "first_trade_id")
        last = _as_int(payload[keys["last_trade_id"]], "last_trade_id")
        if last < first:
            raise TransportError(f"{self.name}: last_trade_id {last} < first_trade_id {first}")
        price = _as_float(payload[keys["price"]], "price")
        quantity = _as_float(payload[keys["quantity"]], "quantity")
        maker = _as_bool(payload[keys["is_buyer_maker"]], "is_buyer_maker")
        if self.receipt_available and receipt_ns is None:
            raise TransportError(f"{self.name}: a live transport must supply receipt_ns")
        return {
            "agg_trade_id": _as_int(payload[keys["agg_trade_id"]], "agg_trade_id"),
            "ts_us": self.to_us(payload[keys["transact_time"]]),
            "price": price,
            "quantity": quantity,
            "underlying_n": last - first + 1,
            "signed": -1.0 if maker else 1.0,
            "quote": price * quantity,
            "receipt_ns": -1 if receipt_ns is None else _as_int(receipt_ns, "receipt_ns"),
            "provenance": self.provenance,
        }


_WS_FIELDS = {
    "agg_trade_id": "a", "price": "p", "quantity": "q", "first_trade_id": "f",
    "last_trade_id": "l", "transact_time": "T", "is_buyer_maker": "m",
}
_ARCHIVE_FIELDS = {
    "agg_trade_id": "agg_trade_id", "price": "price", "quantity": "quantity",
    "first_trade_id": "first_trade_id", "last_trade_id": "last_trade_id",
    "transact_time": "transact_time", "is_buyer_maker": "is_buyer_maker",
}

TRANSPORTS: dict[str, Transport] = {
    t.name: t
    for t in (
        Transport("spot_ws_aggTrade", "spot", "ms", _WS_FIELDS, "live", True),
        Transport("um_ws_aggTrade", "um", "ms", _WS_FIELDS, "live", True),
        Transport("spot_rest_aggTrades", "spot", "ms", _WS_FIELDS, "live", True),
        Transport("um_rest_aggTrades", "um", "ms", _WS_FIELDS, "live", True),
        # Bootstrap: a REST back-fill replayed at start-up. Real ids, real event
        # times, and an explicitly recorded availability instant supplied by the
        # caller - never an invented per-event receipt time.
        Transport("spot_rest_bootstrap", "spot", "ms", _WS_FIELDS, "bootstrap", False),
        Transport("um_rest_bootstrap", "um", "ms", _WS_FIELDS, "bootstrap", False),
        Transport("spot_archive_csv", "spot", "us", _ARCHIVE_FIELDS, "archive", False),
        Transport("um_archive_csv", "um", "ms", _ARCHIVE_FIELDS, "archive", False),
    )
}


# --------------------------------------------------------------------------
# live accumulator
# --------------------------------------------------------------------------
HISTORICAL = "HISTORICAL"   # event-time replay; no availability filter exists
LIVE = "LIVE"               # only observations provably available by the freeze


@dataclass
class VenueBuffer:
    """Bounded raw-event buffer for one venue, keyed by the AUTHENTIC agg_trade_id.

    * De-duplication is by exchange `agg_trade_id`, so the same aggregate trade
      delivered twice - by a repeat websocket frame, by a REST back-fill that
      overlaps the live stream, or by re-ingesting a daily archive - is stored
      once and counted once.
    * Ordering is `(ts_us, agg_trade_id)`, not insertion order. Aggregate trade
      ids are monotonic per venue, so this reproduces the archive's own row
      order exactly (verified against the publisher file) and makes first/last
      price independent of the order in which frames were received.
    * Availability: every event carries `receipt_ns` (-1 = unknown) and a
      provenance tag. In LIVE mode an event with unknown availability is
      EXCLUDED and counted, never quietly admitted.
    """

    venue: str
    events: dict[int, dict[str, Any]] = field(default_factory=dict)
    #: Half-open [start_ns, end_ns) intervals of receipt-clock time during which
    #: this feed was known to be down. Recorded by the collector, never guessed.
    gaps: list[tuple[int, int]] = field(default_factory=list)
    #: Half-open [start_us, end_us) EVENT-time intervals the acquisition can
    #: PROVE it enumerated: a websocket session between connect and disconnect,
    #: a completed REST pagination sweep, or a publisher daily archive. This is
    #: evidence supplied by the collector, never inferred from the events on
    #: hand — a single ancient trade says nothing about whether the tape either
    #: side of it was captured.
    coverage: list[tuple[int, int, str]] = field(default_factory=list)
    #: Identical duplicates whose availability was merged, and duplicates whose
    #: economic fields disagreed (quarantined, never overwritten).
    merged_duplicates: int = 0
    conflicts: list[dict[str, Any]] = field(default_factory=list)
    excluded_unknown_availability: int = 0

    #: The fields that identify the trade itself. Availability and provenance
    #: are metadata about DELIVERY and are merged; these are not.
    ECONOMIC_FIELDS = ("ts_us", "price", "quantity", "underlying_n", "signed", "quote")

    # -- ingestion ----------------------------------------------------------
    def add_event(self, event: dict[str, Any]) -> bool:
        """Store one aggregate trade. Returns True only for a genuinely NEW id.

        A repeat of an id already held is not simply dropped. The same trade
        routinely arrives twice by different roads — an archive replay with no
        collector clock, then the live socket, or a REST back-fill overlapping
        the stream — and dropping the second copy unconditionally left the row
        permanently stamped "availability unknown", so LIVE mode excluded it
        forever even though its arrival time was later proven. So:

          * identical economic fields -> merge DELIVERY metadata only. The
            availability becomes the earliest KNOWN receipt; an unknown (-1)
            never displaces a known one and a later replay never back-dates a
            receipt below one already recorded from a real delivery.
          * disagreeing economic fields -> quarantine. The stored event is left
            untouched and the conflicting payload is recorded for reporting.
        """
        key = int(event["agg_trade_id"])
        stored = self.events.get(key)
        if stored is None:
            fresh = dict(event)
            fresh.pop("agg_trade_id", None)
            self.events[key] = fresh
            return True

        if any(stored[f] != event[f] for f in self.ECONOMIC_FIELDS):
            self.conflicts.append({
                "agg_trade_id": key,
                "stored": {f: stored[f] for f in self.ECONOMIC_FIELDS},
                "rejected": {f: event[f] for f in self.ECONOMIC_FIELDS},
                "rejected_provenance": event.get("provenance"),
            })
            return False

        incoming = int(event.get("receipt_ns", -1))
        current = int(stored.get("receipt_ns", -1))
        if incoming >= 0 and (current < 0 or incoming < current):
            stored["receipt_ns"] = incoming
            stored["provenance"] = event.get("provenance", stored.get("provenance"))
        self.merged_duplicates += 1
        return False

    def add_payload(self, transport: Transport, payload: dict[str, Any],
                    *, receipt_ns: int | None = None) -> bool:
        if transport.venue != self.venue:
            raise TransportError(f"{transport.name} is not a {self.venue} transport")
        return self.add_event(transport.parse(payload, receipt_ns=receipt_ns))

    def mark_gap(self, start_ns: int, end_ns: int) -> None:
        """Record a known outage on the receipt clock (disconnect .. reconnect)."""
        if end_ns > start_ns:
            self.gaps.append((int(start_ns), int(end_ns)))

    def declare_coverage(self, start_us: int, end_us: int, source: str) -> None:
        """Record PROVEN enumeration of [start_us, end_us) in event time."""
        if end_us <= start_us:
            return
        merged = sorted(self.coverage + [(int(start_us), int(end_us), str(source))])
        collapsed: list[tuple[int, int, str]] = []
        for interval in merged:
            if collapsed and interval[0] <= collapsed[-1][1] and interval[2] == collapsed[-1][2]:
                previous = collapsed[-1]
                collapsed[-1] = (previous[0], max(previous[1], interval[1]), previous[2])
            else:
                collapsed.append(interval)
        self.coverage = collapsed

    def covers(self, start_us: int, end_us: int) -> bool:
        """True only when declared coverage spans ALL of [start_us, end_us)."""
        cursor = int(start_us)
        for a, b, _ in sorted(self.coverage):
            if a > cursor:
                return False
            cursor = max(cursor, b)
            if cursor >= int(end_us):
                return True
        return cursor >= int(end_us)

    # -- retention ----------------------------------------------------------
    def prune(self, keep_from_us: int) -> None:
        for key in [k for k, e in self.events.items() if e["ts_us"] < keep_from_us]:
            del self.events[key]
        self.coverage = [
            (max(a, int(keep_from_us)), b, s)
            for a, b, s in self.coverage
            if b > int(keep_from_us)
        ]

    # -- reading ------------------------------------------------------------
    def frame(self, *, mode: str = HISTORICAL, freeze_ns: int | None = None) -> pd.DataFrame:
        if mode not in (HISTORICAL, LIVE):
            raise ValueError(f"unknown availability mode {mode!r}")
        if mode == LIVE and freeze_ns is None:
            raise ValueError("LIVE mode requires the packet freeze instant")
        rows: list[dict[str, Any]] = []
        unknown = 0
        for key, event in self.events.items():
            if mode == LIVE:
                receipt = int(event["receipt_ns"])
                if receipt < 0:
                    unknown += 1
                    continue
                if receipt > int(freeze_ns):  # type: ignore[arg-type]
                    continue
            rows.append({**event, "agg_trade_id": key})
        self.excluded_unknown_availability = unknown
        if not rows:
            return pd.DataFrame(columns=list(RAW_COLUMNS))
        frame = (
            pd.DataFrame(rows)
            .sort_values(["ts_us", "agg_trade_id"], kind="stable")
            .reset_index(drop=True)
        )
        return frame[list(RAW_COLUMNS)]

    def gap_overlaps(self, start_ns: int, end_ns: int) -> list[tuple[int, int]]:
        return [(a, b) for a, b in self.gaps if b > start_ns and a < end_ns]

    # -- state --------------------------------------------------------------
    def to_dict(self) -> dict[str, Any]:
        return {
            "venue": self.venue,
            "events": {str(k): v for k, v in self.events.items()},
            "gaps": [[a, b] for a, b in self.gaps],
            "coverage_start_us": self.coverage_start_us,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "VenueBuffer":
        return cls(
            venue=payload["venue"],
            events={int(k): dict(v) for k, v in (payload.get("events") or {}).items()},
            gaps=[(int(a), int(b)) for a, b in (payload.get("gaps") or [])],
            coverage_start_us=payload.get("coverage_start_us"),
        )


def read_binance_archive_raw(path: Path, venue: str) -> pd.DataFrame:
    """`read_binance_archive` plus the authentic `agg_trade_id`.

    The feature columns are untouched - the id is carried alongside them purely
    so buffer ingestion can de-duplicate against the live stream.
    """
    columns = [
        "agg_trade_id", "price", "quantity", "first_trade_id",
        "last_trade_id", "transact_time", "is_buyer_maker",
    ]
    dtype = {
        "agg_trade_id": "int64", "price": "float64", "quantity": "float64",
        "first_trade_id": "int64", "last_trade_id": "int64", "transact_time": "int64",
    }
    if venue == "spot":
        frame = pd.read_csv(path, compression="zip", header=None,
                            names=columns + ["is_best_match"], usecols=columns,
                            dtype=dtype, low_memory=False)
    else:
        frame = pd.read_csv(path, compression="zip", header=0, usecols=columns,
                            dtype=dtype, low_memory=False)
    features = read_binance_archive(path, venue)
    features["agg_trade_id"] = frame["agg_trade_id"].to_numpy(np.int64)
    return features


class BinanceWindowAccumulator:
    """Rolling raw-event state for the live path.

    Feature construction runs the SAME verbatim aggregation used for archives,
    over the retained raw events, so the live and historical paths cannot drift.
    """

    def __init__(self) -> None:
        self.buffers = {venue: VenueBuffer(venue) for venue in ("spot", "um")}
        #: Targets whose packet has not been produced yet. Retention never drops
        #: an input any pending target still needs.
        self.pending_targets: set[int] = set()

    # -- ingestion ----------------------------------------------------------
    def ingest(self, transport_name: str, payload: dict[str, Any],
               *, receipt_ns: int | None = None) -> bool:
        transport = TRANSPORTS[transport_name]
        return self.buffers[transport.venue].add_payload(
            transport, payload, receipt_ns=receipt_ns
        )

    def ingest_many(self, transport_name: str, payloads: Iterable[dict[str, Any]],
                    *, receipt_ns: int | None = None) -> int:
        return sum(
            1 for p in payloads
            if self.ingest(transport_name, p, receipt_ns=receipt_ns)
        )

    def ingest_archive(self, venue: str, path: Path) -> int:
        """Seed the buffer from a publisher daily archive.

        The archive's authentic `agg_trade_id` is preserved, so re-ingesting the
        same file, or ingesting a file that overlaps the live stream, adds
        nothing the second time. The archives carry exchange timestamps only -
        there is no collector clock in them - so `receipt_ns` stays -1 (unknown)
        and provenance is `archive`; LIVE mode then excludes these rows instead
        of pretending they were available.

        Returns the number of NEW events stored.
        """
        raw = read_binance_archive_raw(Path(path), venue)
        buffer = self.buffers[venue]
        added = 0
        for row in raw.itertuples(index=False):
            added += buffer.add_event({
                "agg_trade_id": int(row.agg_trade_id), "ts_us": int(row.ts_us),
                "price": float(row.price), "quantity": float(row.quantity),
                "underlying_n": int(row.underlying_n), "signed": float(row.signed),
                "quote": float(row.quote), "receipt_ns": -1, "provenance": "archive",
            })
        return added

    def ingest_bootstrap(self, transport_name: str, payloads: Iterable[dict[str, Any]],
                         *, available_at_ns: int) -> int:
        """A REST back-fill whose availability instant is KNOWN and explicit.

        `available_at_ns` is when the back-fill response was received, so these
        rows are legitimately usable by any freeze at or after that instant and
        by none before it. No per-event receipt time is invented.
        """
        transport = TRANSPORTS[transport_name]
        if transport.provenance != "bootstrap":
            raise TransportError(f"{transport_name} is not a bootstrap transport")
        buffer = self.buffers[transport.venue]
        added = 0
        for payload in payloads:
            event = transport.parse(payload)
            event["receipt_ns"] = int(available_at_ns)
            event["provenance"] = "bootstrap"
            added += buffer.add_event(event)
        return added

    def mark_gap(self, venue: str, start_ns: int, end_ns: int) -> None:
        self.buffers[venue].mark_gap(start_ns, end_ns)

    # -- lifecycle ----------------------------------------------------------
    def open_target(self, target_us: int) -> None:
        self.pending_targets.add(int(target_us))

    def close_target(self, target_us: int) -> None:
        self.pending_targets.discard(int(target_us))

    def retention_floor_us(self, target_us: int) -> int:
        """Oldest event time still needed, honouring every pending target."""
        oldest = min(self.pending_targets | {int(target_us)})
        return oldest - RETENTION_US

    def prune(self, target_us: int) -> None:
        """Bound retained state without dropping any pending target's inputs."""
        floor = self.retention_floor_us(target_us)
        for buffer in self.buffers.values():
            buffer.prune(floor)

    # -- validity -----------------------------------------------------------
    def has_history(self, target_us: int, venue: str = "spot") -> bool:
        """True only when coverage begins at or before the 900s T0 window start.

        This uses the buffer's recorded coverage start rather than the oldest
        surviving event: an empty first minute is not evidence of absence, and a
        pruned buffer must not look like a covered one.
        """
        start = self.buffers[venue].coverage_start_us
        return start is not None and start <= target_us - RETENTION_US

    def validity(self, target_us: int, *, mode: str = HISTORICAL,
                 freeze_ns: int | None = None) -> dict[str, Any]:
        """Feed continuity / warm-up status for exactly one target.

        No silence threshold is invented here: a feed with no trades in a window
        is reported as such and the original no-imputation rule still applies.
        What IS enforced is that the packet may only be called valid when the
        source window is warm and unbroken, and when nothing needed was excluded
        for unknown availability.
        """
        window_start_us = target_us - RETENTION_US
        window_end_us = target_us + max(T5_WINDOW_SECONDS) * ONE_SECOND_US
        report: dict[str, Any] = {"target_us": target_us, "mode": mode, "venues": {}}
        valid = True
        for venue, buffer in self.buffers.items():
            frame = buffer.frame(mode=mode, freeze_ns=freeze_ns)
            gaps = buffer.gap_overlaps(window_start_us * 1000, window_end_us * 1000)
            warm = self.has_history(target_us, venue)
            unknown = buffer.excluded_unknown_availability
            venue_ok = warm and not gaps and (mode == HISTORICAL or unknown == 0)
            valid = valid and venue_ok
            report["venues"][venue] = {
                "warm": warm,
                "coverage_start_us": buffer.coverage_start_us,
                "events_available": int(len(frame)),
                "receipt_gaps": [[a, b] for a, b in gaps],
                "excluded_unknown_availability": unknown,
                "valid": venue_ok,
            }
        report["valid"] = valid
        return report

    # -- features -----------------------------------------------------------
    def features_for(self, target_us: int, *, mode: str = HISTORICAL,
                     freeze_ns: int | None = None) -> dict[str, float | None]:
        """The Binance columns for exactly one target. Missing => absent, not zero."""
        built = build_binance_features(
            self.buffers["spot"].frame(mode=mode, freeze_ns=freeze_ns),
            self.buffers["um"].frame(mode=mode, freeze_ns=freeze_ns),
        )
        if built.empty or "target_ts" not in built:
            return {}
        want = pd.Timestamp(target_us, unit="us", tz="UTC")
        rows = built.loc[built["target_ts"] == want]
        if rows.empty:
            return {}
        row = rows.iloc[0].drop(labels=["target_ts"])
        return {name: (None if pd.isna(value) else float(value)) for name, value in row.items()}

    def build_target(self, target_us: int, *, mode: str = HISTORICAL,
                     freeze_ns: int | None = None) -> tuple[dict[str, float | None], dict[str, Any]]:
        """Features plus the validity report a packet must fail closed on."""
        features = self.features_for(target_us, mode=mode, freeze_ns=freeze_ns)
        return features, self.validity(target_us, mode=mode, freeze_ns=freeze_ns)

    # -- rolling state ------------------------------------------------------
    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {v: b.to_dict() for v, b in self.buffers.items()}
        payload["pending_targets"] = sorted(self.pending_targets)
        return payload

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "BinanceWindowAccumulator":
        self = cls()
        for venue, buffer in (payload or {}).items():
            if venue == "pending_targets":
                self.pending_targets = {int(t) for t in buffer}
                continue
            self.buffers[venue] = VenueBuffer.from_dict(buffer)
        return self

    def dumps(self) -> str:
        return json.dumps(self.to_dict(), separators=(",", ":"), sort_keys=True)

    @classmethod
    def loads(cls, blob: str) -> "BinanceWindowAccumulator":
        return cls.from_dict(json.loads(blob))
