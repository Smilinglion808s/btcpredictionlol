"""Reconstruct t5_second_path_features.csv (seq_* columns) from Binance spot
one-second archives.

The original writer (t5_second_path_challenger_r1) was not recovered.  The
consumed contract is fully specified by its two consumers:

  * t0_t5_coverage_bridge_audit_r1.build_continuous_frame() reads
    ts, seq_complete, seq_ret_5s_bps, seq_range_5s_bps, seq_quote_flow_5s,
    seq_log_quote_volume_5s, seq_log_trade_count_5s and requires seq_complete
    for every 15-minute slot of the extension schedule.
  * t0_t5_coverage_bridge_audit_r1.raw_feature_parity() equates those columns
    with t5_precision_lab's t5_ret_bps / t5_range_bps / t5_quote_flow /
    t5_log_quote_volume / t5_log_trade_count, whose formulas are pinned in
    src/lib/t45/features.ts (first five one-second bars of the target candle).

This module therefore recomputes exactly those quantities from the raw
one-second archives.  It is reconstruction output, not the original artifact.
"""

from __future__ import annotations

import argparse
import io
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

COLUMNS = [
    "open_time",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "close_time",
    "quote_volume",
    "count",
    "taker_buy_volume",
    "taker_buy_quote_volume",
    "ignore",
]


def read_day(path: Path) -> pd.DataFrame:
    with zipfile.ZipFile(path) as archive:
        name = archive.namelist()[0]
        payload = archive.read(name)
    frame = pd.read_csv(io.BytesIO(payload), header=None, names=COLUMNS)
    if str(frame.open_time.iloc[0]).lstrip("-").isdigit() is False:
        frame = pd.read_csv(io.BytesIO(payload))
        frame.columns = COLUMNS
    open_time = frame.open_time.astype("int64")
    unit = "us" if open_time.iloc[0] > 10**14 else "ms"
    frame["ts"] = pd.to_datetime(open_time, unit=unit, utc=True)
    return frame


def build(days: list[Path]) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    for path in sorted(days):
        frame = read_day(path).sort_values("ts").reset_index(drop=True)
        frame = frame.set_index("ts")
        boundaries = pd.date_range(
            frame.index[0].ceil("15min"),
            frame.index[-1],
            freq="15min",
        )
        for boundary in boundaries:
            window = frame.loc[boundary : boundary + pd.Timedelta(seconds=4)]
            expected = pd.date_range(boundary, periods=5, freq="1s")
            complete = len(window) == 5 and bool((window.index == expected).all())
            record: dict[str, object] = {"ts": boundary, "seq_complete": complete}
            if not complete:
                rows.append(record)
                continue
            base_open = float(window.open.iloc[0])
            quote = float(window.quote_volume.sum())
            buy_quote = float(window.taker_buy_quote_volume.sum())
            trades = float(window["count"].sum())
            if not np.isfinite(base_open) or base_open <= 0:
                record["seq_complete"] = False
                rows.append(record)
                continue
            record.update(
                {
                    "seq_ret_5s_bps": float(
                        np.log(float(window.close.iloc[-1]) / base_open) * 10_000
                    ),
                    "seq_range_5s_bps": float(
                        (float(window.high.max()) - float(window.low.min()))
                        / base_open
                        * 10_000
                    ),
                    "seq_quote_flow_5s": (
                        float(2.0 * buy_quote / quote - 1.0) if quote > 0 else np.nan
                    ),
                    "seq_log_quote_volume_5s": float(np.log1p(max(quote, 0.0))),
                    "seq_log_trade_count_5s": float(np.log1p(max(trades, 0.0))),
                    "seq_quote_volume_5s": quote,
                    "seq_trade_count_5s": trades,
                    "seq_base_open": base_open,
                }
            )
            rows.append(record)
    out = pd.DataFrame(rows).sort_values("ts").reset_index(drop=True)
    if out.ts.duplicated().any():
        raise RuntimeError("duplicate boundaries in reconstruction")
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archives", required=True)
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    start = pd.Timestamp(args.start)
    end = pd.Timestamp(args.end)
    days = [
        path
        for path in Path(args.archives).glob("BTCUSDT-1s-*.zip")
        if start.strftime("%Y-%m-%d")
        <= path.stem.split("BTCUSDT-1s-")[-1]
        <= end.strftime("%Y-%m-%d")
    ]
    if not days:
        raise SystemExit("no archives in range")
    frame = build(days)
    frame = frame[(frame.ts >= start.tz_localize("UTC")) & (frame.ts < end.tz_localize("UTC"))]
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(args.out, index=False)
    print(
        f"rows={len(frame)} complete={int(frame.seq_complete.sum())} "
        f"first={frame.ts.iloc[0]} last={frame.ts.iloc[-1]}"
    )


if __name__ == "__main__":
    main()
