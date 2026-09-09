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
class _Version:
    """One immutable observation of one bar/event, with its OWN availability.

    `available_ns` is when THIS version was received - never inherited from an
    earlier version of the same bar. `final` records whether the source
    confirmed the bar complete; `None` means "not stated", and finality is then
    inferred from the receipt instant against the bar's close time.
    """

    payload: dict[str, Any]
    available_ns: int | None
    seq: int
    final: bool | None = None


@dataclass
class _Stream:
    """One bounded input stream, keyed by event time, versioned by observation.

    A 15-minute bar polled at +7s is a PARTIAL snapshot; the same bar polled
    after it closes carries different OHLC. Storing one row per bar and keeping
    the earliest availability silently back-dated the corrected values: a packet
    frozen before the correction arrived would have read the corrected numbers
    with the partial's timestamp. Versions fix that at the root - each observed
    payload keeps its own arrival instant, and a read at freeze F sees the
    latest version that had actually arrived by F.

    Rules, all of them consequences of that:
      * identical repeated payload -> no new version; the EARLIEST known receipt
        is retained (a re-poll returning the same bytes proves it was already
        available, it does not delay it).
      * changed payload -> new version with its own receipt; it can never
        inherit the earlier one.
      * unknown-availability payload -> stored as its own version and simply
        invisible in LIVE mode; it never overwrites a known version nor takes
        its timestamp.
      * out-of-order poll responses -> selection is by (available_ns, seq), not
        by arrival order, so a late-delivered older snapshot cannot displace a
        newer one that was already available.
      * finality -> in LIVE mode a candle version is usable only once the source
        confirmed it complete, or (absent that) once it was received at or after
        the bar's own close time. A bar's close time alone proves nothing about
        a snapshot taken before it.
    """

    key: str                          # "t" for candles, "time" for funding
    interval_ms: int = 0              # bar length; 0 = point event, always final
    versions: dict[int, list[_Version]] = field(default_factory=dict)
    sequence: int = 0

    # -- ingestion ----------------------------------------------------------
    def add(self, row: dict[str, Any], *, available_ns: int | None,
            final: bool | None = None) -> bool:
        key = int(row[self.key])
        payload = dict(row)
        history = self.versions.setdefault(key, [])
        for version in history:
            if version.payload == payload:
                if available_ns is not None:
                    known = version.available_ns
                    version.available_ns = (
                        int(available_ns) if known is None
                        else min(known, int(available_ns))
                    )
                if final is not None:
                    version.final = bool(final) if version.final is None else (
                        version.final or bool(final)
                    )
                return False
        self.sequence += 1
        history.append(_Version(payload, None if available_ns is None else int(available_ns),
                                self.sequence, final))
        return len(history) == 1

    # -- selection ----------------------------------------------------------
    def _is_final(self, key: int, version: _Version) -> bool:
        if self.interval_ms == 0:
            return True
        if version.final is not None:
            return bool(version.final)
        if version.available_ns is None:
            return False
        close_ns = (key + self.interval_ms) * 1_000_000
        return version.available_ns >= close_ns

    def select(self, key: int, *, mode: str, freeze_ns: int | None
               ) -> tuple[dict[str, Any] | None, str]:
        history = self.versions.get(key) or []
        if not history:
            return None, "absent"
        if mode == HISTORICAL:
            return max(history, key=lambda v: v.seq).payload, "ok"
        eligible = [v for v in history
                    if v.available_ns is not None and v.available_ns <= int(freeze_ns)]  # type: ignore[arg-type]
        if not eligible:
            reason = "unknown_availability" if any(
                v.available_ns is None for v in history) else "not_yet_available"
            return None, reason
        usable = [v for v in eligible if self._is_final(key, v)]
        if not usable:
            return None, "not_confirmed_final"
        return max(usable, key=lambda v: (v.available_ns, v.seq)).payload, "ok"

    def frame(self, columns: Sequence[str], *, mode: str, freeze_ns: int | None) -> pd.DataFrame:
        records = []
        self.excluded_unknown = 0
        self.excluded_partial = 0
        for key in self.versions:
            payload, reason = self.select(key, mode=mode, freeze_ns=freeze_ns)
            if payload is None:
                if reason == "unknown_availability":
                    self.excluded_unknown += 1
                elif reason == "not_confirmed_final":
                    self.excluded_partial += 1
                continue
            records.append({c: payload[c] for c in columns})
        if not records:
            return pd.DataFrame(columns=list(columns))
        return pd.DataFrame.from_records(records).sort_values(self.key).reset_index(drop=True)

    # -- retention ----------------------------------------------------------
    def prune_by_count(self, anchor_key: int, keep_count: int) -> None:
        """Keep every key after `anchor_key`, plus the newest `keep_count` at or
        before it - COUNTS of observations, exactly as the source's rolling and
        shift operate, never wall-clock time.

        Wall-clock retention was wrong for a positional rule: the source's
        `rolling(96)` and `shift(3)` walk retained ROWS, so across a feed outage
        or a delayed bar the row a target still needs can sit far further back
        than any fixed duration allows. At target 12:15 the last completed hourly
        bar is 11:00 and its `shift(3)` anchor is 08:00; a 4-hour window drops
        08:00 and silently changes the 4h return.
        """
        at_or_before = sorted(k for k in self.versions if k <= int(anchor_key))
        for key in at_or_before[:-keep_count] if keep_count > 0 else at_or_before:
            del self.versions[key]

    # -- state --------------------------------------------------------------
    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "interval_ms": self.interval_ms,
            "sequence": self.sequence,
            "versions": {
                str(k): [
                    {"payload": v.payload, "available_ns": v.available_ns,
                     "seq": v.seq, "final": v.final}
                    for v in versions
                ]
                for k, versions in self.versions.items()
            },
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "_Stream":
        stream = cls(key=payload["key"], interval_ms=int(payload.get("interval_ms", 0)),
                     sequence=int(payload.get("sequence", 0)))
        for key, versions in (payload.get("versions") or {}).items():
            stream.versions[int(key)] = [
                _Version(dict(v["payload"]), v["available_ns"], int(v["seq"]), v.get("final"))
                for v in versions
            ]
        return stream


class HyperliquidContextAccumulator:
    """Rolling Hyperliquid state for the live path.

    Feature construction runs the SAME verbatim transcription used for the
    historical replay, over the retained rows, so the two paths cannot drift.
    """

    def __init__(self) -> None:
        self.candles_15m = _Stream("t", interval_ms=15 * 60_000)
        self.candles_1h = _Stream("t", interval_ms=60 * 60_000)
        self.funding = _Stream("time")          # point events, always final
        self.pending_targets: set[int] = set()

    # -- ingestion ----------------------------------------------------------
    def ingest_candles(self, interval: str, rows: Iterable[dict[str, Any]],
                       *, available_ns: int | None = None,
                       final: bool | None = None) -> int:
        """Ingest a candle poll response.

        `final` is the source's own confirmation that the bars are complete
        (e.g. a websocket candle frame carrying a closed flag, or a snapshot the
        caller knows excludes the running bar). Leave it None when the source
        does not say, and finality is then decided by receipt vs close time -
        never by the bar's close time on its own.
        """
        stream = self._candle_stream(interval)
        added = 0
        for row in normalize_candles(rows).to_dict("records"):
            added += stream.add(row, available_ns=available_ns, final=final)
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

    def anchors(self, target_ms: int) -> dict[str, int]:
        """The newest input row each stream may read for this target.

        Straight from the source's join rules: the 15m bar attributed to T opens
        at T-15m; the hourly backward as-of with `allow_exact_matches=True`
        reaches the bar opening at T-1h; funding joins strictly before T.
        """
        target = int(target_ms)
        return {
            "candles_15m": target - 15 * 60_000,
            "candles_1h": target - 60 * 60_000,
            "funding": target - 1,
        }

    def prune(self, target_ms: int) -> None:
        """Bound retained state by OBSERVATION COUNT, honouring pending targets.

        Retention is derived from what the source's own operations consume:
        rolling(96)/shift(15) on 15m bars, shift(3)/rolling(4) on hourly bars,
        and diff()/rolling(8) on funding - all positional. So the newest N rows
        at or before each stream's anchor are kept, plus everything newer, and
        every version of a retained key survives. Rows a still-pending target
        needs are never dropped, because the anchors are computed from the
        OLDEST pending target.
        """
        oldest = min(self.pending_targets | {int(target_ms)})
        anchors = self.anchors(oldest)
        self.candles_15m.prune_by_count(anchors["candles_15m"], CANDLE_15M_LOOKBACK)
        self.candles_1h.prune_by_count(anchors["candles_1h"], CANDLE_1H_LOOKBACK)
        self.funding.prune_by_count(anchors["funding"], FUNDING_LOOKBACK)

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
