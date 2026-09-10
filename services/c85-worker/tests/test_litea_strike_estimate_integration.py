"""An estimated boundary strike must reach the real 60-feature score.

These are integration properties of the shipped fallback policy
(`strike-fallbacks-r1`): a fallback reference price is a normal input to the
unchanged Version 1 feature build, engine and guard; the chosen source is
frozen with the decision; a later official strike is audit evidence only; and
settlement still comes from the official Kalshi result alone.
"""
from __future__ import annotations

import sys
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

warnings.filterwarnings("ignore")

from src.features import (  # noqa: E402
    DIRECTION_ORDER,
    base_anchor_fields,
    build_direction_features,
    index_fields,
    quote_fields,
)
from src.litea.engine import Head, LiteA, wrap_historical_head  # noqa: E402
from src.litea.guard import DailyFloor  # noqa: E402
from src.litea.identity import BASE_MODE, EXCEPTION_RANK, MODEL_ID  # noqa: E402
from src.litea.store import target_row  # noqa: E402
from src.litea.strike_policy import (  # noqa: E402
    INPUT_POLICY_VERSION,
    choose_strike,
    official_difference,
)
from src.reference import ReferenceBuffer  # noqa: E402

from tests.test_stage_empty_window import TARGET_MS, staged_row  # noqa: E402

UTC = timezone.utc
TARGET = datetime.fromtimestamp(TARGET_MS / 1000, UTC)
FREEZE_NS = (TARGET_MS + 5_000) * 1_000_000


def cf_buffer(value: str) -> ReferenceBuffer:
    buffer = ReferenceBuffer("cf_brti", source="cf_brti")
    buffer.record_exact_average(
        value,
        window_size=60,
        window_start_ms=TARGET_MS - 60_000,
        window_end_ms=TARGET_MS,
        receipt_ns=TARGET_MS * 1_000_000 + 400_000_000,
    )
    return buffer


def listed_market(strike: float | None) -> dict:
    return {
        "ticker": "KXBTC15M-26SEP10H0545",
        "floor_strike": strike,
        "open_ms": TARGET_MS,
        "close_ms": TARGET_MS + 900_000,
        "receipt_ns": TARGET_MS * 1_000_000 + 300_000_000,
        "status": "active",
    }


def scored_frame(strike: float) -> pd.DataFrame:
    """The live row shape, with the boundary strike under test."""
    offsets = [-o for o in (900_000_000, 60_000_000, 3_000_000, 1_000)] + [
        100_000, 1_100_000, 2_100_000, 4_100_000
    ]
    row = staged_row(offsets)
    index_prior, spot_prior = 99_990.0, 100_010.0
    row.update(
        {
            "spot_t0_price": 100_000.0,
            "spot_t5_price": 100_050.0,
            "floor_strike": float(strike),
            "anchor_valid": True,
            "t45_spot_complete": 1,
            "t45_spot_open": 100_000.0,
            "t45_close_5s": 100_050.0,
            "observed_second_rows": 5.0,
            "quote_vwap_usdt_per_usdc": 1.0001,
            "quote_valid": True,
            "quote_open_ms": float(TARGET_MS - 60_000),
            "quote_close_ms": float(TARGET_MS - 1),
            "index_prior_close": index_prior,
            "index_prior_open_ms": float(TARGET_MS - 60_000),
            "index_prior_close_ms": float(TARGET_MS - 1),
            "index_basic_count": 50.0,
            "spot_prior_close": spot_prior,
            "spot_prior_open_ms": float(TARGET_MS - 60_000),
            "spot_prior_close_ms": float(TARGET_MS - 1),
            "spot_prior_base_volume": 12.0,
            "spot_prior_trade_count": 300.0,
            "index_spot_ratio": index_prior / spot_prior,
            "index_source_valid": True,
            "cm_basis": 1.0,
            "cm_basis_change15": 0.1,
            "cm_flow1": 0.2,
            "cm_flow15": 0.3,
            "cm_flow_excess15": 0.05,
            "cm_log_volume15": 4.0,
            "cm_ret1": 0.01,
            "cm_ret15": 0.02,
        }
    )
    frame = base_anchor_fields(pd.DataFrame([row]))
    return pd.concat([frame, quote_fields(frame), index_fields(frame)], axis=1)


def head_for(cutoff: datetime) -> Head:
    return Head(
        wrap_historical_head(
            {
                "feature_order": list(DIRECTION_ORDER),
                "imputation": [0.0] * 60,
                "center": [0.0] * 60,
                "scale": [1.0] * 60,
                "coefficient": [0.0] * 60,
                "intercept": 0.25,
                "fit_cutoff": cutoff.isoformat(),
                "train_rows": 700,
                "train_start": (cutoff - timedelta(days=30)).isoformat(),
                "train_end": (cutoff - timedelta(minutes=15)).isoformat(),
                "max_train_settlement": (cutoff - timedelta(minutes=1)).isoformat(),
            }
        )
    )


class Packet:
    """The minimum of the packet surface `target_row` reads."""

    def __init__(self, features: dict, source: dict) -> None:
        self.features = {"anchor_valid": True}
        self.input_valid = True
        self.blockers = None
        self._features = features
        self.source = source

    def as_engine_features(self) -> dict:
        return dict(self._features)


# -- the estimate is an ordinary input ----------------------------------------
def test_a_cf_estimate_produces_a_real_sixty_feature_score():
    """No official strike by freeze: the CF boundary average carries the build."""
    record = choose_strike(
        listed_market(None),
        {"cf_brti": cf_buffer("99500.00")},
        TARGET_MS,
        FREEZE_NS,
        official_conflict=False,
    )
    assert record["strike"] == pytest.approx(99_500.00)
    assert record["strike_source"] == "cf_brti"
    assert record["estimated"] is True
    assert record["input_policy_version"] == INPUT_POLICY_VERSION

    built = build_direction_features(scored_frame(record["strike"]))
    assert list(built.columns) == list(DIRECTION_ORDER)
    assert built.notna().all(axis=None)

    features = {name: float(built[name].iloc[0]) for name in DIRECTION_ORDER}
    engine = LiteA(mode=BASE_MODE)
    out = engine.decide(
        target=TARGET,
        ticker=listed_market(None)["ticker"],
        features=features,
        input_valid=True,
        head=head_for(TARGET.replace(hour=0, minute=0, second=0, microsecond=0)),
        observed_at=TARGET + timedelta(seconds=5),
    )
    assert out["p_yes"] is not None
    assert 0.0 < float(out["p_yes"]) < 1.0
    assert out["execution_enabled"] is False


def test_an_official_strike_still_wins_over_a_present_estimate():
    record = choose_strike(
        listed_market(77_313.34),
        {"cf_brti": cf_buffer("99500.00")},
        TARGET_MS,
        FREEZE_NS,
        official_conflict=False,
    )
    assert record["strike"] == pytest.approx(77_313.34)
    assert record["strike_source"] == "official"
    assert record["estimated"] is False


# -- provenance is frozen with the decision -----------------------------------
def test_the_stored_row_keeps_the_chosen_source_and_policy():
    record = choose_strike(
        listed_market(None),
        {"cf_brti": cf_buffer("99500.00")},
        TARGET_MS,
        FREEZE_NS,
        official_conflict=False,
    )
    built = build_direction_features(scored_frame(record["strike"]))
    features = {name: float(built[name].iloc[0]) for name in DIRECTION_ORDER}
    engine = LiteA(mode=BASE_MODE)
    head = head_for(TARGET.replace(hour=0, minute=0, second=0, microsecond=0))
    out = engine.decide(
        target=TARGET,
        ticker="KXBTC15M-26SEP10H0545",
        features=features,
        input_valid=True,
        head=head,
        observed_at=TARGET + timedelta(seconds=5),
    )
    guard = DailyFloor(exception_rank=EXCEPTION_RANK).apply(out)
    packet = Packet(
        features,
        {"strike_policy": record, "market_diagnostics": {}, "feed_watermarks": {}},
    )
    row = target_row(
        target_open=TARGET,
        ticker="KXBTC15M-26SEP10H0545",
        packet=packet,
        engine_output=out,
        guard_output=guard,
        timing={"target_open_ns": TARGET_MS * 1_000_000},
        run_mode="LIVE",
    )
    assert row["model_version"] == MODEL_ID
    assert row["features"]["input_policy_version"] == INPUT_POLICY_VERSION
    assert row["features"]["strike_policy"]["strike_source"] == "cf_brti"
    assert row["features"]["strike_policy"]["estimated"] is True
    assert row["features"]["execution_enabled"] is False

    # A restart re-reads the row; the frozen provenance is unchanged.
    import json

    restored = json.loads(json.dumps(row["features"]["strike_policy"]))
    assert restored == row["features"]["strike_policy"]


def test_a_late_official_strike_is_audit_only():
    record = choose_strike(
        listed_market(None),
        {"cf_brti": cf_buffer("99500.00")},
        TARGET_MS,
        FREEZE_NS,
        official_conflict=False,
    )
    frozen = dict(record)
    audit = official_difference(record, 99_487.10)
    assert audit["audit_only"] is True
    assert audit["official_strike"] == pytest.approx(99_487.10)
    assert audit["difference"] == pytest.approx(12.90, abs=1e-6)
    # Nothing about the frozen decision moved.
    assert record == frozen


def test_no_audit_difference_for_an_official_strike():
    record = choose_strike(
        listed_market(77_313.34),
        {"cf_brti": cf_buffer("99500.00")},
        TARGET_MS,
        FREEZE_NS,
        official_conflict=False,
    )
    assert official_difference(record, 77_300.0) is None


# -- settlement is official only ----------------------------------------------
def test_an_estimated_strike_never_becomes_a_settlement_input():
    """The stored row exposes no settlement/label field for the estimate."""
    record = choose_strike(
        listed_market(None),
        {"cf_brti": cf_buffer("99500.00")},
        TARGET_MS,
        FREEZE_NS,
        official_conflict=False,
    )
    packet = Packet(
        {name: 0.0 for name in DIRECTION_ORDER},
        {"strike_policy": record, "market_diagnostics": {}, "feed_watermarks": {}},
    )
    engine = LiteA(mode=BASE_MODE)
    out = engine.decide(
        target=TARGET,
        ticker="KXBTC15M-26SEP10H0545",
        features={name: 0.0 for name in DIRECTION_ORDER},
        input_valid=True,
        head=head_for(TARGET.replace(hour=0, minute=0, second=0, microsecond=0)),
        observed_at=TARGET + timedelta(seconds=5),
    )
    row = target_row(
        target_open=TARGET,
        ticker="KXBTC15M-26SEP10H0545",
        packet=packet,
        engine_output=out,
        guard_output=DailyFloor(exception_rank=EXCEPTION_RANK).apply(out),
        timing={"target_open_ns": TARGET_MS * 1_000_000},
        run_mode="LIVE",
    )
    assert "label" not in row
    assert "settled_at_utc" not in row
    assert all("strike" not in key for key in row if key != "features")
