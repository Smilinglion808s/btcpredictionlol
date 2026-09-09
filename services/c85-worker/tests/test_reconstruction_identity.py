"""Reconstruction identity, and the logging/dispatch separation.

Two properties are protected here:

1. Nothing this build writes may carry the archived `c85-multi-meta-r1`
   identity, and the archived id may not be configured as the reconstruction
   id. Mixing the two would silently attach archived performance claims to
   reconstructed rows.
2. Logging readiness and execution dispatch are independent. A build with
   dispatch suppressed must still be able to arm the scheduler and record
   decisions; the previous single gate made suppressed logging impossible.
"""
from __future__ import annotations

import os

import pytest

from src import reconstruction
from src.orchestration import RawPacketUnavailable
from src.packets import LivePacketSource


def test_reconstruction_id_is_not_the_archived_version(monkeypatch):
    monkeypatch.delenv("C85_RECONSTRUCTION_ID", raising=False)
    assert reconstruction.reconstruction_id() == "c85-reconstruction-r1"
    assert reconstruction.logging_model_version() != reconstruction.ARCHIVED_MODEL_VERSION


def test_configuring_the_archived_version_is_refused(monkeypatch):
    monkeypatch.setenv("C85_RECONSTRUCTION_ID", reconstruction.ARCHIVED_MODEL_VERSION)
    with pytest.raises(reconstruction.ReconstructionIdentityError):
        reconstruction.logging_model_version()


def test_identity_stamp_disclaims_archived_performance(monkeypatch):
    monkeypatch.delenv("C85_RECONSTRUCTION_ID", raising=False)
    stamp = reconstruction.identity()
    assert stamp["lineage"] == "RECONSTRUCTION"
    assert stamp["inherits_archived_performance"] is False
    assert stamp["archive_parity_verified"] is False
    assert stamp["supersedes_archived"] == reconstruction.ARCHIVED_MODEL_VERSION


def test_artifact_namespace_is_separated(monkeypatch):
    monkeypatch.delenv("C85_RECONSTRUCTION_ID", raising=False)
    assert reconstruction.artifact_namespace("checkpoints") == (
        "checkpoints/c85-reconstruction-r1/"
    )
    with pytest.raises(reconstruction.ReconstructionIdentityError):
        reconstruction.artifact_namespace("secrets")


# --- live packet source ----------------------------------------------------


class _Buffer:
    def __init__(self) -> None:
        self.trades: list = []

    def slice(self, *_args):  # noqa: D401 - test double
        return []


class _Feeds:
    def __init__(self, missing: list[str]) -> None:
        self._missing = missing
        self.buffers = {"binance_spot": _Buffer(), "binance_um": _Buffer()}

    def missing(self, _at_ns=None):
        return list(self._missing)


class _Experts:
    chain = None

    @staticmethod
    def status():
        return {"blocking_reasons": ["C85_LEAF_PRODUCERS_UNPORTED"]}


def test_packet_source_reports_every_blocker_at_once():
    from datetime import datetime, timezone

    source = LivePacketSource(feeds=_Feeds(["kalshi"]), experts=_Experts())
    target = datetime(2026, 9, 9, 14, 0, tzinfo=timezone.utc)
    with pytest.raises(RawPacketUnavailable) as excinfo:
        source.build(target, int(target.timestamp() * 1_000_000_000) + 5_000_000_000)
    message = str(excinfo.value)
    assert "C85_FEEDS_STALE_AT_CUTOFF" in message
    assert "C85_MARKET_WINDOW_MISSING" in message
    assert "C85_EXPERT_CHAIN_NOT_INSTANTIATED" in message


def test_packet_source_never_returns_a_partial_packet():
    """No code path may return TargetInputs while a dependency is unmet."""
    from datetime import datetime, timezone

    source = LivePacketSource(feeds=_Feeds([]), experts=_Experts())
    target = datetime(2026, 9, 9, 14, 0, tzinfo=timezone.utc)
    with pytest.raises(RawPacketUnavailable):
        source.build(target, int(target.timestamp() * 1_000_000_000) + 5_000_000_000)
