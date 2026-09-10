"""Which price becomes Version 1's `floor_strike`, and how that is recorded.

Priority, fixed:

    1. the OFFICIAL same-contract `floor_strike` (either official endpoint),
    2. the CF Benchmarks BRTI opening-boundary reference,
    3. the Chainlink Data Streams opening-boundary reference.

Rules that do not bend:

  * an official value is never overwritten, and a LATE official value is audit
    evidence only — a published decision and its frozen features are immutable;
  * the two OFFICIAL paths disagreeing is still a refusal, because that is a
    contract-identity defect, not an estimate;
  * a CF/Chainlink value differing from a later official strike is NOT a
    conflict; the difference is recorded;
  * every fallback decision carries `estimated=True`, its source, method,
    window, receipt and age, plus each source's failure reason;
  * settlement is unaffected: only official Kalshi results grade a decision.
"""
from __future__ import annotations

import math
from typing import Any

#: Free public spot backups. Decisions made under this policy are versioned
#: separately from the earlier paid-reference policy (`strike-fallbacks-r1`),
#: so an audit can always tell which sources a frozen row could have used.
INPUT_POLICY_VERSION = "strike-fallbacks-free-r1"
PRIORITY = ("official", "coinbase_btcusd", "kraken_btcusd")


def _official(market: dict[str, Any] | None) -> float | None:
    if not market:
        return None
    value = market.get("floor_strike")
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def choose_strike(
    market: dict[str, Any] | None,
    references: dict[str, Any],
    target_ms: int,
    freeze_ns: int,
    *,
    official_conflict: bool = False,
) -> dict[str, Any]:
    """Pick the strike for this target from candidates already received."""
    candidates: dict[str, Any] = {}
    failures: dict[str, str] = {}

    official = None if official_conflict else _official(market)
    if official is not None:
        candidates["official"] = {
            "source": "official",
            "estimated": False,
            "usable": True,
            "value": official,
            "method": "venue_floor_strike",
            "receipt_ns": market.get("receipt_ns") if market else None,
        }
    else:
        failures["official"] = (
            "official_paths_disagree" if official_conflict
            else ("market_not_received" if not market else "no_floor_strike")
        )

    for name in PRIORITY[1:]:
        buffer = references.get(name)
        if buffer is None:
            failures[name] = "not_configured"
            continue
        candidate = buffer.boundary_reference(target_ms, freeze_ns)
        candidates[name] = candidate
        if not candidate.get("usable"):
            failures[name] = str(candidate.get("reason") or "unusable")

    chosen: dict[str, Any] | None = None
    # A genuine PRE-FREEZE disagreement between the two official readings of the
    # same contract is a contract-identity defect. It is refused outright — an
    # estimate is a substitute for a MISSING strike, never a tiebreaker between
    # two contradictory official ones.
    for name in () if official_conflict else PRIORITY:
        candidate = candidates.get(name)
        if candidate and candidate.get("usable"):
            chosen = {**candidate, "source": name}
            break

    record: dict[str, Any] = {
        "input_policy_version": INPUT_POLICY_VERSION,
        "strike_source": None if chosen is None else chosen["source"],
        "estimated": bool(chosen and chosen.get("estimated")),
        "strike": None if chosen is None else float(chosen["value"]),
        "method": None if chosen is None else chosen.get("method"),
        "event_window": None if chosen is None else chosen.get("event_window"),
        "value_receipt_ns": None if chosen is None else (
            None if chosen.get("receipt_ns") is None else str(chosen["receipt_ns"])
        ),
        "source_age_ms": None if chosen is None else chosen.get("source_age_ms"),
        "tick_count": None if chosen is None else chosen.get("tick_count"),
        "official_conflict": bool(official_conflict),
        "refused": "official_paths_disagree" if official_conflict else None,
        "source_failures": failures,
        "candidates": {
            name: {k: v for k, v in candidate.items() if k != "event_window_ms"}
            for name, candidate in candidates.items()
        },
    }
    return record


def official_difference(record: dict[str, Any], official_strike: Any) -> dict[str, Any] | None:
    """AUDIT ONLY: how far an estimate sat from the strike published later.

    Never used to change a frozen decision, a feature or a settlement.
    """
    if not record or not record.get("estimated") or record.get("strike") is None:
        return None
    try:
        official = float(official_strike)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(official):
        return None
    used = float(record["strike"])
    return {
        "official_strike": official,
        "used_strike": used,
        "difference": round(used - official, 6),
        "strike_source": record.get("strike_source"),
        "audit_only": True,
    }
