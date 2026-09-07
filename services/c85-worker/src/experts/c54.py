"""Live port of the C54 error-complementarity router.

Source of truth (frozen research build, transcribed verbatim for the decision
path only):

    vault_work/legacy_lab4/BTC15M_LAB4_FRONTIER_2026-09-04/research_c54/
        build_c54_error_complementarity_router_r1.py

That script builds five candidate "C54" identities (primary_regime_router,
preferred_conflict_abstain, nonconflict_union, consensus_only,
regime_preferred_union) and then reports which one it designates the primary,
shadow-only prediction: ``pred_c54_primary_regime_router`` (identity
``C54_PRIMARY_REGIME_ROUTER``). The ledger column produced downstream and
exposed to consumers is ``c54_prediction``, which is populated purely from
that primary identity (see the evaluation-fixtures ledger: `c54_prediction`
matches `pred_c54_primary_regime_router` for every one of the 19,487 rows
checked in ``tests/test_c54_parity.py``). This module therefore transcribes
ONLY the primary-regime-router candidate; the other four candidates were
research comparators reported for context in the frozen study and were never
the live/ledger prediction.

Decision-time inputs (verbatim from the source, lines ~185-223):

    point = label_regime == "chainlink_point"
    twap  = label_regime == "chainlink_twap60"
    known_regime = point | twap
    preferred_prediction = c51_prediction if point
                            else c42_prediction if twap
                            else 0
    pred_c54_primary_regime_router = preferred_prediction if known_regime else 0

``label_regime`` itself is not a feature C54 computes; it is the market's
settlement-rule regime, which in the frozen study's row space is fully
determined by candle timestamp against two hard cutover instants recorded in
the source module (``POINT_END`` / ``TWAP_START``, both UTC):

    POINT_END   = 2026-08-06 23:45:00 UTC   (inclusive) -> "chainlink_point"
    TWAP_START  = 2026-08-07 00:00:00 UTC   (inclusive) -> "chainlink_twap60"

The frozen study's own integrity checks (``regime_time_violations``,
``regime_domain_violations``) assert that every resolved row's timestamp falls
on the correct side of that single cutover -- i.e. in the row space the source
ever observed, there was no third regime and no gap. A timestamp strictly
between the two constants (there is none in the historical data) has no known
regime, and C54 fails closed (predicts 0) per the source's explicit "unknown
regime => ABSTAIN" candidate definition (see ``candidate_definitions`` in the
source: ``"unknown_regime": "ABSTAIN"``).

C54 never touches raw market/orderbook features, and never touches the label.
Its entire decision surface is:

    * ``ts`` of the candle being decided (raw input, to resolve the regime)
    * ``c42_prediction`` (upstream model output, in {-1, 0, 1})
    * ``c51_prediction`` (upstream model output, in {-1, 0, 1})

Per the task's live-interface requirement, this module does NOT recompute
C42 or C51; callers must supply their already-computed predictions.

Training protocol / fitted state
---------------------------------
There is none. The primary-regime-router candidate has zero fitted
parameters: it is a deterministic, hand-specified router keyed only on
calendar time and the raw (already thresholded to {-1,0,1}) upstream
predictions. The two regime-cutover timestamps are historical facts about
when the underlying Kalshi/CF-Benchmarks settlement rule migrated from a
point-in-time BRTI comparison ("chainlink_point") to a 60-second TWAP
comparison ("chainlink_twap60"); they are not fitted on any label and are
transcribed verbatim as module constants. No replay-to-fit step is required
for this expert. (The other four candidates in the frozen study are likewise
parameter-free routers/unions over the same two upstream predictions and
would not require fitting either, but they are out of scope here because they
are not what ``c54_prediction`` in the ledger reflects.)

Live external data feeds
-------------------------
None beyond what the caller already supplies: the candle timestamp and the
two upstream predictions. C54 makes no network/API calls of its own.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping

import pandas as pd

# Verbatim regime-cutover constants from the frozen research source
# (build_c54_error_complementarity_router_r1.py, module scope).
POINT_END = pd.Timestamp("2026-08-06 23:45:00", tz="UTC")
TWAP_START = pd.Timestamp("2026-08-07 00:00:00", tz="UTC")

_VALID_PREDICTIONS = (-1, 0, 1)


def _resolve_regime(ts: pd.Timestamp) -> str:
    """Return "chainlink_point", "chainlink_twap60", or "unknown" for ``ts``.

    Transcribed verbatim from:
        point = d["label_regime"].eq("chainlink_point")
        twap  = d["label_regime"].eq("chainlink_twap60")
    where, in the frozen study's row space, label_regime is "chainlink_point"
    for every resolved row with ts <= POINT_END and "chainlink_twap60" for
    every resolved row with ts >= TWAP_START (enforced by the source's
    ``regime_time_violations`` integrity check).
    """
    if ts <= POINT_END:
        return "chainlink_point"
    if ts >= TWAP_START:
        return "chainlink_twap60"
    return "unknown"


def _coerce_timestamp(value: Any) -> pd.Timestamp:
    if isinstance(value, pd.Timestamp):
        ts = value
    elif isinstance(value, datetime):
        ts = pd.Timestamp(value)
    elif isinstance(value, (int, float)):
        # Assume epoch seconds, matching the worker's usual packet convention.
        ts = pd.Timestamp(value, unit="s")
    elif isinstance(value, str):
        ts = pd.Timestamp(value)
    else:
        raise C54InputError(f"unsupported ts type for C54 regime resolution: {type(value)!r}")
    if ts.tzinfo is None:
        ts = ts.tz_localize("UTC")
    else:
        ts = ts.tz_convert("UTC")
    return ts


class C54InputError(ValueError):
    """Raised when required C54 decision-time inputs are missing or invalid."""


def _require_prediction(upstream: Mapping[str, Any], key: str) -> int:
    if key not in upstream or upstream[key] is None:
        raise C54InputError(f"C54 requires upstream['{key}'] (fail-closed: missing)")
    value = upstream[key]
    try:
        value = int(value)
    except (TypeError, ValueError) as exc:
        raise C54InputError(f"C54 upstream['{key}'] is not an integer prediction: {value!r}") from exc
    if value not in _VALID_PREDICTIONS:
        raise C54InputError(
            f"C54 upstream['{key}']={value!r} outside domain {_VALID_PREDICTIONS} (fail-closed)"
        )
    return value


class C54Expert:
    """Live C54 "primary regime router": routes between C51 and C42 by
    settlement-regime timestamp cutover, with zero fitted parameters.

    No ``fit``/state-loading step exists or is needed for this expert; see the
    module docstring's "Training protocol / fitted state" section.
    """

    def evaluate(self, packet: Mapping[str, Any], upstream: Mapping[str, Any]) -> dict:
        """Compute the C54 primary-regime-router decision for one candle.

        Args:
            packet: raw per-candle packet; must contain a ``ts`` field
                identifying the candle's timestamp (used only to resolve the
                settlement-rule regime; no other raw feature is consumed).
            upstream: must contain ``c42_prediction`` and ``c51_prediction``,
                each already resolved to {-1, 0, 1} by their own experts.

        Returns:
            {"c54_prediction": int in {-1, 0, 1},
             "c54_regime": "chainlink_point" | "chainlink_twap60" | "unknown",
             "c54_preferred_model": "C51" | "C42" | "NONE"}

        Raises:
            C54InputError: if ``ts`` is missing/unparseable, or if
                ``c42_prediction`` / ``c51_prediction`` are missing or outside
                {-1, 0, 1}. C54 fails closed rather than guessing.
        """
        if packet is None or "ts" not in packet or packet["ts"] is None:
            raise C54InputError("C54 requires packet['ts'] to resolve the settlement-rule regime")

        ts = _coerce_timestamp(packet["ts"])

        # Both upstream predictions are always required: the router needs
        # whichever one the regime prefers, and the frozen source treats a
        # missing/invalid upstream value as a hard input-validation failure
        # (prediction_domain_violations), not a silent abstain.
        c42_prediction = _require_prediction(upstream, "c42_prediction")
        c51_prediction = _require_prediction(upstream, "c51_prediction")

        regime = _resolve_regime(ts)
        if regime == "chainlink_point":
            preferred_model = "C51"
            preferred_prediction = c51_prediction
        elif regime == "chainlink_twap60":
            preferred_model = "C42"
            preferred_prediction = c42_prediction
        else:
            preferred_model = "NONE"
            preferred_prediction = 0

        known_regime = regime != "unknown"
        c54_prediction = int(preferred_prediction) if known_regime else 0

        return {
            "c54_prediction": c54_prediction,
            "c54_regime": regime,
            "c54_preferred_model": preferred_model,
        }
