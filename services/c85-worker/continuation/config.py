"""Configuration for the one-time C85 continuation rebuild and its incremental advance.

The only research parameter that moves is the *end* of the research window.
Feature definitions, fitting schedules, source venues and model rules are taken
verbatim from the recovered producers; see `endpatch.py` for the audited,
single-constant override that makes the end date configurable.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

WORKER_ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get("C85_CONTINUATION_CACHE",
                            WORKER_ROOT / "evaluation-fixtures" / "cache" / "continuation"))
CHECKPOINTS = CACHE / "checkpoints"
UPSTREAM = Path(os.environ.get("C85_UPSTREAM_ROOT", "/tmp/upx"))

# Frozen research start of the whole ancestry. Never moves.
RESEARCH_START = pd.Timestamp("2025-12-01T00:00:00Z")

# The historical freeze every recovered producer shipped with. Kept for parity:
# a rebuild truncated to this end must reproduce the archived ledgers exactly.
FROZEN_END = pd.Timestamp("2026-09-01T00:00:00Z")

GRID = timedelta(minutes=15)


def _floor15(ts: pd.Timestamp) -> pd.Timestamp:
    return ts.floor("15min")


def research_end() -> pd.Timestamp:
    """Configurable research end (exclusive), floored to the 15-minute grid.

    C85_RESEARCH_END=<iso>  pins the end explicitly (used for parity runs).
    Otherwise the end is the most recent completed quarter-hour boundary.
    """
    raw = os.environ.get("C85_RESEARCH_END")
    if raw:
        return _floor15(pd.Timestamp(raw).tz_convert("UTC")
                        if pd.Timestamp(raw).tzinfo else pd.Timestamp(raw, tz="UTC"))
    now = pd.Timestamp(datetime.now(timezone.utc))
    return _floor15(now)


def is_parity_run() -> bool:
    return research_end() == FROZEN_END


def grid_index(end: pd.Timestamp | None = None) -> pd.DatetimeIndex:
    """The clock grid. Every quarter-hour exists here whether or not a market
    was ever listed; matched-opportunity filtering happens per stage, never by
    dropping grid rows."""
    return pd.date_range(RESEARCH_START, end or research_end(), freq="15min", inclusive="left")


def ensure_dirs() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    CHECKPOINTS.mkdir(parents=True, exist_ok=True)
