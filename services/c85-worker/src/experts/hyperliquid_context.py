"""Hyperliquid context features — transcribed from the model's own producer.

WHY THIS VENUE
--------------
The fitted external-direction stage did not choose Binance alone. The recorded
lab output
  /mnt/documents/.lovable/c85-cache/upx/upstream/vault_work/legacy_c30/
  external_research/c30_c70_lab_manager_r2_output/C30_C70_LAB_MANAGER_R2.json
resolves `external_direction_selection/T0` and `/T5` to
`source_set = BINANCE_HYPERLIQUID` with `c_value = 0.03`, and no Deribit term
appears in `phase3_external_feature_coefficients.csv`. Hyperliquid is therefore
the next REQUIRED producer and Deribit is not one.

SOURCE INVENTORY (the only authority; nothing here is invented)
--------------------------------------------------------------
producer   build_multivenue_features_r1.py
           sha256 c3acb1ea58fd77d36f49aef870ec3c0d230e949c47fb329820de752a99d2b446
           recovered copy: /mnt/documents/.lovable/c85-cache/upx/ancestor/
                           source/6cf37dff6f5a/build_multivenue_features_r1.py
function   build_hyperliquid, lines 399-477 — transcribed statement for
           statement below, including the exact rolling periods, min_periods,
           shifts, `replace(0, np.nan)` guards, join directions and the
           `allow_exact_matches` flags, which differ between the two joins.
raw inputs normalized/hyperliquid_btc_15m.csv.gz    (columns t,o,h,l,c,v,n)
           normalized/hyperliquid_btc_1h.csv.gz     (columns t,o,h,l,c,v,n)
           normalized/hyperliquid_btc_funding_1h.csv.gz (time,fundingRate,premium)
           These are the acquisition's normalizations of the public endpoints
           `POST https://api.hyperliquid.xyz/info` with type `candleSnapshot`
           (15m and 1h) and type `fundingHistory`. Field names in the API
           response are the same single letters the producer reads, so the
           adapter below is a rename-free pass-through and no column meaning is
           reinterpreted.
audit      hyperliquid_acquisition_audit.json — 4,720 15m rows, 4,930 hourly
           rows, 6,576 funding rows, and `historical_l2_status:
           not_downloaded_requester_pays`. There is NO historical order book
           here; nothing in this module pretends otherwise.

CAUSALITY, copied from the producer's own audit string
-------------------------------------------------------
"Candle fields use only completed 15-minute/hourly bars ending at or before T.
Funding uses the latest event timestamp strictly before T."

That is implemented exactly as the source does it, and the distinction matters:
  * 15m candle opening at `bar_ts` is attributed to target `bar_ts + 15min`, so
    a bar is only ever read after it has closed.
  * hourly bars are attributed to `bar_ts + 1h` then joined BACKWARD with
    `allow_exact_matches=True`.
  * funding is joined BACKWARD on the raw event timestamp with
    `allow_exact_matches=False` — strictly before T. Using True here would leak.
  * the 15m grid is `date_range(START, END, freq='15min', inclusive='left')`.

MISSING DATA
------------
The grid is left-joined, so an absent bar leaves NaN and is never imputed;
`min_periods` on every rolling window is the source's, not a stricter or looser
one. Warm-up shortfalls therefore surface as NaN rather than as a fabricated
number, and the packet layer fails closed on them.

WHAT THIS IS / IS NOT
---------------------
This IS the raw-input producer for the 19 `hyperliquid_*` context columns.
It is NOT a live packet: the fitted direction pipeline selection, the remaining
leaf producers and the nine leaf outputs are still missing.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

import numpy as np
import pandas as pd

FIFTEEN_MIN = pd.Timedelta(minutes=15)

#: Columns produced, in the source's own order (grid key first).
FEATURE_COLUMNS: tuple[str, ...] = (
    "hyperliquid_t0_return_bps_15m",
    "hyperliquid_t0_range_bps_15m",
    "hyperliquid_t0_close_location_15m",
    "hyperliquid_t0_log_volume_15m",
    "hyperliquid_t0_log_trades_15m",
    "hyperliquid_t0_return_bps_1h",
    "hyperliquid_t0_return_bps_4h",
    "hyperliquid_t0_volume_z_1d",
    "hyperliquid_t0_hourly_return_bps_1h",
    "hyperliquid_t0_hourly_range_bps_1h",
    "hyperliquid_t0_hourly_log_volume_1h",
    "hyperliquid_t0_hourly_log_trades_1h",
    "hyperliquid_t0_hourly_return_bps_4h",
    "hyperliquid_t0_hourly_realized_range_4h",
    "hyperliquid_funding_rate",
    "hyperliquid_premium",
    "hyperliquid_funding_change_1h",
    "hyperliquid_premium_change_1h",
    "hyperliquid_premium_mean_8h",
)

#: Longest look-back any column needs, per input stream. 15m: rolling(96) plus
#: the shift(15) => 96 bars is binding. 1h: shift(3) and rolling(4) => 4 bars.
#: funding: rolling(8) plus diff() => 9 observations.
CANDLE_15M_LOOKBACK = 96
CANDLE_1H_LOOKBACK = 4
FUNDING_LOOKBACK = 9

CANDLE_FIELDS = ("t", "o", "h", "l", "c", "v", "n")
FUNDING_FIELDS = ("time", "fundingRate", "premium")


class HyperliquidSchemaError(ValueError):
    """A payload that does not satisfy the acquisition's schema. Never coerced."""


def _require(payload: dict[str, Any], keys: Sequence[str], what: str) -> None:
    missing = [k for k in keys if k not in payload]
    if missing:
        raise HyperliquidSchemaError(f"{what}: missing field(s) {missing}")


def normalize_candles(rows: Iterable[dict[str, Any]]) -> pd.DataFrame:
    """API `candleSnapshot` rows -> the acquisition's normalized candle frame.

    The endpoint's field names are already the producer's (`t,o,h,l,c,v,n`), so
    this only validates presence and preserves the raw values; numeric coercion
    happens in the transcription exactly where the source does it.
    """
    records = []
    for row in rows:
        _require(row, CANDLE_FIELDS, "hyperliquid candle")
        records.append({k: row[k] for k in CANDLE_FIELDS})
    if not records:
        return pd.DataFrame(columns=list(CANDLE_FIELDS))
    return pd.DataFrame.from_records(records)


def normalize_funding(rows: Iterable[dict[str, Any]]) -> pd.DataFrame:
    """API `fundingHistory` rows -> the acquisition's normalized funding frame."""
    records = []
    for row in rows:
        _require(row, FUNDING_FIELDS, "hyperliquid funding")
        records.append({k: row[k] for k in FUNDING_FIELDS})
    if not records:
        return pd.DataFrame(columns=list(FUNDING_FIELDS))
    return pd.DataFrame.from_records(records)



def _ns(series: pd.Series) -> pd.Series:
    """Pin datetime resolution to nanoseconds.

    Purely a pandas-version artifact: newer pandas returns `datetime64[ms, UTC]`
    from `to_datetime(..., unit="ms")`, which cannot be `merge_asof`-joined
    against the nanosecond grid. The instants are identical; no rule, rounding
    or ordering changes.
    """
    return series.astype("datetime64[ns, UTC]")


# --------------------------------------------------------------------------
# verbatim transcription of build_hyperliquid (lines 399-461)
# --------------------------------------------------------------------------
def build_hyperliquid_features(
    grid: pd.DataFrame,
    candles_15m: pd.DataFrame,
    candles_1h: pd.DataFrame,
    funding: pd.DataFrame,
) -> pd.DataFrame:
    """`build_hyperliquid` with the file reads replaced by supplied frames.

    Every transformation, ordering rule, rolling period, `min_periods`, shift,
    zero-guard and join flag is the source's. `grid` carries the single column
    `target_ts` and stands in for the source's
    `date_range(START, END, freq='15min', inclusive='left')`.
    """
    grid = grid.copy()
    grid["target_ts"] = _ns(grid["target_ts"])
    candles = candles_15m.copy()
    candles["bar_ts"] = _ns(pd.to_datetime(candles["t"], unit="ms", utc=True))
    candles = candles.sort_values("bar_ts").drop_duplicates("bar_ts", keep="last")
    candles["target_ts"] = candles["bar_ts"] + pd.Timedelta(minutes=15)
    for column in ("o", "h", "l", "c", "v", "n"):
        candles[column] = pd.to_numeric(candles[column], errors="coerce")
    candles["hyperliquid_t0_return_bps_15m"] = 10_000.0 * (candles["c"] / candles["o"] - 1.0)
    candles["hyperliquid_t0_range_bps_15m"] = 10_000.0 * (candles["h"] / candles["l"] - 1.0)
    candles["hyperliquid_t0_close_location_15m"] = (
        (candles["c"] - candles["l"]) / (candles["h"] - candles["l"]).replace(0, np.nan)
    )
    candles["hyperliquid_t0_log_volume_15m"] = np.log1p(candles["v"])
    candles["hyperliquid_t0_log_trades_15m"] = np.log1p(candles["n"])
    candles["hyperliquid_t0_return_bps_1h"] = 10_000.0 * (candles["c"] / candles["o"].shift(3) - 1.0)
    candles["hyperliquid_t0_return_bps_4h"] = 10_000.0 * (candles["c"] / candles["o"].shift(15) - 1.0)
    candles["hyperliquid_t0_volume_z_1d"] = (
        candles["v"] - candles["v"].rolling(96, min_periods=24).mean()
    ) / candles["v"].rolling(96, min_periods=24).std().replace(0, np.nan)
    keep = [c for c in candles.columns if c == "target_ts" or c.startswith("hyperliquid_")]
    result = candles[keep].copy()

    hourly = candles_1h.copy()
    hourly["bar_ts"] = _ns(pd.to_datetime(hourly["t"], unit="ms", utc=True))
    hourly = hourly.sort_values("bar_ts").drop_duplicates("bar_ts", keep="last")
    hourly["target_ts"] = hourly["bar_ts"] + pd.Timedelta(hours=1)
    for column in ("o", "h", "l", "c", "v", "n"):
        hourly[column] = pd.to_numeric(hourly[column], errors="coerce")
    hourly["hyperliquid_t0_hourly_return_bps_1h"] = 10_000.0 * (hourly["c"] / hourly["o"] - 1.0)
    hourly["hyperliquid_t0_hourly_range_bps_1h"] = 10_000.0 * (hourly["h"] / hourly["l"] - 1.0)
    hourly["hyperliquid_t0_hourly_log_volume_1h"] = np.log1p(hourly["v"])
    hourly["hyperliquid_t0_hourly_log_trades_1h"] = np.log1p(hourly["n"])
    hourly["hyperliquid_t0_hourly_return_bps_4h"] = 10_000.0 * (hourly["c"] / hourly["o"].shift(3) - 1.0)
    hourly["hyperliquid_t0_hourly_realized_range_4h"] = (
        hourly["hyperliquid_t0_hourly_range_bps_1h"].rolling(4, min_periods=2).mean()
    )
    hourly_keep = [c for c in hourly.columns if c == "target_ts" or c.startswith("hyperliquid_")]
    result = grid.merge(result, on="target_ts", how="left", validate="one_to_one")
    result = pd.merge_asof(
        result.sort_values("target_ts"),
        hourly[hourly_keep].sort_values("target_ts"),
        on="target_ts",
        direction="backward",
        allow_exact_matches=True,
    )

    funding = funding.copy()
    funding["event_ts"] = _ns(pd.to_datetime(funding["time"], unit="ms", utc=True))
    funding["hyperliquid_funding_rate"] = pd.to_numeric(funding["fundingRate"], errors="coerce")
    funding["hyperliquid_premium"] = pd.to_numeric(funding["premium"], errors="coerce")
    funding = funding.sort_values("event_ts").drop_duplicates("event_ts", keep="last")
    funding["hyperliquid_funding_change_1h"] = funding["hyperliquid_funding_rate"].diff()
    funding["hyperliquid_premium_change_1h"] = funding["hyperliquid_premium"].diff()
    funding["hyperliquid_premium_mean_8h"] = funding["hyperliquid_premium"].rolling(8, min_periods=2).mean()
    result = pd.merge_asof(
        result.sort_values("target_ts"),
        funding[[
            "event_ts", "hyperliquid_funding_rate", "hyperliquid_premium",
            "hyperliquid_funding_change_1h", "hyperliquid_premium_change_1h",
            "hyperliquid_premium_mean_8h",
        ]],
        left_on="target_ts",
        right_on="event_ts",
        direction="backward",
        allow_exact_matches=False,
    ).drop(columns="event_ts")
    result = grid.merge(
        result, on="target_ts", how="left", validate="one_to_one", suffixes=("", "_duplicate")
    )
    duplicate_columns = [c for c in result if c.endswith("_duplicate")]
    if duplicate_columns:
        result = result.drop(columns=duplicate_columns)
    return result


def build_grid(start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    """The source's grid: `date_range(START, END, '15min', inclusive='left')`."""
    return pd.DataFrame(
        {"target_ts": _ns(pd.Series(pd.date_range(start, end, freq="15min", inclusive="left")))}
    )


# --------------------------------------------------------------------------
# live accumulator
# --------------------------------------------------------------------------
HISTORICAL = "HISTORICAL"
LIVE = "LIVE"


@dataclass
class _Stream:
    """One bounded, de-duplicated input stream, keyed by its own event time.

    `available_ns[key]` is when the observation was actually received. It is
    recorded, never inferred: a poll response stamps every row it carried with
    the instant that response arrived, because that is the first moment any of
    those rows could legitimately have been used.
    """

    key: str                      # "t" for candles, "time" for funding
    rows: dict[int, dict[str, Any]] = field(default_factory=dict)
    available_ns: dict[int, int] = field(default_factory=dict)

    def add(self, row: dict[str, Any], *, available_ns: int | None) -> bool:
        key = int(row[self.key])
        known = self.rows.get(key)
        # A re-poll of an unclosed bar legitimately revises it; the source's own
        # `drop_duplicates(keep='last')` resolves duplicates the same way. The
        # earliest availability is kept so a revision cannot back-date access.
        self.rows[key] = dict(row)
        if available_ns is not None:
            previous = self.available_ns.get(key)
            self.available_ns[key] = (
                available_ns if previous is None else min(previous, int(available_ns))
            )
        return known is None

    def frame(self, columns: Sequence[str], *, mode: str, freeze_ns: int | None) -> pd.DataFrame:
        records = []
        self.excluded_unknown = 0
        for key, row in self.rows.items():
            if mode == LIVE:
                available = self.available_ns.get(key)
                if available is None:
                    self.excluded_unknown += 1
                    continue
                if available > int(freeze_ns):  # type: ignore[arg-type]
                    continue
            records.append({c: row[c] for c in columns})
        if not records:
            return pd.DataFrame(columns=list(columns))
        return pd.DataFrame.from_records(records).sort_values(self.key).reset_index(drop=True)

    def prune(self, keep_from_ms: int) -> None:
        for key in [k for k in self.rows if k < keep_from_ms]:
            del self.rows[key]
            self.available_ns.pop(key, None)

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "rows": {str(k): v for k, v in self.rows.items()},
            "available_ns": {str(k): v for k, v in self.available_ns.items()},
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "_Stream":
        return cls(
            key=payload["key"],
            rows={int(k): dict(v) for k, v in (payload.get("rows") or {}).items()},
            available_ns={int(k): int(v) for k, v in (payload.get("available_ns") or {}).items()},
        )


class HyperliquidContextAccumulator:
    """Rolling Hyperliquid state for the live path.

    Feature construction runs the SAME verbatim transcription used for the
    historical replay, over the retained rows, so the two paths cannot drift.
    """

    def __init__(self) -> None:
        self.candles_15m = _Stream("t")
        self.candles_1h = _Stream("t")
        self.funding = _Stream("time")
        self.pending_targets: set[int] = set()

    # -- ingestion ----------------------------------------------------------
    def ingest_candles(self, interval: str, rows: Iterable[dict[str, Any]],
                       *, available_ns: int | None = None) -> int:
        stream = self._candle_stream(interval)
        added = 0
        for row in normalize_candles(rows).to_dict("records"):
            added += stream.add(row, available_ns=available_ns)
        return added

    def ingest_funding(self, rows: Iterable[dict[str, Any]],
                       *, available_ns: int | None = None) -> int:
        added = 0
        for row in normalize_funding(rows).to_dict("records"):
            added += self.funding.add(row, available_ns=available_ns)
        return added

    def _candle_stream(self, interval: str) -> _Stream:
        if interval == "15m":
            return self.candles_15m
        if interval == "1h":
            return self.candles_1h
        raise HyperliquidSchemaError(f"unsupported candle interval {interval!r}")

    # -- lifecycle ----------------------------------------------------------
    def open_target(self, target_ms: int) -> None:
        self.pending_targets.add(int(target_ms))

    def close_target(self, target_ms: int) -> None:
        self.pending_targets.discard(int(target_ms))

    def prune(self, target_ms: int) -> None:
        """Bound retained state without dropping any pending target's inputs."""
        oldest = min(self.pending_targets | {int(target_ms)})
        self.candles_15m.prune(oldest - CANDLE_15M_LOOKBACK * 15 * 60_000)
        self.candles_1h.prune(oldest - CANDLE_1H_LOOKBACK * 60 * 60_000)
        self.funding.prune(oldest - FUNDING_LOOKBACK * 60 * 60_000)

    # -- reading ------------------------------------------------------------
    def features_for(self, target_ms: int, *, mode: str = HISTORICAL,
                     freeze_ns: int | None = None) -> dict[str, float | None]:
        if mode not in (HISTORICAL, LIVE):
            raise ValueError(f"unknown availability mode {mode!r}")
        if mode == LIVE and freeze_ns is None:
            raise ValueError("LIVE mode requires the packet freeze instant")
        target = pd.Timestamp(int(target_ms), unit="ms", tz="UTC")
        grid = pd.DataFrame({"target_ts": [target]})
        built = build_hyperliquid_features(
            grid,
            self.candles_15m.frame(CANDLE_FIELDS, mode=mode, freeze_ns=freeze_ns),
            self.candles_1h.frame(CANDLE_FIELDS, mode=mode, freeze_ns=freeze_ns),
            self.funding.frame(FUNDING_FIELDS, mode=mode, freeze_ns=freeze_ns),
        )
        if built.empty:
            return {}
        row = built.iloc[0]
        return {
            name: (None if name not in built or pd.isna(row[name]) else float(row[name]))
            for name in FEATURE_COLUMNS
        }

    def validity(self, target_ms: int, *, mode: str = HISTORICAL,
                 freeze_ns: int | None = None) -> dict[str, Any]:
        """Warm-up / completeness status. Nothing is imputed; NaN stays NaN."""
        features = self.features_for(target_ms, mode=mode, freeze_ns=freeze_ns)
        missing = [name for name in FEATURE_COLUMNS if features.get(name) is None]
        return {
            "target_ms": int(target_ms),
            "mode": mode,
            "missing_columns": missing,
            "candles_15m_retained": len(self.candles_15m.rows),
            "candles_1h_retained": len(self.candles_1h.rows),
            "funding_retained": len(self.funding.rows),
            "excluded_unknown_availability": sum(
                getattr(s, "excluded_unknown", 0)
                for s in (self.candles_15m, self.candles_1h, self.funding)
            ),
            "valid": not missing,
        }

    def build_target(self, target_ms: int, *, mode: str = HISTORICAL,
                     freeze_ns: int | None = None) -> tuple[dict[str, float | None], dict[str, Any]]:
        features = self.features_for(target_ms, mode=mode, freeze_ns=freeze_ns)
        return features, self.validity(target_ms, mode=mode, freeze_ns=freeze_ns)

    # -- rolling state ------------------------------------------------------
    def to_dict(self) -> dict[str, Any]:
        return {
            "candles_15m": self.candles_15m.to_dict(),
            "candles_1h": self.candles_1h.to_dict(),
            "funding": self.funding.to_dict(),
            "pending_targets": sorted(self.pending_targets),
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "HyperliquidContextAccumulator":
        self = cls()
        self.candles_15m = _Stream.from_dict(payload["candles_15m"])
        self.candles_1h = _Stream.from_dict(payload["candles_1h"])
        self.funding = _Stream.from_dict(payload["funding"])
        self.pending_targets = {int(t) for t in payload.get("pending_targets", [])}
        return self

    def dumps(self) -> str:
        return json.dumps(self.to_dict(), separators=(",", ":"), sort_keys=True)

    @classmethod
    def loads(cls, blob: str) -> "HyperliquidContextAccumulator":
        return cls.from_dict(json.loads(blob))
