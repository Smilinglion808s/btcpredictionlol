"""Direction-60 and correctness-55 feature construction from raw feeds.

STATUS: PORT PENDING — this module fails closed and never fabricates a value.

The 60 direction inputs and the non-auxiliary part of the 55 correctness inputs
are defined by the recovered research code, not by their column names. Porting
them means transcribing, without changing the mathematics:

    ancestor_source/lab/lab_recovered/BTC15M_C71_RESEARCH_CHECKPOINT_2026-09-05/
        research_c71/run_c71.py            model_frame, cm_valid, load
        research_c71/audit_c71.py          EXTRA, SIGNED column sets
        research_c67/build_trade_side_features.py   t0/t5 window trade features
        research_c68/run_c68_quote_reference.py     BTCUSDC quote premium anchors
        research_c69/run_c69_index_reference.py     index anchor basis
        research_c63/run_c63_source_correction.py   source validity corrections
        research_c57/build_c57_kalshi_anchor_rebase_r1.py  meta_matrix, anchors

Until each of those is transcribed and checked against
`fixtures/direction60.parquet` and `fixtures/meta55.parquet` on the same target
rows, live feature construction is unavailable. Guessing a formula from a column
name would silently change C85, so `build_direction_features` raises instead.

`auxiliary_features` IS available: it is the unchanged `features()` function from
`source/research_c85/auxiliary.py`, which needs only completed Binance spot
one-minute klines ending at T-1ms.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pandas as pd

from .c85 import auxiliary_source


class FeatureUnavailable(RuntimeError):
    """Raised when a faithful feature vector cannot be built. Never substituted."""


PORT_PENDING = {
    "direction60": [
        "research_c67/build_trade_side_features.py",
        "research_c68/run_c68_quote_reference.py",
        "research_c69/run_c69_index_reference.py",
        "research_c71/run_c71.py::model_frame",
        "research_c71/run_c71.py::cm_valid",
    ],
    "meta55": [
        "research_c57/build_c57_kalshi_anchor_rebase_r1.py::meta_matrix",
        "research_c71/audit_c71.py::EXTRA,SIGNED",
    ],
}


@dataclass(frozen=True)
class Packet:
    """A frozen, timestamped input packet for one target."""

    target_open_ns: int
    packet_freeze_ns: int
    direction: dict[str, float | None]
    meta_partial: dict[str, float | None]
    auxiliary: dict[str, float | None]
    validity: dict[str, bool]
    source_ids: dict[str, Any]
    watermarks: dict[str, Any]
    last_event_ns: int
    last_receipt_ns: int


def auxiliary_features(minutes: pd.DataFrame) -> pd.DataFrame:
    """Unchanged auxiliary 23-feature construction (Binance spot 1m, ends T-1ms)."""
    return auxiliary_source.features(minutes)


def build_direction_features(*_args: Any, **_kwargs: Any) -> dict[str, float | None]:
    raise FeatureUnavailable(
        "C85_FEATURES_NOT_PORTED: the direction-60 vector must be transcribed from "
        + ", ".join(PORT_PENDING["direction60"])
        + " and validated against fixtures/direction60.parquet before any live packet."
    )


def build_meta_features(*_args: Any, **_kwargs: Any) -> dict[str, float | None]:
    raise FeatureUnavailable(
        "C85_FEATURES_NOT_PORTED: the correctness-55 vector must be transcribed from "
        + ", ".join(PORT_PENDING["meta55"])
        + " and validated against fixtures/meta55.parquet before any live packet."
    )
