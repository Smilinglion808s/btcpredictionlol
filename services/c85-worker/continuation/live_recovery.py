"""Recover today's Binance inputs from the live REST API instead of waiting for
the next daily archive.

data.binance.vision publishes a day's aggTrades archive only after the UTC day
closes, so the current day is always missing. The same trades are available
immediately from the exchange REST endpoints, so this module rebuilds the exact
archive file the unchanged builder expects:

  spot  /api/v3/aggTrades   -> headerless CSV, transact_time in MICROseconds
  um    /fapi/v1/aggTrades  -> header CSV,     transact_time in MILLIseconds

Those two conventions are what `read_binance_archive` assumes for each venue, so
a recovered day feeds the builder byte-compatibly and the feature construction
that runs over it is the archive-based calculation, unchanged.

`verify_against_archive()` proves that: it rebuilds a *completed* day from the
live endpoints and compares every event-window feature against the published
archive for the same day.
"""
from __future__ import annotations

import csv
import io
import json
import time
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

ENDPOINTS = {
    "spot": ("https://api.binance.com/api/v3/aggTrades", 1_000),
    "um": ("https://fapi.binance.com/fapi/v1/aggTrades", 1_000),
}
USER_AGENT = "btc-t0-t5-multivenue-lab/1.0"
COLUMNS = ["agg_trade_id", "price", "quantity", "first_trade_id", "last_trade_id",
           "transact_time", "is_buyer_maker"]


def _get(url: str, params: dict, attempts: int = 8) -> list[dict]:
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(f"{url}?{query}", headers={"User-Agent": USER_AGENT})
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read())
        except Exception as exc:  # rate limits and transient 5xx are retried
            last = exc
            time.sleep(min(0.5 * 2 ** attempt, 20.0))
    raise RuntimeError(f"live aggTrades request failed: {url} {params}: {last}")


def fetch_agg_trades(venue: str, start: datetime, end: datetime) -> list[list]:
    """All aggTrades with exchange time in [start, end), ascending, no gaps.

    Paged by aggregate-trade id after an initial time-window seek, which is the
    only paging mode Binance documents as complete (time windows are capped at
    one hour and silently truncate at the row limit).
    """
    url, limit = ENDPOINTS[venue]
    start_ms = int(start.timestamp() * 1000)
    end_ms = int(end.timestamp() * 1000)
    rows: list[list] = []
    seen: set[int] = set()
    cursor = start_ms
    from_id: int | None = None
    while True:
        if from_id is None:
            window_end = min(cursor + 3_600_000, end_ms)
            if cursor >= end_ms:
                break
            batch = _get(url, {"symbol": "BTCUSDT", "startTime": cursor,
                               "endTime": window_end, "limit": limit})
            if not batch:
                cursor = window_end
                continue
        else:
            batch = _get(url, {"symbol": "BTCUSDT", "fromId": from_id, "limit": limit})
            if not batch:
                break
        for trade in batch:
            trade_id = int(trade["a"])
            if trade_id in seen:
                continue
            timestamp = int(trade["T"])
            if timestamp >= end_ms:
                return rows
            if timestamp < start_ms:
                continue
            seen.add(trade_id)
            rows.append([trade_id, trade["p"], trade["q"], int(trade["f"]), int(trade["l"]),
                         timestamp, "true" if trade["m"] else "false"])
        last = batch[-1]
        from_id = int(last["a"]) + 1
        cursor = int(last["T"])
        if len(batch) < limit and cursor >= end_ms - 1:
            break
    return rows


def write_archive(venue: str, day: datetime, rows: list[list], directory: Path,
                  partial_until: datetime | None) -> Path:
    """Write rows in the exact daily-archive layout for `venue`."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    if venue == "um":
        writer.writerow(COLUMNS)
    for row in rows:
        agg, price, quantity, first, last, timestamp_ms, maker = row
        if venue == "spot":
            writer.writerow([agg, price, quantity, first, last, timestamp_ms * 1000, maker, "true"])
        else:
            writer.writerow([agg, price, quantity, first, last, timestamp_ms, maker])
    stamp = day.strftime("%Y-%m-%d")
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"BTCUSDT-aggTrades-{stamp}.zip"
    tmp = path.with_suffix(".zip.part")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"BTCUSDT-aggTrades-{stamp}.csv", buffer.getvalue())
    tmp.replace(path)
    marker = directory / f"BTCUSDT-aggTrades-{stamp}.live.json"
    marker.write_text(json.dumps({
        "source": "binance REST aggTrades",
        "venue": venue,
        "day": stamp,
        "rows": len(rows),
        "covers_until": (partial_until or (day + timedelta(days=1))).isoformat(),
        "partial": partial_until is not None,
        "recovered_at": datetime.now(timezone.utc).isoformat(),
    }, indent=2) + "\n")
    return path


def recover_day(venue: str, day: datetime, directory: Path, end: datetime) -> dict:
    day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
    stop = min(day_end, end)
    rows = fetch_agg_trades(venue, day_start, stop)
    path = write_archive(venue, day_start, rows, directory,
                         None if stop >= day_end else stop)
    return {"venue": venue, "day": day_start.strftime("%Y-%m-%d"), "rows": len(rows),
            "covers_until": stop.isoformat(), "path": str(path)}


# Binance restricts the futures aggTrades search window to the recent two days,
# so a completed futures day can only be re-fetched in part. The verification
# then compares the fetchable slice and reports exactly which intervals it covers.
UM_LOOKBACK = timedelta(days=2)


def verify_against_archive(venue: str, day: str, builder, raw_root: Path) -> dict:
    """Rebuild a completed day from the live feed and diff every feature column
    against the published archive for the same day."""
    archive_path = raw_root / f"binance_{venue}" / f"BTCUSDT-aggTrades-{day}.zip"
    if not archive_path.exists():
        raise FileNotFoundError(f"no published archive to verify against: {archive_path}")
    reference = builder.aggregate_event_windows(
        builder.read_binance_archive(archive_path, venue), venue_prefix=f"binance_{venue}")

    scratch = raw_root / "live_verify" / venue
    day_start = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    day_end = day_start + timedelta(days=1)
    fetch_from = day_start
    if venue == "um":
        earliest = datetime.now(timezone.utc) - UM_LOOKBACK + timedelta(minutes=30)
        if earliest > day_start:
            fetch_from = earliest.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    rows = fetch_agg_trades(venue, fetch_from, day_end)
    live_path = write_archive(venue, day_start, rows, scratch, None)
    live = builder.aggregate_event_windows(
        builder.read_binance_archive(live_path, venue), venue_prefix=f"binance_{venue}")

    compare_from = pd.Timestamp(fetch_from + timedelta(minutes=15))
    reference = reference[pd.to_datetime(reference["target_ts"], utc=True) >= compare_from]
    live = live[pd.to_datetime(live["target_ts"], utc=True) >= compare_from]
    merged = reference.merge(live, on="target_ts", suffixes=("_archive", "_live"))
    columns = [c for c in reference.columns if c != "target_ts"]
    mismatches = {}
    for column in columns:
        a = merged[f"{column}_archive"].to_numpy(float)
        b = merged[f"{column}_live"].to_numpy(float)
        different = ~(pd.isna(a) & pd.isna(b)) & ~(abs(a - b) <= 1e-9 * (1 + abs(a)))
        if different.any():
            mismatches[column] = int(different.sum())
    return {
        "venue": venue,
        "day": day,
        "compared_from": compare_from.isoformat(),
        "slice_reason": ("futures live search window is limited to the recent 2 days"
                         if venue == "um" and fetch_from > day_start else "full day"),
        "intervals_compared": int(len(merged)),
        "columns_compared": len(columns),
        "archive_rows": int(len(reference)),
        "live_rows": int(len(live)),
        "mismatched_columns": mismatches,
        "identical": not mismatches and len(merged) == len(reference) == len(live),
    }
