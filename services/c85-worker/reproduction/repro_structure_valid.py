"""Reproduce `structure_valid` from its original source chain (C75 -> C76 -> C79).

`research_c85/kalshi.py:27` sets ``f['structure_valid'] = f81.source_valid``.
``research_c81/run.py`` asserts that column equals the C79 indicator's
``source_valid``, which is itself ``research_c79/source.py:73``:

    match & previous.source_valid & first/last source offsets & finite NEW features

with ``previous`` the C76 indicator (``research_c76/source.py:73``), whose own
``source_valid`` chains onto the C75 context (``research_c75/source.py:98``).

Nothing is transcribed here: the original modules are imported and executed.
Their only external input is the Binance SPOT BTCUSDT 1m minute ledger (field
order per ``research_c68/audit_quote_data.py:16``: open_ms, open, high, low,
close, base_volume, close_ms, quote_volume, trade_count, taker_buy_base,
taker_buy_quote) plus the two t5 spot columns the C75 builder reads from the
target frame.

Result (2026-02-06T23:00Z .. 2026-08-31T23:45Z, 19,487 targets):
    expected 19,407 valid / 80 invalid
    computed 19,407 valid / 80 invalid, 0 mismatches

Both the valid and the invalid cases are therefore exercised; the flag is
computed, never pinned true.

Usage:
    LAB=<unpacked C85_Upstream_Recovery>/lab/c81/lab \
    MINUTES=btc_minutes_spot.parquet PACKET=upstream_packet.parquet \
    python3 repro_structure_valid.py
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

LAB = os.environ.get("LAB", "/tmp/upx/upstream/lab/c81/lab")
MINUTES = os.environ.get("MINUTES", "/tmp/c79/btc_minutes_spot.parquet")
PACKET = os.environ.get("PACKET", "/tmp/c85/kit/fixtures/upstream_packet.parquet")

sys.path.insert(0, LAB)
from research_c75 import source as c75  # noqa: E402
from research_c76 import source as c76  # noqa: E402
from research_c79 import source as c79  # noqa: E402


def main() -> int:
    btc = pd.read_parquet(MINUTES)
    packet = pd.read_parquet(PACKET)
    frame = packet[
        [
            "ts",
            "binance_spot_t5_w005_return_bps",
            "binance_spot_t5_w005_flow_imbalance",
        ]
    ].copy()
    frame["ts"] = pd.to_datetime(frame.ts, utc=True)

    context = c75.build(frame, btc)
    indicator76 = c76.market(frame, btc, context)
    indicator79 = c79.market(frame, btc, indicator76)

    computed = indicator79.source_valid.to_numpy(bool)
    expected = packet.structure_valid.to_numpy(bool)
    mismatches = np.flatnonzero(computed != expected)

    print(
        f"rows={len(expected)} expected_valid={int(expected.sum())} "
        f"expected_invalid={int((~expected).sum())} "
        f"computed_valid={int(computed.sum())} "
        f"computed_invalid={int((~computed).sum())} "
        f"mismatches={len(mismatches)}"
    )
    if len(mismatches):
        head = mismatches[:20]
        print(
            pd.DataFrame(
                {
                    "ts": frame.ts.iloc[head],
                    "expected": expected[head],
                    "computed": computed[head],
                }
            ).to_string()
        )
        return 1
    assert computed.any() and not computed.all(), "both cases must be exercised"
    print("PASS: structure_valid reproduced exactly (valid and invalid cases)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
