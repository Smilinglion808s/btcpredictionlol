"""Version 1 outbound dispatch preparation — DEFAULT OFF.

This module decides whether a freshly committed Version 1 decision may carry an
`outbox` request to the backend. It NEVER sends anything itself: the worker
holds no bot endpoint and no webhook secret. All it can do is ask the signed
backend to enqueue one durable, idempotent entry — and the backend has its own,
independent human-enabled control that is also off.

Two switches, both absent by default:

  * worker  : ``LITEA_EXECUTION_ENABLED=true``        (this module)
  * backend : ``LITEA_SERVER_EXECUTION_ENABLED=true`` (src/lib/litea/dispatch.server.ts)

Neither is set by a deploy, a restart or a default. With either missing, this
module returns no outbox request at all and the decision is committed exactly
as it is today: recorded, shadow, unsent.

Timing: the [T, T+5s) feature window is a MODEL rule and is not touched here.
The transport deadline is a separate, Version-1-only configuration
(``LITEA_TRANSPORT_DEADLINE_MS``, default 8000 ms measured from target open).
It is the send GOAL, not a drop: a decision that misses it is still requested,
late, while its target candle is open. The hard cap is the candle close
(``LITEA_SEND_HARD_CAP_MS``, default 900000 ms).
"""
from __future__ import annotations

import math
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

from .identity import MODEL_ID

EXECUTION_ENV = "LITEA_EXECUTION_ENABLED"
DEADLINE_ENV = "LITEA_TRANSPORT_DEADLINE_MS"
DEFAULT_TRANSPORT_DEADLINE_MS = 8_000
MAX_TRANSPORT_DEADLINE_MS = 60_000

HARD_CAP_ENV = "LITEA_SEND_HARD_CAP_MS"
DEFAULT_SEND_HARD_CAP_MS = 900_000
MAX_SEND_HARD_CAP_MS = 900_000


def execution_enabled(env: Mapping[str, str] | None = None) -> bool:
    """Explicit opt-in only. Absent, empty or anything but 'true' means OFF."""
    source = os.environ if env is None else env
    return str(source.get(EXECUTION_ENV, "")).strip().lower() == "true"


def transport_deadline_ms(env: Mapping[str, str] | None = None) -> int:
    source = os.environ if env is None else env
    raw = str(source.get(DEADLINE_ENV, "")).strip()
    if not raw:
        return DEFAULT_TRANSPORT_DEADLINE_MS
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_TRANSPORT_DEADLINE_MS
    if value <= 0 or value > MAX_TRANSPORT_DEADLINE_MS:
        return DEFAULT_TRANSPORT_DEADLINE_MS
    return value


def send_hard_cap_ms(env: Mapping[str, str] | None = None) -> int:
    source = os.environ if env is None else env
    raw = str(source.get(HARD_CAP_ENV, "")).strip()
    if not raw:
        return DEFAULT_SEND_HARD_CAP_MS
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_SEND_HARD_CAP_MS
    if value <= 0 or value > MAX_SEND_HARD_CAP_MS:
        return DEFAULT_SEND_HARD_CAP_MS
    return value


def dedupe_key(ticker: str, target_open_utc: str) -> str:
    """Stable event identity: one per model, contract and interval.

    Retries reuse it, so a transport retry can never become a second reservation.
    It does NOT by itself guarantee one broker fill — the external bot has to
    honour it.
    """
    open_utc = _instant(target_open_utc)
    iso = open_utc.isoformat().replace("+00:00", "Z") if open_utc else str(target_open_utc)
    return f"{MODEL_ID}:{ticker}:{iso}"


def _instant(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def prepare_outbox(
    row: Mapping[str, Any],
    *,
    now_ms: float,
    env: Mapping[str, str] | None = None,
) -> tuple[dict[str, Any] | None, str]:
    """Return ``(outbox_request, reason)`` for one already-built decision row.

    The row is the source of truth: identity, admission, head, validity and
    measured timing all come from what is actually being committed. Anything
    missing, wrong or stale returns no outbox request.
    """
    if not execution_enabled(env):
        return None, "EXECUTION_DISABLED"
    if str(row.get("model_version")) != MODEL_ID:
        return None, "WRONG_MODEL_IDENTITY"
    if str(row.get("run_mode")) != "LIVE":
        return None, "NOT_LIVE"

    side = row.get("final_side")
    if side not in (1, -1):
        return None, "ABSTAIN"

    features = row.get("features") or {}
    if features.get("input_valid") is not True:
        return None, "INPUT_INVALID"
    head_id = ((features.get("lite_a") or {}).get("head_id")) or None
    if not head_id:
        return None, "NO_HEAD"

    ticker = str(row.get("ticker") or "")
    target_open = _instant(row.get("target_open_utc"))
    if not ticker or target_open is None:
        return None, "BAD_TARGET_IDENTITY"

    offset = _finite(row.get("publication_offset_ms"))
    if offset is None or offset < 0:
        return None, "TIMING_UNAVAILABLE"

    deadline_ms = transport_deadline_ms(env)
    target_ms = target_open.timestamp() * 1000.0
    age_ms = _finite(now_ms - target_ms)
    if age_ms is None or age_ms < 0:
        return None, "CLOCK_UNUSABLE"
    if age_ms >= deadline_ms:
        return None, "EXPIRED"

    expires_at = (target_open + timedelta(milliseconds=deadline_ms)).isoformat()
    return (
        {
            "dedupe_key": dedupe_key(ticker, row["target_open_utc"]),
            # The backend rebuilds the delivered payload from the persisted
            # decision; this is provenance for the request itself.
            "payload": {
                "model": MODEL_ID,
                "requested_by": "litea-worker",
                "head_id": head_id,
                "transport_deadline_ms": deadline_ms,
                "age_at_request_ms": round(age_ms, 3),
            },
            "expires_at": expires_at,
        },
        "REQUESTED",
    )
