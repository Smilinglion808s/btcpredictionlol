"""Direction-60 and correctness-55 feature construction from raw feeds.

STATUS: PORTED. Every function below is a transcription of the recovered
research code, not a re-derivation from column names. Sources, in the order the
values flow:

    ancestor_source/vault_work/c63/work/rebase_sources/MULTIVENUE_R1/
        build_multivenue_features_r1.py
            standardized_event_aggregate, aggregate_event_windows, cross fields
    research_c57/build_c57_kalshi_anchor_rebase_r1.py
            binance_complete, spot_t5_price, anchor basis, UTC phase, meta_matrix
    research_c68/run_c68_quote_reference.py::quote_fields    BTCUSDC premium
    research_c69/run_c69_index_reference.py::index_fields    index anchor basis
    research_c71/audit_c71.py::build_features                COIN-M context
    research_c71/run_c71.py::cm_valid, run                   validity + frame
    source/research_c85/kalshi.py::metaframe, candidate      C85 MULTI_META

`auxiliary_features` is the unchanged `features()` function from
`source/research_c85/auxiliary.py`.

Nothing here substitutes a constant, a fixture value or an approximate
indicator. Any input that is absent or fails its source-validity rule leaves the
value non-finite, and the validity helpers fail closed on it.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np
import pandas as pd

from .c85 import auxiliary_source

ONE_SECOND_US = 1_000_000
FIFTEEN_MIN_US = 900 * ONE_SECOND_US

VENUES = ("binance_spot", "binance_um")
T5_WINDOWS = ("w001", "w002", "w003", "w005")
T0_WINDOWS = ("w060", "w900")
CROSS_FIELDS = (
    "binance_cross_t5_flow_agreement_5s",
    "binance_cross_t5_flow_gap_5s",
    "binance_cross_t5_return_agreement_5s",
    "binance_cross_t5_return_gap_5s",
)

# research_c71/audit_c71.py
EXTRA = [
    "cm_ret1",
    "cm_ret15",
    "cm_flow1",
    "cm_flow15",
    "cm_basis",
    "cm_basis_change15",
    "cm_flow_excess15",
    "cm_log_volume15",
]
SIGNED = EXTRA[:7]

_ORDER_PATH = Path(__file__).resolve().parent / "c85" / "feature_order.json"
_ORDER = json.loads(_ORDER_PATH.read_text())
DIRECTION_ORDER: list[str] = list(_ORDER["direction"])
META_ORDER: list[str] = list(_ORDER["meta"])
AUXILIARY_ORDER: list[str] = list(_ORDER["auxiliary"])

assert len(DIRECTION_ORDER) == 60
assert len(META_ORDER) == 55
assert len(AUXILIARY_ORDER) == 23


class FeatureUnavailable(RuntimeError):
    """Raised when a faithful feature vector cannot be built. Never substituted."""


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


# --------------------------------------------------------------------------- #
# Layer 1 — raw exchange events to boundary window features (MULTIVENUE_R1)
# --------------------------------------------------------------------------- #
def normalize_agg_trades(rows: Iterable[dict[str, Any]], venue: str) -> pd.DataFrame:
    """Binance aggTrade events to the canonical event frame.

    Mirrors `read_binance_archive`: spot transact_time is milliseconds, USD-M
    perpetual transact_time is milliseconds as well on the websocket ("T"), and
    both are carried in microseconds internally. `signed` is +1 when the buyer
    is the taker (is_buyer_maker false), matching the archive builder exactly.
    """
    if venue not in ("spot", "um"):
        raise ValueError(venue)
    records = list(rows)
    if not records:
        return pd.DataFrame(
            columns=["ts_us", "price", "quantity", "underlying_n", "signed", "quote"]
        )
    frame = pd.DataFrame.from_records(records)
    ts_us = frame["transact_time"].to_numpy(np.int64) * 1000
    maker = frame["is_buyer_maker"].astype(bool).to_numpy()
    result = pd.DataFrame(
        {
            "ts_us": ts_us,
            "price": frame["price"].to_numpy(float),
            "quantity": frame["quantity"].to_numpy(float),
            "underlying_n": (
                frame["last_trade_id"].to_numpy(np.int64)
                - frame["first_trade_id"].to_numpy(np.int64)
                + 1
            ),
            "signed": np.where(maker, -1.0, 1.0),
        }
    )
    result["quote"] = result["price"] * result["quantity"]
    return result.sort_values("ts_us", kind="stable").reset_index(drop=True)


def _standardized_event_aggregate(subset: pd.DataFrame, prefix: str) -> dict[str, float]:
    """One-target form of MULTIVENUE_R1.standardized_event_aggregate."""
    if subset.empty:
        return {}
    quote = subset["quote"].to_numpy(float)
    price = subset["price"].to_numpy(float)
    signed = subset["signed"].to_numpy(float)
    ts_us = subset["ts_us"].to_numpy(np.int64)

    signed_quote_v = signed * quote
    quote_volume = float(quote.sum())
    signed_quote = float(signed_quote_v.sum())
    denominator = np.nan if quote_volume == 0 else quote_volume
    first_price = float(price[0])
    last_price = float(price[-1])
    high_price = float(price.max())
    low_price = float(price.min())
    return_bps = 10_000.0 * (last_price / first_price - 1.0)
    range_bps = 10_000.0 * (high_price / low_price - 1.0)

    seconds = ts_us // ONE_SECOND_US
    per_second = pd.DataFrame({"second": seconds, "signed_quote": signed_quote_v})
    grouped = per_second.groupby("second", sort=True)
    max_events = float(grouped.size().max())
    max_abs_flow = float(grouped["signed_quote"].sum().abs().max())

    out = {
        "event_count": float(len(subset)),
        "underlying_trade_count": float(subset["underlying_n"].to_numpy(np.int64).sum()),
        "base_volume": float(subset["quantity"].to_numpy(float).sum()),
        "quote_volume": quote_volume,
        "signed_quote": signed_quote,
        "signed_event_count": float(signed.sum()),
        "buy_quote": float(quote[signed > 0].sum()),
        "sell_quote": float(quote[signed < 0].sum()),
        "flow_imbalance": signed_quote / denominator,
        "aggressive_buy_share": float(quote[signed > 0].sum()) / denominator,
        "trade_hhi": float((quote**2).sum()) / (denominator**2),
        "max_trade_share": float(quote.max()) / denominator,
        "return_bps": return_bps,
        "range_bps": range_bps,
        "price_flow_alignment": float(np.sign(return_bps) * np.sign(signed_quote)),
        "first_event_us": float(ts_us.min()),
        "last_event_us": float(ts_us.max()),
        "max_events_one_second": max_events,
        "max_abs_flow_one_second": max_abs_flow,
    }
    return {f"{prefix}_{k}": v for k, v in out.items()}


def binance_window_features(
    events: pd.DataFrame, target_open_ms: int, venue_prefix: str
) -> dict[str, float]:
    """The t0 (pre-boundary) and t5 (post-boundary) windows for one target.

    t0 windows end strictly before T: events in the 15-minute bucket that closes
    at T, restricted to the last `seconds` of that bucket.
    t5 windows start at T: events in the bucket opening at T, offset < seconds.
    This is `aggregate_event_windows` restricted to one target boundary.
    """
    features: dict[str, float] = {}
    if events.empty:
        return features
    ts_us = events["ts_us"].to_numpy(np.int64)
    target_us = int(target_open_ms) * 1000

    prior_bucket = target_us - FIFTEEN_MIN_US
    prior_offset = ts_us - prior_bucket
    in_prior = (prior_offset >= 0) & (prior_offset < FIFTEEN_MIN_US)
    for seconds in (5, 15, 30, 60, 180, 900):
        mask = in_prior & (prior_offset >= FIFTEEN_MIN_US - seconds * ONE_SECOND_US)
        features.update(
            _standardized_event_aggregate(
                events.loc[mask], f"{venue_prefix}_t0_w{seconds:03d}"
            )
        )

    offset = ts_us - target_us
    for seconds in (1, 2, 3, 5):
        mask = (offset >= 0) & (offset < seconds * ONE_SECOND_US)
        features.update(
            _standardized_event_aggregate(
                events.loc[mask], f"{venue_prefix}_t5_w{seconds:03d}"
            )
        )
    return features


def binance_cross_fields(row: dict[str, float]) -> dict[str, float]:
    """Cross-venue agreement/gap fields, exactly as in `build_binance`."""
    out: dict[str, float] = {}
    for horizon in ("t0", "t5"):
        spot_flow = row.get(f"binance_spot_{horizon}_w005_flow_imbalance", np.nan)
        um_flow = row.get(f"binance_um_{horizon}_w005_flow_imbalance", np.nan)
        spot_ret = row.get(f"binance_spot_{horizon}_w005_return_bps", np.nan)
        um_ret = row.get(f"binance_um_{horizon}_w005_return_bps", np.nan)
        out[f"binance_cross_{horizon}_flow_agreement_5s"] = float(
            np.sign(spot_flow) * np.sign(um_flow)
        )
        out[f"binance_cross_{horizon}_flow_gap_5s"] = float(spot_flow - um_flow)
        out[f"binance_cross_{horizon}_return_agreement_5s"] = float(
            np.sign(spot_ret) * np.sign(um_ret)
        )
        out[f"binance_cross_{horizon}_return_gap_5s"] = float(spot_ret - um_ret)
    return out


# --------------------------------------------------------------------------- #
# Layer 2 — packet-level derived fields
# --------------------------------------------------------------------------- #
def base_anchor_fields(frame: pd.DataFrame) -> pd.DataFrame:
    """Port of research_c57 load_frame's derived direction block.

    Requires: the raw window fields, `spot_t0_price`, `floor_strike`, `ts` and
    the upstream `anchor_valid`.
    """
    f = frame.copy()
    event_count_fields: list[str] = []
    required_fields: list[str] = []
    for venue in VENUES:
        for window in T5_WINDOWS:
            event_count_fields.append(f"{venue}_t5_{window}_event_count")
            for field in ("return_bps", "flow_imbalance"):
                column = f"{venue}_t5_{window}_{field}"
                f[column] = pd.to_numeric(f[column], errors="coerce")
                required_fields.append(column)
            volume = f"{venue}_t5_{window}_quote_volume"
            f[volume] = pd.to_numeric(f[volume], errors="coerce")
            f[f"log1p_{volume}"] = np.log1p(f[volume].clip(lower=0))
            required_fields.extend([volume, f"log1p_{volume}"])
        for field in ("range_bps", "price_flow_alignment"):
            column = f"{venue}_t5_w005_{field}"
            f[column] = pd.to_numeric(f[column], errors="coerce")
            required_fields.append(column)
        for window in T0_WINDOWS:
            for field in ("return_bps", "flow_imbalance"):
                column = f"{venue}_t0_{window}_{field}"
                f[column] = pd.to_numeric(f[column], errors="coerce")
    for column in CROSS_FIELDS:
        f[column] = pd.to_numeric(f[column], errors="coerce")
        required_fields.append(column)
    for column in event_count_fields:
        f[column] = pd.to_numeric(f[column], errors="coerce")

    f["binance_complete"] = (
        f[event_count_fields].gt(0).all(axis=1)
        & np.isfinite(f[required_fields].to_numpy(float)).all(axis=1)
    )

    f["spot_t5_price"] = f["spot_t0_price"] * (
        1.0 + f["binance_spot_t5_w005_return_bps"] / 10_000.0
    )
    raw_t0 = 10_000.0 * (f["spot_t0_price"] / f["floor_strike"] - 1.0)
    raw_t5 = 10_000.0 * (f["spot_t5_price"] / f["floor_strike"] - 1.0)
    f["anchor_valid"] = (
        f["anchor_valid"].astype(bool)
        & np.isfinite(f["spot_t0_price"])
        & f["spot_t0_price"].gt(0)
        & f["binance_spot_t5_w005_event_count"].gt(0)
        & np.isfinite(raw_t0)
        & np.isfinite(raw_t5)
    )
    f["anchor_t0_basis_raw_bps"] = raw_t0
    f["anchor_t5_basis_raw_bps"] = raw_t5
    f["anchor_t0_basis_bps"] = raw_t0.clip(-100, 100)
    f["anchor_t5_basis_bps"] = raw_t5.clip(-100, 100)
    f["anchor_side"] = np.where(f["anchor_valid"], np.sign(raw_t5), 0).astype(np.int8)

    phase = 2.0 * np.pi * (f["ts"].dt.hour * 3_600 + f["ts"].dt.minute * 60) / 86_400.0
    dow_phase = 2.0 * np.pi * f["ts"].dt.dayofweek / 7.0
    f["utc_time_sin"] = np.sin(phase)
    f["utc_time_cos"] = np.cos(phase)
    f["utc_dow_sin"] = np.sin(dow_phase)
    f["utc_dow_cos"] = np.cos(dow_phase)
    return f


def quote_fields(f: pd.DataFrame) -> pd.DataFrame:
    """Unchanged research_c68.run_c68_quote_reference.quote_fields."""
    q = f.quote_vwap_usdt_per_usdc
    u0 = f.spot_t0_price / q
    u5 = f.spot_t5_price / q
    raw0 = 10000 * (u0 / f.floor_strike - 1)
    raw5 = 10000 * (u5 / f.floor_strike - 1)
    target_ms = f.ts.astype("int64") // 1000000
    source_valid = (
        f.quote_valid.fillna(False).astype(bool)
        & q.between(0.9, 1.1)
        & f.quote_open_ms.eq(target_ms - 60000)
        & f.quote_close_ms.eq(target_ms - 1)
    )
    valid = (
        source_valid
        & f.t45_spot_complete.eq(1)
        & f.floor_strike.gt(0)
        & u0.gt(0)
        & u5.gt(0)
        & np.isfinite(raw0)
        & np.isfinite(raw5)
        & raw0.abs().le(200)
    )
    return pd.DataFrame(
        {
            "usdc_price_t0": u0,
            "usdc_price_t5": u5,
            "usdc_anchor_t0_basis_raw_bps": raw0,
            "usdc_anchor_t5_basis_raw_bps": raw5,
            "usdc_anchor_t0_basis_bps": raw0.clip(-100, 100),
            "usdc_anchor_t5_basis_bps": raw5.clip(-100, 100),
            "quote_premium_bps": (10000 * (q - 1)).clip(-100, 100),
            "quote_source_valid": source_valid,
            "converted_anchor_valid": valid,
        }
    )


def index_fields(f: pd.DataFrame) -> pd.DataFrame:
    """Unchanged research_c69.run_c69_index_reference.index_fields."""
    b = f.index_spot_ratio
    ms = f.ts.astype("int64") // 1000000
    source = (
        f.index_source_valid.fillna(False).astype(bool)
        & b.between(0.98, 1.02)
        & f.index_prior_open_ms.eq(ms - 60000)
        & f.spot_prior_open_ms.eq(ms - 60000)
        & f.index_prior_close_ms.eq(ms - 1)
        & f.spot_prior_close_ms.eq(ms - 1)
        & f.index_basic_count.gt(0)
        & f.spot_prior_base_volume.gt(0)
        & f.spot_prior_trade_count.gt(0)
        & f.index_prior_close.gt(0)
        & f.spot_prior_close.gt(0)
        & np.isclose(b, f.index_prior_close / f.spot_prior_close, atol=1e-12, rtol=1e-12)
    )
    j0 = f.spot_t0_price * b
    j5 = f.spot_t5_price * b
    r0 = 10000 * (j0 / f.floor_strike - 1)
    r5 = 10000 * (j5 / f.floor_strike - 1)
    valid = (
        source
        & f.t45_spot_complete.eq(1)
        & f.floor_strike.gt(0)
        & j0.gt(0)
        & j5.gt(0)
        & np.isfinite(r0)
        & np.isfinite(r5)
        & r0.abs().le(200)
    )
    return pd.DataFrame(
        {
            "index_transport_t0": j0,
            "index_transport_t5": j5,
            "index_anchor_t0_basis_raw_bps": r0,
            "index_anchor_t5_basis_raw_bps": r5,
            "index_anchor_t0_basis_bps": r0.clip(-100, 100),
            "index_anchor_t5_basis_bps": r5.clip(-100, 100),
            "index_spot_basis_bps": (10000 * (b - 1)).clip(-100, 100),
            "index_source_checked_valid": source,
            "index_anchor_valid": valid,
        }
    )


def cm_context_features(
    cm: pd.DataFrame, idx: pd.DataFrame, spot: pd.DataFrame
) -> pd.DataFrame:
    """Unchanged research_c71.audit_c71.build_features.

    The row indexed by T contains at most minute T-1, never minute T.
    """
    start = int(cm.open_ms.min())
    end = int(cm.open_ms.max()) + 60000
    grid = pd.Index(np.arange(start, end, 60000), name="open_ms")

    def align(d: pd.DataFrame) -> pd.DataFrame:
        assert not d.open_ms.duplicated().any()
        return d.set_index("open_ms").reindex(grid)

    c, i, s = align(cm), align(idx), align(spot)
    valid = (
        c.close_ms.eq(grid + 59999)
        & i.close_ms.eq(grid + 59999)
        & s.close_ms.eq(grid + 59999)
        & c.close.gt(0)
        & c.open.gt(0)
        & i.close.gt(0)
        & s.close.gt(0)
        & i.basic_count.gt(0)
        & c.contract_volume.ge(0)
        & c.buy_contract_volume.ge(0)
        & c.buy_contract_volume.le(c.contract_volume)
        & s.base_volume.ge(0)
        & s.taker_buy_base.ge(0)
        & s.taker_buy_base.le(s.base_volume)
    )
    cv = c.contract_volume.rolling(15, min_periods=15).sum()
    cb = c.buy_contract_volume.rolling(15, min_periods=15).sum()
    sv = s.base_volume.rolling(15, min_periods=15).sum()
    sb = s.taker_buy_base.rolling(15, min_periods=15).sum()
    basis = 10000 * np.log(c.close / i.close)
    f = pd.DataFrame(index=grid)
    f["cm_ret1"] = 10000 * np.log(c.close / c.open)
    f["cm_ret15"] = 10000 * np.log(c.close / c.open.shift(14))
    f["cm_flow1"] = 2 * c.buy_contract_volume / c.contract_volume.replace(0, np.nan) - 1
    f["cm_flow15"] = 2 * cb / cv.replace(0, np.nan) - 1
    f["cm_basis"] = basis
    f["cm_basis_change15"] = basis - basis.shift(15)
    f["cm_flow_excess15"] = f.cm_flow15 - (2 * sb / sv.replace(0, np.nan) - 1)
    f["cm_log_volume15"] = np.log1p(cv)
    for col in ["cm_ret1", "cm_ret15", "cm_basis", "cm_basis_change15"]:
        f[col] = f[col].clip(-100, 100)
    f["cm_source_valid"] = (
        valid.rolling(16, min_periods=16).sum().eq(16)
        & c.contract_volume.gt(0)
        & cv.gt(0)
        & sv.gt(0)
        & np.isfinite(f[EXTRA]).all(axis=1)
    )
    f["cm_first_source_open_ms"] = grid - 15 * 60000
    f["cm_last_source_close_ms"] = grid + 59999
    f["ts"] = pd.to_datetime(grid + 60000, unit="ms", utc=True)
    return f.reset_index(drop=True)


# --------------------------------------------------------------------------- #
# Layer 3 — validity
# --------------------------------------------------------------------------- #
def cm_valid(f: pd.DataFrame) -> np.ndarray:
    """Unchanged research_c71.run_c71.cm_valid."""
    ms = f.ts.astype("int64") // 1000000
    return (
        f.cm_source_valid.fillna(False).astype(bool)
        & f.cm_first_source_open_ms.eq(ms - 16 * 60000)
        & f.cm_last_source_close_ms.eq(ms - 1)
        & np.isfinite(f[EXTRA]).all(axis=1)
    ).to_numpy(bool)


def frame_anchor_valid(f: pd.DataFrame) -> pd.Series:
    """c68 then c69 tightening of `anchor_valid`, in that order."""
    return (
        f.anchor_valid.astype(bool)
        & f.converted_anchor_valid.astype(bool)
        & f.index_anchor_valid.astype(bool)
    )


def auxiliary_source_ok(
    aux: pd.DataFrame, ts: pd.Series, logits: pd.DataFrame
) -> np.ndarray:
    """Unchanged `source_ok` from research_c85.kalshi.candidate."""
    ms = ts.astype("int64") // 1000000
    return (
        aux.valid.fillna(False).to_numpy(bool)
        & np.isfinite(logits).all(axis=1).to_numpy(bool)
        & aux.source_last_close_ms.eq(ms - 1).to_numpy(bool)
    )


def core_valid(f: pd.DataFrame, source_ok: np.ndarray) -> np.ndarray:
    """C85 core validity: binance AND anchors AND exact cm AND auxiliary."""
    return (
        f.binance_complete.to_numpy(bool)
        & frame_anchor_valid(f).to_numpy(bool)
        & cm_valid(f)
        & np.asarray(source_ok, dtype=bool)
    )


# --------------------------------------------------------------------------- #
# Layer 4 — model-ready matrices
# --------------------------------------------------------------------------- #
def build_direction_features(frame: pd.DataFrame) -> pd.DataFrame:
    """The frozen 60-input direction matrix, in `feature_order.json` order."""
    missing = [c for c in DIRECTION_ORDER if c not in frame.columns]
    if missing:
        raise FeatureUnavailable(
            "C85_DIRECTION_INPUT_MISSING: " + ", ".join(sorted(missing))
        )
    return frame.loc[:, DIRECTION_ORDER].astype(float)


def auxiliary_logits(aux: pd.DataFrame, windows: Sequence[str] = ("LONG", "RECENT")) -> pd.DataFrame:
    """Unchanged auxiliary logit/logscale block from kalshi.candidate."""
    out = pd.DataFrame(index=aux.index)
    for w in windows:
        prob = aux[w + "_p"].clip(1e-6, 1 - 1e-6)
        out[w + "_logit"] = np.log(prob / (1 - prob))
        out[w + "_logscale"] = aux[w + "_logscale"]
    return out


def meta_matrix(
    frame: pd.DataFrame, direct_probability: np.ndarray, proposal: np.ndarray
) -> pd.DataFrame:
    """Unchanged research_c57.meta_matrix with include_anchor=True."""
    proposal = np.asarray(proposal, dtype=np.int8)
    direct_direction = direction_from_probability(direct_probability)
    output = pd.DataFrame(index=frame.index)
    output["direct_confidence"] = np.nan_to_num(
        np.abs(direct_probability - 0.5), nan=0.0
    )
    output["proposal_direct_agreement"] = proposal * direct_direction
    output["aligned_anchor_t0_basis_bps"] = proposal * frame["anchor_t0_basis_bps"].to_numpy(float)
    output["aligned_anchor_t5_basis_bps"] = proposal * frame["anchor_t5_basis_bps"].to_numpy(float)
    output["abs_anchor_t0_basis_bps"] = frame["anchor_t0_basis_bps"].abs().to_numpy(float)
    output["abs_anchor_t5_basis_bps"] = frame["anchor_t5_basis_bps"].abs().to_numpy(float)

    for venue in VENUES:
        for field in ("return_bps", "flow_imbalance"):
            source = f"{venue}_t5_w005_{field}"
            output[f"aligned_{source}"] = proposal * frame[source].to_numpy(float)
    output["binance_cross_t5_return_agreement_5s"] = frame[
        "binance_cross_t5_return_agreement_5s"
    ].to_numpy(float)
    output["binance_cross_t5_flow_agreement_5s"] = frame[
        "binance_cross_t5_flow_agreement_5s"
    ].to_numpy(float)

    for model in ("c54", "c42", "c51"):
        output[f"{model}_called"] = frame[f"{model}_prediction"].ne(0).to_numpy(float)
    for column in (
        "c42_prediction",
        "c51_prediction",
        "c30_prediction",
        "c36_prediction",
        "c37_prediction",
        "r4_prediction",
        "external_direction",
    ):
        output[f"proposal_agreement_{column}"] = proposal * frame[column].to_numpy(np.int8)

    ranked = {
        "c51_reliability_rank": frame["c51_reliability_rank"],
        "r4_probability_correct": frame["r4_probability_correct"],
        "r4_directional_rank": frame["r4_directional_rank"],
        "external_rank": frame["external_rank"],
        "mean_135_rank": frame["mean_135_rank"],
    }
    for name, values in ranked.items():
        output[f"{name}_centered"] = values.fillna(0.5).to_numpy(float) - 0.5
        output[f"{name}_available"] = values.notna().to_numpy(float)
    return output.replace([np.inf, -np.inf], np.nan).fillna(0.0)


def metaframe(
    f: pd.DataFrame, py: np.ndarray, proposal: np.ndarray
) -> pd.DataFrame:
    """Unchanged research_c85.kalshi.metaframe (51 columns before auxiliary)."""
    m = meta_matrix(f, py, proposal)
    for t in ["t0", "t5"]:
        m["aligned_usdc_" + t] = proposal * f[f"usdc_anchor_{t}_basis_bps"]
        m["abs_usdc_" + t] = f[f"usdc_anchor_{t}_basis_bps"].abs()
    m["quote_premium_bps"] = f.quote_premium_bps
    for t in ["t0", "t5"]:
        m["aligned_index_" + t] = proposal * f[f"index_anchor_{t}_basis_bps"]
        m["abs_index_" + t] = f[f"index_anchor_{t}_basis_bps"].abs()
    m["index_spot_basis_bps"] = f.index_spot_basis_bps
    for col in SIGNED:
        m["aligned_" + col] = proposal * f[col]
    m["abs_cm_basis"] = f.cm_basis.abs()
    m["cm_log_volume15"] = f.cm_log_volume15
    if len(m.columns) != 51:
        raise FeatureUnavailable(f"C85_META_SHAPE: {len(m.columns)} != 51")
    return m


def build_meta_features(
    frame: pd.DataFrame,
    probability_yes: np.ndarray,
    proposal: np.ndarray,
    aux_logits: pd.DataFrame,
) -> pd.DataFrame:
    """The frozen 55-input correctness matrix (MULTI_META: LONG + RECENT)."""
    m = metaframe(frame, probability_yes, proposal)
    for col in aux_logits.columns:
        m[col] = aux_logits[col] * (proposal if col.endswith("logit") else 1)
    missing = [c for c in META_ORDER if c not in m.columns]
    if missing:
        raise FeatureUnavailable("C85_META_INPUT_MISSING: " + ", ".join(sorted(missing)))
    return m.loc[:, META_ORDER].astype(float)


def direction_from_probability(probability: np.ndarray) -> np.ndarray:
    """Unchanged research_c57.direction_from_probability."""
    p = np.asarray(probability, dtype=float)
    return np.where(np.isfinite(p), np.where(p >= 0.5, 1, -1), 0).astype(np.int8)


def auxiliary_features(minutes: pd.DataFrame) -> pd.DataFrame:
    """Unchanged auxiliary 23-feature construction (Binance spot 1m, ends T-1ms)."""
    return auxiliary_source.features(minutes)
