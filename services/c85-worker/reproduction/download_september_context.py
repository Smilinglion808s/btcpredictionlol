"""Fetch the genuine Binance daily archives for a date range.

Uses the SAME dataset trees, filenames and per-file `.CHECKSUM` verification as
the recovered `download_binance_context_2026.py`; the only difference is that
the window is a parameter, so the September catch-up extends the identical
source corpus rather than a second, differently sourced one.

Environment:
    C85_LC_SOURCE   destination directory (spot_1m/ futures_1m/ ... )
    C85_LC_FROM     first day, ISO (inclusive)
    C85_LC_TO       last day, ISO (inclusive)

Missing days are reported, never fabricated: `data.binance.vision` only
publishes a daily archive once that UTC day is complete, so a 404 is the honest
end of available complete source data.
"""
from __future__ import annotations

import concurrent.futures
import hashlib
import json
import os
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

BASE = "https://data.binance.vision/data"
SOURCE = Path(os.environ["C85_LC_SOURCE"])
FROM = date.fromisoformat(os.environ["C85_LC_FROM"])
TO = date.fromisoformat(os.environ["C85_LC_TO"])

TREES = {
    "spot_1m": "spot/daily/klines/BTCUSDT/1m",
    "futures_1m": "futures/um/daily/klines/BTCUSDT/1m",
    "mark_1m": "futures/um/daily/markPriceKlines/BTCUSDT/1m",
    "index_1m": "futures/um/daily/indexPriceKlines/BTCUSDT/1m",
    "premium_1m": "futures/um/daily/premiumIndexKlines/BTCUSDT/1m",
    "bookDepth": "futures/um/daily/bookDepth/BTCUSDT",
    "metrics": "futures/um/daily/metrics/BTCUSDT",
}


def filename(dataset: str, stamp: str) -> str:
    if dataset in ("bookDepth", "metrics"):
        return f"BTCUSDT-{dataset}-{stamp}.zip"
    return f"BTCUSDT-1m-{stamp}.zip"


def fetch(url: str, timeout: int = 120) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "t0-external-context/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def one(dataset: str, day: date) -> dict[str, object]:
    stamp = day.isoformat()
    name = filename(dataset, stamp)
    url = f"{BASE}/{TREES[dataset]}/{name}"
    path = SOURCE / dataset / name
    path.parent.mkdir(parents=True, exist_ok=True)
    row: dict[str, object] = {"dataset": dataset, "value": stamp, "archive": name}
    try:
        expected = fetch(url + ".CHECKSUM").decode().strip().split()[0]
    except urllib.error.HTTPError as exc:
        return {**row, "status": "unavailable", "http": exc.code}
    if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == expected:
        return {**row, "status": "cached", "sha256": expected, "bytes": path.stat().st_size}
    payload = fetch(url)
    digest = hashlib.sha256(payload).hexdigest()
    if digest != expected:
        raise RuntimeError(f"checksum mismatch for {url}: {digest} != {expected}")
    path.write_bytes(payload)
    return {**row, "status": "downloaded", "sha256": digest, "bytes": len(payload)}


def main() -> None:
    days = []
    current = FROM
    while current <= TO:
        days.append(current)
        current += timedelta(days=1)
    work = [(dataset, day) for day in days for dataset in TREES]
    rows: list[dict[str, object]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        for row in pool.map(lambda item: one(*item), work):
            rows.append(row)
    unavailable = [r for r in rows if r["status"] == "unavailable"]
    complete_days = sorted({
        r["value"] for r in rows if r["status"] != "unavailable"
    } - {r["value"] for r in unavailable})
    audit = {
        "window": [FROM.isoformat(), TO.isoformat()],
        "datasets": sorted(TREES),
        "downloaded": sum(1 for r in rows if r["status"] == "downloaded"),
        "cached": sum(1 for r in rows if r["status"] == "cached"),
        "unavailable": unavailable,
        "complete_days": complete_days,
        "last_complete_day": complete_days[-1] if complete_days else None,
        "bytes": sum(int(r.get("bytes", 0)) for r in rows),
        "rows": rows,
    }
    (SOURCE / f"september_download_audit_{FROM}_{TO}.json").write_text(json.dumps(audit, indent=1))
    print(json.dumps({k: v for k, v in audit.items() if k != "rows"}, indent=1), flush=True)


if __name__ == "__main__":
    main()
