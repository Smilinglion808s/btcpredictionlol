"""Live transcription of ``evaluate_external_direction_r1.directional_matrix``.

Provenance (the only authority for every line below):

    file   evaluate_external_direction_r1.py
    lines  69-152 (``directional_matrix``)
    copy   C85_Upstream_Recovery / ancestor kit,
           source/eb8e707686c9/evaluate_external_direction_r1.py
           (a byte-identical second copy exists at
            legacy_lab2/sources/T0_T5_MULTIVENUE_LAB_R1_COMPACT.zip__expanded/)

The function is a **pure, stateless column transform** of the merged multivenue
observation frame: given the venue feature columns for a target timestamp it
emits the directional design matrix that the direction head consumes. It holds
no rolling buffer and no fitted parameter, so serialising and restoring it is a
no-op — stated plainly rather than implied by a "state" API it does not need.

What this DOES make live: the design-matrix construction, previously available
only as an archived ledger column.

What it does NOT make live, and the next missing producer:
``build_multivenue_features_r1.py`` — the raw-tape producer that turns Binance
/ Deribit / Hyperliquid events into the ``*_t0_*`` / ``*_t5_*`` columns this
function reads. Its causal contract (line 272) is the source of the model's
input cutoff: "T0 windows end strictly before T. T+5 windows include exchange
events timestamped in [T,T+5s)." Until that producer exists live, this module
is fed archived observations only, and that is a fixture harness, not live
parity.
"""
from __future__ import annotations

from typing import Any, Callable

import numpy as np
import pandas as pd

# The exact venue sets used by the original lab (c30_c70_lab_manager_r2.py 33-48).
SOURCE_SETS: dict[str, set[str]] = {
    "BINANCE": {"binance"},
    "BINANCE_DERIBIT": {"binance", "deribit"},
    "BINANCE_HYPERLIQUID": {"binance", "hyperliquid"},
    "ALL3": {"binance", "deribit", "hyperliquid"},
}


def directional_matrix(frame: pd.DataFrame, sources: set[str], stage: str) -> pd.DataFrame:
    """Verbatim transcription of evaluate_external_direction_r1.py lines 69-152."""
    result = pd.DataFrame(index=frame.index)

    def add(
        output_name: str,
        column: str,
        *,
        transform: Callable[[pd.Series], pd.Series] | None = None,
    ) -> None:
        if column not in frame:
            return
        values = pd.to_numeric(frame[column], errors="coerce").replace([np.inf, -np.inf], np.nan)
        result[output_name] = transform(values) if transform else values

    def log_positive(values: pd.Series) -> pd.Series:
        return np.log1p(values.clip(lower=0))

    minute = frame["ts"].dt.hour * 60 + frame["ts"].dt.minute
    result["clock_sin"] = np.sin(2 * np.pi * minute / 1440)
    result["clock_cos"] = np.cos(2 * np.pi * minute / 1440)
    result["week_sin"] = np.sin(2 * np.pi * frame["ts"].dt.dayofweek / 7)
    result["week_cos"] = np.cos(2 * np.pi * frame["ts"].dt.dayofweek / 7)

    if "binance" in sources:
        for venue in ("spot", "um"):
            for window in ("005", "060", "900"):
                prefix = f"binance_{venue}_t0_w{window}"
                for field in ("return_bps", "flow_imbalance", "price_flow_alignment"):
                    add(f"{prefix}_{field}", f"{prefix}_{field}")
                add(f"{prefix}_log_quote_volume", f"{prefix}_quote_volume", transform=log_positive)
                add(f"{prefix}_max_trade_share", f"{prefix}_max_trade_share")
            if stage == "T5":
                for window in ("001", "003", "005"):
                    prefix = f"binance_{venue}_t5_w{window}"
                    for field in ("return_bps", "flow_imbalance", "price_flow_alignment"):
                        add(f"{prefix}_{field}", f"{prefix}_{field}")
                    add(f"{prefix}_log_quote_volume", f"{prefix}_quote_volume", transform=log_positive)
                    add(f"{prefix}_max_trade_share", f"{prefix}_max_trade_share")
        for horizon in (("t0",) if stage == "T0" else ("t0", "t5")):
            add(f"binance_cross_{horizon}_flow_agreement", f"binance_cross_{horizon}_flow_agreement_5s")
            add(f"binance_cross_{horizon}_return_agreement", f"binance_cross_{horizon}_return_agreement_5s")
            add(f"binance_cross_{horizon}_flow_gap", f"binance_cross_{horizon}_flow_gap_5s")
            add(f"binance_cross_{horizon}_return_gap", f"binance_cross_{horizon}_return_gap_5s")

    if "deribit" in sources:
        for tag in ("15m", "1h", "4h"):
            prefix = f"deribit_t0_{tag}"
            for field in ("directional_flow", "put_call_ratio", "iv", "put_minus_call_iv"):
                add(f"{prefix}_{field}", f"{prefix}_{field}")
            add(f"{prefix}_log_premium", f"{prefix}_premium_usd", transform=log_positive)
            add(f"{prefix}_log_trade_count", f"{prefix}_trade_count", transform=log_positive)
        add("deribit_dvol_close", "deribit_dvol_close")
        add("deribit_dvol_range_1m", "deribit_dvol_range_1m")
        for minutes in (1, 5, 15, 60):
            add(f"deribit_dvol_change_{minutes}m", f"deribit_dvol_change_{minutes}m")
        if stage == "T5":
            add("deribit_t5_directional_flow", "deribit_t5_w005_directional_flow")
            add("deribit_t5_log_premium", "deribit_t5_w005_premium_usd", transform=log_positive)
            add("deribit_t5_log_trade_count", "deribit_t5_w005_trade_count", transform=log_positive)

    if "hyperliquid" in sources:
        for column in (
            "hyperliquid_t0_return_bps_15m",
            "hyperliquid_t0_range_bps_15m",
            "hyperliquid_t0_close_location_15m",
            "hyperliquid_t0_return_bps_1h",
            "hyperliquid_t0_return_bps_4h",
            "hyperliquid_t0_volume_z_1d",
            "hyperliquid_t0_hourly_return_bps_1h",
            "hyperliquid_t0_hourly_range_bps_1h",
            "hyperliquid_t0_hourly_return_bps_4h",
            "hyperliquid_t0_hourly_realized_range_4h",
            "hyperliquid_funding_rate",
            "hyperliquid_premium",
            "hyperliquid_premium_change_1h",
            "hyperliquid_funding_change_1h",
            "hyperliquid_premium_mean_8h",
        ):
            add(column, column)
    return result.replace([np.inf, -np.inf], np.nan)


def row_features(
    observation: dict[str, Any],
    target_ts: pd.Timestamp,
    *,
    sources: set[str],
    stage: str,
) -> dict[str, float | None]:
    """One target, one call. Identical arithmetic to the frame-wise function.

    `observation` holds the raw multivenue columns for this target only; every
    absent column stays absent (the original `add` skips missing columns) and
    every non-finite value becomes NaN, never an imputed number.
    """
    frame = pd.DataFrame([{**observation, "ts": pd.Timestamp(target_ts)}])
    row = directional_matrix(frame, sources, stage).iloc[0]
    return {name: (None if pd.isna(value) else float(value)) for name, value in row.items()}
