"""Version 1 worker-side dispatch preparation. Default OFF, no network."""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.litea.dispatch import (  # noqa: E402
    DEFAULT_TRANSPORT_DEADLINE_MS,
    dedupe_key,
    execution_enabled,
    prepare_outbox,
    transport_deadline_ms,
)
from src.litea.identity import MODEL_ID  # noqa: E402

TARGET = "2026-09-10T18:15:00+00:00"
OPEN_MS = datetime.fromisoformat(TARGET).timestamp() * 1000.0
ON = {"LITEA_EXECUTION_ENABLED": "true"}

ROW = {
    "model_version": MODEL_ID,
    "ticker": "KXBTC15M-26SEP101815-T77250",
    "target_open_utc": TARGET,
    "run_mode": "LIVE",
    "final_side": 1,
    "publication_offset_ms": 6120.0,
    "features": {"input_valid": True, "lite_a": {"head_id": "litea-head-2026-09-10"}},
}


def test_off_by_default_in_a_bare_environment():
    assert execution_enabled({}) is False
    assert execution_enabled({"LITEA_EXECUTION_ENABLED": "1"}) is False
    outbox, reason = prepare_outbox(ROW, now_ms=OPEN_MS + 6200, env={})
    assert outbox is None and reason == "EXECUTION_DISABLED"


def test_admitted_call_requests_one_entry():
    outbox, reason = prepare_outbox(ROW, now_ms=OPEN_MS + 6200, env=ON)
    assert reason == "REQUESTED"
    assert outbox["dedupe_key"] == dedupe_key(ROW["ticker"], TARGET)
    assert outbox["payload"]["head_id"] == "litea-head-2026-09-10"
    assert outbox["expires_at"].startswith("2026-09-10T18:15:08")


def test_retry_reuses_the_same_event_identity():
    a, _ = prepare_outbox(ROW, now_ms=OPEN_MS + 1000, env=ON)
    b, _ = prepare_outbox(ROW, now_ms=OPEN_MS + 7000, env=ON)
    assert a["dedupe_key"] == b["dedupe_key"]


def test_every_row_level_rejection():
    def reason(over, now_ms=OPEN_MS + 6200):
        return prepare_outbox({**ROW, **over}, now_ms=now_ms, env=ON)[1]

    assert reason({}) == "REQUESTED"
    assert reason({"final_side": 0}) == "ABSTAIN"
    assert reason({"run_mode": "RESEARCH"}) == "NOT_LIVE"
    assert reason({"model_version": "c85-multi-meta-r1"}) == "WRONG_MODEL_IDENTITY"
    assert reason({"features": {"input_valid": False, "lite_a": {"head_id": "h"}}}) == "INPUT_INVALID"
    assert reason({"features": {"input_valid": True, "lite_a": {}}}) == "NO_HEAD"
    assert reason({"ticker": ""}) == "BAD_TARGET_IDENTITY"
    assert reason({"publication_offset_ms": float("nan")}) == "TIMING_UNAVAILABLE"
    assert reason({"publication_offset_ms": None}) == "TIMING_UNAVAILABLE"
    assert reason({"publication_offset_ms": -5}) == "TIMING_UNAVAILABLE"
    # Stale/replayed history can never acquire a dispatch on a later attempt.
    assert reason({}, now_ms=OPEN_MS + 3_600_000) == "EXPIRED"
    assert reason({}, now_ms=OPEN_MS - 1000) == "CLOCK_UNUSABLE"


def test_transport_deadline_is_version1_only_and_bounded():
    assert transport_deadline_ms({}) == DEFAULT_TRANSPORT_DEADLINE_MS == 8000
    assert transport_deadline_ms({"LITEA_TRANSPORT_DEADLINE_MS": "6500"}) == 6500
    assert transport_deadline_ms({"LITEA_TRANSPORT_DEADLINE_MS": "0"}) == 8000
    assert transport_deadline_ms({"LITEA_TRANSPORT_DEADLINE_MS": "nope"}) == 8000


def test_store_omits_outbox_unless_one_is_prepared():
    """The store's wire call carries no outbox field at all when off."""
    from src.litea.store import LiteAStore

    class FakeBackend:
        def __init__(self):
            self.calls = []

        def call(self, op, **kwargs):
            self.calls.append((op, kwargs))
            return {"ok": True}

    backend = FakeBackend()
    store = LiteAStore(backend, "test-worker")
    store.commit(dict(ROW), None, prepare_outbox(ROW, now_ms=OPEN_MS + 6200, env={})[0])
    assert "outbox" not in backend.calls[-1][1]

    store.commit(dict(ROW), None, prepare_outbox(ROW, now_ms=OPEN_MS + 6200, env=ON)[0])
    assert backend.calls[-1][1]["outbox"]["dedupe_key"].startswith(MODEL_ID)
