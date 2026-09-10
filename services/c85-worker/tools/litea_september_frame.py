"""Assemble the genuine Version 1 (lite-a-floor4-top10-r1) September frame.

Offline whole-day builder. Every stage — the Binance spot/UM aggregate-trade
windows, the T+5s spot anchor, the Kalshi floor strike, the quote/index prior
minutes and the 16-minute COIN-M context — comes from `src.litea.reconstruct`,
which is the same module the live startup bridge uses. The recipe therefore has
exactly one definition and cannot drift between offline and runtime recovery.
"""
from __future__ import annotations

import sys
from datetime import timedelta
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.litea.reconstruct import (  # noqa: E402
    kalshi_market,
    load_agg,
    load_klines,
    target_feature_row,
)


def build(start: str, end: str) -> pd.DataFrame:
    targets = pd.date_range(start, end, freq="15min", tz="UTC")
    days = sorted({d.strftime("%Y-%m-%d") for d in targets} |
                  {(targets[0] - timedelta(days=1)).strftime("%Y-%m-%d")})
    markets = {target: kalshi_market(target) for target in targets}

    klines: dict[str, pd.DataFrame] = {}
    for kind in ("spot_1m", "usdc_1m", "index_1m", "cm_1m"):
        klines[kind] = (
            pd.concat([load_klines(kind, day) for day in days], ignore_index=True)
            .drop_duplicates("open_ms")
            .set_index("open_ms")
            .sort_index()
        )

    rows: list[dict] = []
    for day in days[1:]:
        previous = days[days.index(day) - 1]
        spot = pd.concat(
            [load_agg("spot_agg", previous).tail(2_000_000), load_agg("spot_agg", day)],
            ignore_index=True,
        )
        um = pd.concat(
            [load_agg("um_agg", previous).tail(2_000_000), load_agg("um_agg", day)],
            ignore_index=True,
        )
        day_targets = [t for t in targets if t.strftime("%Y-%m-%d") == day]
        for target in day_targets:
            rows.append(target_feature_row(target, spot, um, klines, markets[target]))
        print(f"{day}: {len(day_targets)} targets", flush=True)
    return pd.DataFrame(rows)


if __name__ == "__main__":
    start, end, destination = sys.argv[1], sys.argv[2], sys.argv[3]
    frame = build(start, end)
    Path(destination).parent.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(destination, index=False)
    valid = int(frame.input_valid.sum())
    print(
        f"rows={len(frame)} input_valid={valid} labelled={int(frame.label.notna().sum())} "
        f"-> {destination}"
    )
