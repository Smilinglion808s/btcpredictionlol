"""Authentic source recovery for a Version 1 target that the live feeds missed.

This is the SAME stage order as the live direction-only path
(`LivePacketSource.direction_stage`): the same Binance spot/UM aggregate-trade
windows, the same T+5s spot anchor and five-second completeness rule, the same
Kalshi floor strike, the same USDCUSDT quote minute, spot/index prior minutes
and 16-minute COIN-M context, feeding the unchanged `build_direction_features`.

It lives under `src/` on purpose: the serving image only copies `src/`, so the
startup bridge that recovers a gap must be able to import it at runtime. The
offline September builder imports the very same functions, so the recipe has
exactly one definition.

Nothing is imputed. A target whose sources are incomplete is still RECORDED with
`input_valid=False` and NaN feature values — never zero-filled, never
back-dated.
"""
from __future__ import annotations

import io
import json
import os
import time
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

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
from .training import COLUMNS

BASE = "https://data.binance.vision/data"
ET = ZoneInfo("America/New_York")
MINUTE_MS = 60_000
CACHE = Path(os.environ.get("LITEA_RECOVERY_CACHE", "/tmp/litea-recovery"))

DATASETS = {
    "spot_agg": "spot/daily/aggTrades/BTCUSDT/BTCUSDT-aggTrades-{d}.zip",
    "um_agg": "futures/um/daily/aggTrades/BTCUSDT/BTCUSDT-aggTrades-{d}.zip",
    "spot_1m": "spot/daily/klines/BTCUSDT/1m/BTCUSDT-1m-{d}.zip",
    "usdc_1m": "spot/daily/klines/USDCUSDT/1m/USDCUSDT-1m-{d}.zip",
    "index_1m": "futures/cm/daily/indexPriceKlines/BTCUSD/1m/BTCUSD-1m-{d}.zip",
    "cm_1m": "futures/cm/daily/klines/BTCUSD_PERP/1m/BTCUSD_PERP-1m-{d}.zip",
}

REST = {
    "spot_agg": ("https://api.binance.com/api/v3/aggTrades", {"symbol": "BTCUSDT"}),
    "um_agg": ("https://fapi.binance.com/fapi/v1/aggTrades", {"symbol": "BTCUSDT"}),
    "spot_1m": ("https://api.binance.com/api/v3/klines", {"symbol": "BTCUSDT", "interval": "1m"}),
    "usdc_1m": ("https://api.binance.com/api/v3/klines", {"symbol": "USDCUSDT", "interval": "1m"}),
    "index_1m": (
        "https://dapi.binance.com/dapi/v1/indexPriceKlines",
        {"pair": "BTCUSD", "interval": "1m"},
    ),
    "cm_1m": (
        "https://dapi.binance.com/dapi/v1/klines",
        {"symbol": "BTCUSD_PERP", "interval": "1m"},
    ),
}

AGG_FIELDS = [
    "event_count", "underlying_trade_count", "base_volume", "quote_volume", "signed_quote",
    "signed_event_count", "buy_quote", "sell_quote", "flow_imbalance", "aggressive_buy_share",
    "trade_hhi", "max_trade_share", "return_bps", "range_bps", "price_flow_alignment",
    "first_event_us", "last_event_us", "max_events_one_second", "max_abs_flow_one_second",
]

KLINE_COLUMNS = [
    "open_ms", "open", "high", "low", "close", "base_volume", "close_ms",
    "quote_volume", "trade_count", "taker_buy_base", "taker_buy_quote", "ignore",
]


class RecoveryUnavailable(RuntimeError):
    """The public source could not be read at all for this window."""


def empty_window_template() -> dict:
    """An unobserved sub-window is NaN in every aggregate, exactly as the
    archive builder leaves it after reindexing; it is never zero-filled."""
    out: dict[str, float] = {}
    for venue in ("binance_spot", "binance_um"):
        for horizon, windows in (("t0", (5, 15, 30, 60, 180, 900)), ("t5", (1, 2, 3, 5))):
            for seconds in windows:
                for field in AGG_FIELDS:
                    out[f"{venue}_{horizon}_w{seconds:03d}_{field}"] = float("nan")
    return out


# --------------------------------------------------------------------------- #
# transport
def _rest(url: str, params: dict) -> list:
    query = urllib.parse.urlencode(params)
    for attempt in range(6):
        try:
            with urllib.request.urlopen(f"{url}?{query}", timeout=30) as response:
                return json.load(response)
        except Exception as exc:  # noqa: BLE001 - transient rate limit / network
            if attempt == 5:
                raise RecoveryUnavailable(f"LITEA_REST_FAILED: {url} :: {exc}") from exc
            time.sleep(1.5 * (attempt + 1))
    return []


def fetch(kind: str, day: str) -> Path:
    path = CACHE / kind / f"{day}.zip"
    if path.exists() and path.stat().st_size > 0:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    url = f"{BASE}/{DATASETS[kind].format(d=day)}"
    with urllib.request.urlopen(url, timeout=180) as response:
        body = response.read()
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(body)
    tmp.replace(path)
    return path


def _csv(path: Path, names: list[str]) -> pd.DataFrame:
    with zipfile.ZipFile(path) as archive:
        name = archive.namelist()[0]
        raw = archive.read(name)
    head = raw[:64].decode("utf8", "ignore").lower()
    skip = 1 if "open_time" in head or "agg_trade_id" in head else 0
    return pd.read_csv(io.BytesIO(raw), header=None, names=names, skiprows=skip)


def to_us(series: pd.Series) -> pd.Series:
    """Binance moved these archives to microseconds; older days are ms."""
    values = series.astype("int64")
    return np.where(values > 10**15, values, values * 1000)


def _normalise_agg(frame: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(
        {
            "ts_us": to_us(frame["ts"]),
            "price": frame["price"].astype(float),
            "quantity": frame["quantity"].astype(float),
            "underlying_n": (frame["last_id"] - frame["first_id"] + 1).astype(float),
            "signed": np.where(frame["buyer_maker"].astype(bool), -1.0, 1.0),
        }
    )
    out["quote"] = out.price * out.quantity
    return out.sort_values("ts_us", kind="stable").reset_index(drop=True)


# --------------------------------------------------------------------------- #
# windowed public-endpoint recovery — the SHORT read the startup bridge uses.
def rest_agg_window(kind: str, start_ms: int, end_ms: int) -> pd.DataFrame:
    """Aggregate trades in [start_ms, end_ms) straight from the public venue.

    Paged by aggregate-trade id, so a busy window is never silently truncated
    at the 1,000-row page limit.
    """
    url, params = REST[kind]
    probe = _rest(url, {**params, "startTime": start_ms, "endTime": start_ms + 60_000,
                        "limit": 1000})
    if not probe:
        raise RecoveryUnavailable(f"LITEA_REST_EMPTY: {kind} {start_ms}")
    cursor = int(probe[0]["a"])
    pages: list[pd.DataFrame] = []
    while True:
        page = _rest(url, {**params, "fromId": cursor, "limit": 1000})
        if not page:
            break
        frame = pd.DataFrame(page)
        pages.append(frame)
        last_id = int(frame["a"].iloc[-1])
        if int(frame["T"].iloc[-1]) >= end_ms or len(page) < 1000:
            break
        cursor = last_id + 1
    raw = pd.concat(pages, ignore_index=True).drop_duplicates("a")
    raw = raw[(raw["T"].astype("int64") >= start_ms) & (raw["T"].astype("int64") < end_ms)]
    if raw.empty:
        raise RecoveryUnavailable(f"LITEA_REST_NO_EVENTS: {kind} {start_ms}-{end_ms}")
    return _normalise_agg(
        pd.DataFrame(
            {
                "ts": raw["T"].astype("int64"),
                "price": raw["p"].astype(float),
                "quantity": raw["q"].astype(float),
                "first_id": raw["f"].astype("int64"),
                "last_id": raw["l"].astype("int64"),
                "buyer_maker": raw["m"].astype(bool),
            }
        )
    )


def _clean_klines(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.copy()
    frame["open_ms"] = to_us(frame["open_ms"]) // 1000
    frame["close_ms"] = to_us(frame["close_ms"]) // 1000
    for column in ("open", "high", "low", "close", "base_volume", "quote_volume",
                   "taker_buy_base"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce").astype(float)
    frame["trade_count"] = pd.to_numeric(frame["trade_count"], errors="coerce").astype(float)
    return frame[
        ["open_ms", "close_ms", "open", "high", "low", "close", "base_volume",
         "quote_volume", "trade_count", "taker_buy_base"]
    ]


def rest_klines_window(kind: str, start_ms: int, end_ms: int) -> pd.DataFrame:
    url, params = REST[kind]
    rows: list[list] = []
    cursor = start_ms
    while cursor < end_ms:
        page = _rest(url, {**params, "startTime": cursor, "endTime": end_ms, "limit": 1000})
        if not page:
            break
        rows.extend(page)
        cursor = int(page[-1][0]) + MINUTE_MS
        if len(page) < 1000:
            break
    if not rows:
        raise RecoveryUnavailable(f"LITEA_REST_NO_KLINES: {kind} {start_ms}-{end_ms}")
    frame = pd.DataFrame(rows, columns=KLINE_COLUMNS).drop_duplicates("open_ms")
    return _clean_klines(frame)


# --------------------------------------------------------------------------- #
# whole-day archive loaders (offline builder)
def _archive_available(kind: str, day: str) -> bool:
    if (CACHE / kind / f"{day}.zip").exists():
        return True
    request = urllib.request.Request(f"{BASE}/{DATASETS[kind].format(d=day)}", method="HEAD")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status == 200
    except Exception:  # noqa: BLE001 - absent archive
        return False


def _day_bounds(day: str) -> tuple[int, int]:
    start = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return int(start.timestamp() * 1000), int((start + timedelta(days=1)).timestamp() * 1000)


def load_agg(kind: str, day: str) -> pd.DataFrame:
    if not _archive_available(kind, day):
        start, end = _day_bounds(day)
        return rest_agg_window(kind, start, end)
    frame = _csv(
        fetch(kind, day),
        ["agg_id", "price", "quantity", "first_id", "last_id", "ts", "buyer_maker", "best"],
    )
    return _normalise_agg(frame)


def load_klines(kind: str, day: str) -> pd.DataFrame:
    if not _archive_available(kind, day):
        start, end = _day_bounds(day)
        return rest_klines_window(kind, start, end)
    return _clean_klines(_csv(fetch(kind, day), KLINE_COLUMNS))


# --------------------------------------------------------------------------- #
# Kalshi: floor strike, official label, official settlement instant
def market_ticker(target: pd.Timestamp | datetime) -> str:
    close = (pd.Timestamp(target) + timedelta(minutes=15)).astimezone(ET)
    return f"KXBTC15M-{close.strftime('%y%b%d%H%M').upper()}-{close.strftime('%M')}"


def kalshi_market(target: pd.Timestamp | datetime) -> dict:
    """One official market record: floor strike, result and settlement instant."""
    ticker = market_ticker(target)
    url = f"https://api.elections.kalshi.com/trade-api/v2/markets/{ticker}"
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            market = json.load(response)["market"]
    except Exception as exc:  # noqa: BLE001 — absent market stays absent
        return {"ticker": ticker, "error": f"{type(exc).__name__}: {exc}"}
    return {
        "ticker": ticker,
        "floor_strike": market.get("floor_strike"),
        "result": market.get("result"),
        "settlement_ts": market.get("settlement_ts"),
        "label": {"yes": 1, "no": -1}.get(market.get("result")),
    }


# --------------------------------------------------------------------------- #
def target_feature_row(
    target: pd.Timestamp,
    spot: pd.DataFrame,
    um: pd.DataFrame,
    klines: dict[str, pd.DataFrame],
    market: dict,
) -> dict:
    """One recorded opportunity in `training.COLUMNS` shape."""
    target = pd.Timestamp(target)
    target_ms = int(target.timestamp() * 1000)
    target_us = target_ms * 1000
    window_start = target_us - 15 * 60 * 1_000_000
    cutoff = target_us + 5 * 1_000_000
    blockers: list[str] = []
    row: dict = {"ts": target, "target_ms": target_ms, **empty_window_template()}

    for name, events in (("binance_spot", spot), ("binance_um", um)):
        slice_ = events[(events.ts_us >= window_start) & (events.ts_us < cutoff)]
        if slice_.empty:
            blockers.append(f"NO_EVENTS:{name}")
            continue
        row.update(binance_window_features(slice_.reset_index(drop=True), target_ms, name))
    if "binance_spot_t5_w005_return_bps" in row:
        row.update(binance_cross_fields(row))

    opening = spot[(spot.ts_us >= target_us) & (spot.ts_us < cutoff)]
    if opening.empty:
        blockers.append("SPOT_ANCHOR_OPEN_MISSING")
    else:
        row["spot_t0_price"] = float(opening.price.iloc[0])
        seconds = set(((opening.ts_us.to_numpy() - target_us) // 1_000_000).tolist())
        last = opening[(opening.ts_us - target_us) // 1_000_000 == 4]
        complete = seconds.issuperset({0, 1, 2, 3, 4}) and not last.empty
        row["t45_spot_complete"] = int(
            complete
            and np.isfinite(float(opening.price.iloc[0]))
            and np.isfinite(float(last.price.iloc[-1]))
        )
        row["t45_spot_open"] = float(opening.price.iloc[0])
        row["t45_close_5s"] = float(last.price.iloc[-1]) if complete else float("nan")
        row["observed_second_rows"] = float(len(seconds))

    strike = market.get("floor_strike")
    if strike is None or not np.isfinite(float(strike or np.nan)) or float(strike or 0) <= 0:
        blockers.append("FLOOR_STRIKE_MISSING")
    else:
        row["floor_strike"] = float(strike)
        row["anchor_valid"] = True

    prior_open = target_ms - MINUTE_MS
    usdc = _minute(klines["usdc_1m"], prior_open)
    spot_prior = _minute(klines["spot_1m"], prior_open)
    index_prior = _minute(klines["index_1m"], prior_open)

    if usdc is None:
        blockers.append("QUOTE_MINUTE_MISSING")
    else:
        vwap = usdc.quote_volume / usdc.base_volume if usdc.base_volume > 0 else float("nan")
        row.update(
            {
                "quote_open_ms": float(usdc.open_ms),
                "quote_close_ms": float(usdc.close_ms),
                "quote_vwap_usdt_per_usdc": vwap,
                "quote_valid": bool(
                    usdc.close_ms == target_ms - 1
                    and usdc.base_volume > 0
                    and usdc.trade_count > 0
                    and 0.9 <= vwap <= 1.1
                ),
            }
        )
    if spot_prior is None:
        blockers.append("SPOT_MINUTE_MISSING")
    else:
        row.update(
            {
                "spot_prior_open_ms": float(spot_prior.open_ms),
                "spot_prior_close_ms": float(spot_prior.close_ms),
                "spot_prior_close": float(spot_prior.close),
                "spot_prior_base_volume": float(spot_prior.base_volume),
                "spot_prior_trade_count": float(spot_prior.trade_count),
            }
        )
    if index_prior is None:
        blockers.append("INDEX_MINUTE_MISSING")
    else:
        row.update(
            {
                "index_prior_open_ms": float(index_prior.open_ms),
                "index_prior_close_ms": float(index_prior.close_ms),
                "index_prior_close": float(index_prior.close),
                "index_basic_count": float(index_prior.trade_count),
            }
        )
    if index_prior is not None and spot_prior is not None and spot_prior.close > 0:
        row["index_spot_ratio"] = float(index_prior.close) / float(spot_prior.close)
        row["index_source_valid"] = True

    start_ms = target_ms - 16 * MINUTE_MS

    def window(kind: str) -> pd.DataFrame:
        frame = klines[kind]
        return frame.loc[(frame.index >= start_ms) & (frame.index <= prior_open)].reset_index()

    cm_window, index_window, spot_window = window("cm_1m"), window("index_1m"), window("spot_1m")
    if min(len(cm_window), len(index_window), len(spot_window)) < 16:
        blockers.append("CM_CONTEXT_INCOMPLETE")
    else:
        cm_frame = cm_window.rename(
            columns={"base_volume": "contract_volume", "taker_buy_base": "buy_contract_volume"}
        )
        index_frame = index_window.assign(basic_count=index_window.trade_count)
        context = cm_context_features(cm_frame, index_frame, spot_window)
        tail = context.loc[context["ts"] == target]
        if tail.empty:
            blockers.append("CM_CONTEXT_NO_TARGET_ROW")
        else:
            row.update({k: v for k, v in tail.iloc[0].items() if k != "ts"})

    features: dict[str, float] = {}
    if not blockers:
        try:
            frame = base_anchor_fields(pd.DataFrame([row]))
            frame = pd.concat([frame, quote_fields(frame), index_fields(frame)], axis=1)
            features = build_direction_features(frame).iloc[0].to_dict()
        except Exception as exc:  # noqa: BLE001 — record, never impute
            blockers.append(f"DIRECTION_BUILD_FAILED:{type(exc).__name__}:{exc}")

    label = market.get("label")
    settlement = market.get("settlement_ts")
    out = {
        "ts": target,
        "ticker": market.get("ticker"),
        "input_valid": bool(features) and not blockers,
        "label": float(label) if label is not None and pd.notna(label) else np.nan,
        "settlement_ts": pd.to_datetime(settlement, utc=True) if settlement else pd.NaT,
        "blockers": ";".join(blockers) or None,
    }
    for name in COLUMNS[5:]:
        out[name] = float(features.get(name, np.nan))
    return out


def _minute(frame: pd.DataFrame, open_ms: int) -> pd.Series | None:
    try:
        row = frame.loc[open_ms].copy()
    except KeyError:
        return None
    row["open_ms"] = open_ms
    return row


def _indexed(frame: pd.DataFrame) -> pd.DataFrame:
    return frame.drop_duplicates("open_ms").set_index("open_ms").sort_index()


def recover_targets(targets: list[datetime]) -> list[dict]:
    """Rebuild a SHORT contiguous run of missed targets from the public venue.

    Only the windows those targets actually need are read — the 15 minutes
    before each target through T+5s for trades, and the 16 prior minutes for
    the kline context. The historical frame is never reloaded.
    """
    if not targets:
        return []
    ordered = sorted(pd.Timestamp(t).tz_convert("UTC") for t in targets)
    first_ms = int(ordered[0].timestamp() * 1000)
    last_ms = int(ordered[-1].timestamp() * 1000)
    trade_start = first_ms - 16 * MINUTE_MS
    trade_end = last_ms + 6_000
    kline_start = first_ms - 20 * MINUTE_MS
    kline_end = last_ms + MINUTE_MS

    spot = rest_agg_window("spot_agg", trade_start, trade_end)
    um = rest_agg_window("um_agg", trade_start, trade_end)
    klines = {
        kind: _indexed(rest_klines_window(kind, kline_start, kline_end))
        for kind in ("spot_1m", "usdc_1m", "index_1m", "cm_1m")
    }
    return [
        target_feature_row(target, spot, um, klines, kalshi_market(target))
        for target in ordered
    ]
