"""Webhook dispatch guards for C85: duplicate protection and expiry.

The betting bot must never receive two payloads for the same target, and must
never receive a payload that arrived too late to act on. Both rules are decided
here and enforced twice:

  * the dedupe key is a natural key (model version + ticker + target open), so
    the transactional outbox rejects a second row for the same target,
  * the expiry is the T+5s publication deadline, so a payload that could not be
    dispatched in time is recorded as MISSED instead of sent late.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from .config import MODEL_VERSION, PUBLICATION_DEADLINE_MS


def dedupe_key(ticker: str, target_open: datetime) -> str:
    open_utc = target_open.astimezone(timezone.utc)
    return f"{MODEL_VERSION}:{ticker}:{open_utc.strftime('%Y%m%dT%H%M%SZ')}"


def expires_at(target_open: datetime) -> datetime:
    return target_open.astimezone(timezone.utc) + timedelta(milliseconds=PUBLICATION_DEADLINE_MS)


def is_expired(target_open: datetime, now: datetime | None = None) -> bool:
    return (now or datetime.now(timezone.utc)) > expires_at(target_open)


def outbox_record(
    ticker: str, target_open: datetime, payload: dict[str, Any]
) -> dict[str, Any]:
    """The outbox row that travels inside the decision commit transaction."""
    return {
        "dedupe_key": dedupe_key(ticker, target_open),
        "payload": payload,
        "expires_at": expires_at(target_open).isoformat(),
    }


def eligible(final_side: int, status: str, target_open: datetime,
             now: datetime | None = None) -> tuple[bool, str | None]:
    """Only a directional, on-time, non-abstained decision may be dispatched."""
    if status != "OK":
        return False, f"status={status}"
    if final_side == 0:
        return False, "abstain"
    if is_expired(target_open, now):
        return False, "expired_past_T+5s"
    return True, None
