"""Consolidated COVERAGE -> C30 computation path (c85-reconstruction-r1).

Why this module exists
----------------------
`external_research/t0_t5_coverage_bridge_audit_r1.py` is a *research* script: its
`main()` mixes the model path (frame -> T+5 heads -> router -> T0 graded policy
-> continuous coverage ledger) with retrospective reporting (archived parity,
label-sensitivity, monthly tables, performance grids). Only the model path is a
serving dependency.

Dependency determination (done once, from source, not guessed)
--------------------------------------------------------------
`waterfall_ledger.csv` (WATERFALL) and `net_monthly_final_selected_ledger.csv`
(CONTROL) are read in exactly three places, all inside reporting code:

  * `main()`     -> `recovered_packet` mask, used only to slice the
                    `coverage_bridge_performance.csv` metric grid;
  * `parity_audit(frame)`            -> archived-vs-new comparison payload;
  * `stored_policy_label_sensitivity()` -> archived-policy report.

They are NOT read by `build_continuous_frame()`, `fit_t5()`,
`add_t0_and_policies()` or by the `continuous_coverage_ledger.csv` export.
They therefore do not feed feature generation, fit labels, fitted parameters,
policy selection or runtime state. The archived comparison is recorded here as
NOT_RUN_MISSING_REFERENCE; the original research script is left untouched.

The *module* `net_monthly_waterfall_r1` IS required - `fit_t5` calls its
`t5_router()` - and it is imported verbatim.

What this module provides
-------------------------
1. `run_batch()`  - the real recovered functions, executed over a caller-chosen
   end boundary, producing genuine continuous-coverage/C30 rows.
2. `CoverageC30Server` - a prediction-time callable with a fixed schema: it
   holds the serialised current fits, the router/hot histories and the raw tail
   buffer, scores one target at a time and settles labels afterwards. Its
   arithmetic is the extracted original arithmetic (same constants, same
   estimator construction, same block cadence, same causal ordering), and it is
   verified by replaying the tail of a batch run and requiring bit-equality.

No model rule, feature, minimum, schedule or label semantic is changed here.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ROOT = Path(os.environ.get("C85_COVERAGE_ROOT", "/tmp/c85stage/covroot"))
sys.path.insert(0, str(ROOT))

import t5_precision_lab as t5_lab  # noqa: E402
from external_research import net_monthly_final_stress as stress  # noqa: E402
from external_research import net_monthly_waterfall_r1 as waterfall  # noqa: E402
from external_research import t0_t5_coverage_bridge_audit_r1 as bridge  # noqa: E402

IDENTITY = "C85_RECONSTRUCTION_R1_COVERAGE_C30"
ARCHIVED_COMPARISON = "NOT_RUN_MISSING_REFERENCE"

LEDGER_COLUMNS = [
    "ts",
    "label",
    "label_source",
    "source_segment",
    "label_before_t10_finalization",
    "t10_final_label",
    "t10_abs_return_bps",
    "t5_input_complete",
    "p_pf_linear",
    "p_pf_context_logit",
    "base_probability_green",
    "base_direction",
    "t5_context_router_prediction",
    "external_probability_green",
    "external_direction",
    "external_rank",
    "graded_warm",
    "graded_hot",
    "continuous_graded_prediction",
    "continuous_graded_stage",
]

# raw (pre-derivation) columns the tail buffer has to carry
RAW_COLUMNS = [
    "ts",
    "label",
    "label_source",
    "r2_preopen_prediction",
    "t5_ret_bps",
    "t5_range_bps",
    "t5_quote_flow",
    "t5_log_quote_volume",
    "t5_log_trade_count",
    "source_segment",
]

# lookback the tail buffer must retain for derive_features + a due refit to be
# identical to the full-frame computation:
#   RANK_LOOKBACK (768) for the rolling ranks, 384 for the rolling means,
#   PRIMARY_WINDOW (8640) for the training window.
TAIL_ROWS = t5_lab.PRIMARY_WINDOW + t5_lab.RANK_LOOKBACK + 384 + 96


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_array(values: np.ndarray) -> str:
    return sha256_bytes(np.ascontiguousarray(values).tobytes())


# ---------------------------------------------------------------------------
# 1. batch path: the recovered functions, nothing else
# ---------------------------------------------------------------------------
def run_batch(end: pd.Timestamp) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Execute build_continuous_frame -> fit_t5 -> add_t0_and_policies.

    `end` is the exclusive schedule end. It is applied to the recovered module's
    own END constant so the recovered code - not a copy of it - does the work.
    """

    original_end = bridge.END
    bridge.END = pd.Timestamp(end)
    fits: list[dict[str, Any]] = []
    try:
        with _record_fits(fits):
            frame = bridge.build_continuous_frame()
            fit = bridge.fit_t5(frame)
            frame, policies = bridge.add_t0_and_policies(frame)
    finally:
        bridge.END = original_end

    audit = {
        "identity": IDENTITY,
        "archived_comparison": ARCHIVED_COMPARISON,
        "archived_comparison_reason": (
            "waterfall_ledger.csv / net_monthly_final_selected_ledger.csv are "
            "report-only inputs and are absent from the recovered archives; "
            "parity_audit and stored_policy_label_sensitivity are not run."
        ),
        "schedule_end": pd.Timestamp(end).isoformat(),
        "rows": int(len(frame)),
        "first_ts": frame.ts.iloc[0].isoformat(),
        "last_ts": frame.ts.iloc[-1].isoformat(),
        "linear_fit_count": fit["linear"].fit_count,
        "context_fit_count": fit["context"].fit_count,
        "linear_first_fit_ts": fit["linear"].first_fit_ts,
        "context_first_fit_ts": fit["context"].first_fit_ts,
        "policies": sorted(policies),
        "graded_prediction_sha256": bridge.array_hash(
            frame.continuous_graded_prediction.to_numpy(np.int8)
        ),
    }
    return frame, audit


class _Recorder:
    """Captures every (scaler, model) the recovered fitter builds, in order."""

    def __init__(self) -> None:
        self.pairs: list[dict[str, Any]] = []


class _RecordingScaler(t5_lab.RobustScaler):  # type: ignore[misc]
    sink: list[Any] = []

    def fit_transform(self, X, y=None, **kwargs):  # noqa: N803
        out = super().fit_transform(X, y, **kwargs)
        type(self).sink.append(self)
        return out


class _RecordingLogistic(t5_lab.LogisticRegression):  # type: ignore[misc]
    sink: list[Any] = []

    def fit(self, X, y, **kwargs):  # noqa: N803
        out = super().fit(X, y, **kwargs)
        type(self).sink.append(self)
        return out


class _record_fits:
    """Context manager: substitute recording subclasses inside the lab module.

    Subclasses only append `self` after delegating to the genuine sklearn
    implementation, so the numerical path is unchanged.
    """

    def __init__(self, sink: list[dict[str, Any]]) -> None:
        self.sink = sink

    def __enter__(self) -> "_record_fits":
        self._scaler = t5_lab.RobustScaler
        self._model = t5_lab.LogisticRegression
        _RecordingScaler.sink = []
        _RecordingLogistic.sink = []
        t5_lab.RobustScaler = _RecordingScaler
        t5_lab.LogisticRegression = _RecordingLogistic
        return self

    def __exit__(self, *exc: Any) -> None:
        t5_lab.RobustScaler = self._scaler
        t5_lab.LogisticRegression = self._model
        self.sink.append(
            {
                "scalers": list(_RecordingScaler.sink),
                "models": list(_RecordingLogistic.sink),
            }
        )


# ---------------------------------------------------------------------------
# 2. prediction-time path
# ---------------------------------------------------------------------------
HEADS = {
    "linear": t5_lab.PRICE_FLOW,
    "context": t5_lab.NONLINEAR_CONTEXT,
}


@dataclass
class HeadState:
    features: list[str]
    scaler: Any = None
    model: Any = None
    fitted_at_index: int | None = None
    fit_count: int = 0


@dataclass
class ServerState:
    """Everything the serving path needs; fully serialisable."""

    tail: pd.DataFrame
    index_of_tail_start: int
    cursor_index: int  # index of the last target actually processed
    cursor_ts: str | None
    heads: dict[str, HeadState]
    router_history: list[int] = field(default_factory=list)
    warm_history: list[int] = field(default_factory=list)
    hot_history: list[int] = field(default_factory=list)


class CoverageC30Server:
    """One-target-at-a-time coverage/C30 producer.

    Schema in  : raw T+5 row {ts, t5_ret_bps, t5_range_bps, t5_quote_flow,
                 t5_log_quote_volume, t5_log_trade_count, source_segment}
                 plus the external (T0 long-context) row
                 {external_probability_green, external_direction, external_rank}.
    Schema out : the LEDGER_COLUMNS subset produced for that target.
    """

    ROUTER_WINDOW = 8
    ROUTER_REQUIRED_WINS = 4
    HOT_WINDOW = 16
    WARM_RATE = 0.50
    HOT_RATE = 0.60

    def __init__(self, state: ServerState) -> None:
        self.state = state

    # -- construction from a batch run -------------------------------------
    @classmethod
    def from_batch(cls, frame: pd.DataFrame, upto_index: int) -> "CoverageC30Server":
        """Build serving state as it stood after processing row `upto_index`."""

        head_state: dict[str, HeadState] = {}
        for name, features in HEADS.items():
            head_state[name] = HeadState(features=list(features))
        state = ServerState(
            tail=frame.loc[: upto_index, RAW_COLUMNS].tail(TAIL_ROWS).reset_index(drop=True),
            index_of_tail_start=max(0, upto_index + 1 - TAIL_ROWS),
            cursor_index=upto_index,
            cursor_ts=frame.ts.iloc[upto_index].isoformat(),
            heads=head_state,
            router_history=_router_history(frame, upto_index),
            warm_history=_hot_history(frame, upto_index),
            hot_history=_hot_history(frame, upto_index),
        )
        server = cls(state)
        server._refit_for_block(_block_start(upto_index))
        return server

    # -- persistence --------------------------------------------------------
    def save(self, directory: Path) -> dict[str, Any]:
        import joblib

        directory.mkdir(parents=True, exist_ok=True)
        self.state.tail.to_parquet(directory / "tail.parquet", index=False)
        joblib.dump(
            {
                name: {
                    "features": head.features,
                    "scaler": head.scaler,
                    "model": head.model,
                    "fitted_at_index": head.fitted_at_index,
                    "fit_count": head.fit_count,
                }
                for name, head in self.state.heads.items()
            },
            directory / "heads.joblib",
        )
        meta = {
            "identity": IDENTITY,
            "archived_comparison": ARCHIVED_COMPARISON,
            "cursor_index": self.state.cursor_index,
            "cursor_ts": self.state.cursor_ts,
            "index_of_tail_start": self.state.index_of_tail_start,
            "tail_rows": int(len(self.state.tail)),
            "router_history": self.state.router_history,
            "warm_history": self.state.warm_history,
            "hot_history": self.state.hot_history,
            "constants": {
                "c_value": 0.003,
                "window": t5_lab.PRIMARY_WINDOW,
                "minimum": t5_lab.MINIMUM_TRAINING_ROWS,
                "refit_every": t5_lab.REFIT_EVERY,
                "rank_lookback": t5_lab.RANK_LOOKBACK,
                "rank_minimum": t5_lab.RANK_MINIMUM,
                "router_window": self.ROUTER_WINDOW,
                "router_required_wins": self.ROUTER_REQUIRED_WINS,
                "hot_window": self.HOT_WINDOW,
                "warm_rate": self.WARM_RATE,
                "hot_rate": self.HOT_RATE,
            },
            "tail_sha256": sha256_bytes((directory / "tail.parquet").read_bytes()),
            "heads_sha256": sha256_bytes((directory / "heads.joblib").read_bytes()),
        }
        (directory / "STATE.json").write_text(json.dumps(meta, indent=2))
        return meta

    @classmethod
    def load(cls, directory: Path) -> "CoverageC30Server":
        import joblib

        meta = json.loads((directory / "STATE.json").read_text())
        tail_bytes = (directory / "tail.parquet").read_bytes()
        head_bytes = (directory / "heads.joblib").read_bytes()
        if sha256_bytes(tail_bytes) != meta["tail_sha256"]:
            raise RuntimeError("coverage/C30 state: tail digest mismatch")
        if sha256_bytes(head_bytes) != meta["heads_sha256"]:
            raise RuntimeError("coverage/C30 state: head digest mismatch")
        heads = {
            name: HeadState(
                features=payload["features"],
                scaler=payload["scaler"],
                model=payload["model"],
                fitted_at_index=payload["fitted_at_index"],
                fit_count=payload["fit_count"],
            )
            for name, payload in joblib.load(directory / "heads.joblib").items()
        }
        state = ServerState(
            tail=pd.read_parquet(directory / "tail.parquet"),
            index_of_tail_start=meta["index_of_tail_start"],
            cursor_index=meta["cursor_index"],
            cursor_ts=meta["cursor_ts"],
            heads=heads,
            router_history=list(meta["router_history"]),
            warm_history=list(meta["warm_history"]),
            hot_history=list(meta["hot_history"]),
        )
        return cls(state)

    # -- the actual step ----------------------------------------------------
    def score(self, raw_row: dict[str, Any], external: dict[str, Any]) -> dict[str, Any]:
        state = self.state
        index = state.cursor_index + 1
        row = {column: raw_row.get(column, np.nan) for column in RAW_COLUMNS}
        row["ts"] = pd.Timestamp(raw_row["ts"])
        row["label"] = np.nan  # a target's own label is never available at T+5
        state.tail = pd.concat(
            [state.tail, pd.DataFrame([row])], ignore_index=True
        )
        if len(state.tail) > TAIL_ROWS:
            drop = len(state.tail) - TAIL_ROWS
            state.tail = state.tail.iloc[drop:].reset_index(drop=True)
            state.index_of_tail_start += drop

        if _is_refit_boundary(index):
            self._refit_for_block(index)

        derived = t5_lab.derive_features(state.tail)
        position = len(derived) - 1
        probability: dict[str, float] = {}
        for name, head in state.heads.items():
            values = derived[head.features].to_numpy(float)[position]
            if head.model is None or not np.isfinite(values).all():
                probability[name] = np.nan
            else:
                probability[name] = float(
                    head.model.predict_proba(
                        head.scaler.transform(values.reshape(1, -1))
                    )[0, 1]
                )

        components = sum(1 for value in probability.values() if np.isfinite(value))
        ensemble = (
            float(
                np.nansum([probability["linear"], probability["context"]]) / components
            )
            if components
            else np.nan
        )
        base = int(np.where(np.isfinite(ensemble), 1 if ensemble >= 0.5 else -1, 0))
        if not np.isfinite(ensemble):
            base = 0

        context_direction = 0
        if np.isfinite(probability["context"]):
            context_direction = 1 if probability["context"] >= 0.5 else -1

        router = base
        if (
            context_direction != 0
            and context_direction != base
            and len(state.router_history) >= self.ROUTER_WINDOW
            and sum(state.router_history[-self.ROUTER_WINDOW:]) >= self.ROUTER_REQUIRED_WINS
        ):
            router = context_direction

        external_direction = int(external.get("external_direction") or 0)
        rank = external.get("external_rank", np.nan)
        rank = float(rank) if rank is not None and np.isfinite(float(rank)) else np.nan
        available = np.isfinite(rank) and external_direction != 0

        warm = (
            len(state.warm_history) >= self.HOT_WINDOW
            and float(np.mean(state.warm_history[-self.HOT_WINDOW:])) >= self.WARM_RATE
        )
        hot = (
            len(state.hot_history) >= self.HOT_WINDOW
            and float(np.mean(state.hot_history[-self.HOT_WINDOW:])) >= self.HOT_RATE
        )
        graded_t0 = bool(
            available
            and (
                rank >= 0.65
                or (0.60 <= rank < 0.65 and warm)
                or (0.50 <= rank < 0.60 and hot)
            )
        )
        graded = external_direction if graded_t0 else router

        state.cursor_index = index
        state.cursor_ts = row["ts"].isoformat()
        self._last = {
            "index": index,
            "base_direction": base,
            "router": router,
            "context_direction": context_direction,
            "external_direction": external_direction,
            "available": bool(available),
        }
        return {
            "ts": row["ts"],
            "t5_input_complete": bool(
                np.isfinite(derived[t5_lab.PRICE_FLOW].to_numpy(float)[position]).all()
            ),
            "p_pf_linear": probability["linear"],
            "p_pf_context_logit": probability["context"],
            "base_probability_green": ensemble,
            "base_direction": base,
            "t5_context_router_prediction": router,
            "external_probability_green": external.get("external_probability_green", np.nan),
            "external_direction": external_direction,
            "external_rank": rank,
            "graded_warm": warm,
            "graded_hot": hot,
            "continuous_graded_prediction": graded,
            "continuous_graded_stage": "T0" if graded_t0 else "T5",
        }

    def settle(self, ts: pd.Timestamp, label: float) -> None:
        """Record a resolved outcome; this is what advances the causal state."""

        state = self.state
        stamp = pd.Timestamp(ts)
        match = state.tail.index[state.tail.ts == stamp]
        if not len(match):
            raise RuntimeError(f"settle: {stamp.isoformat()} is not in the tail buffer")
        state.tail.loc[match[0], "label"] = label
        last = getattr(self, "_last", None)
        if last is None or state.tail.ts.iloc[-1] != stamp:
            return  # only the just-scored target advances the histories
        if not np.isfinite(label) or label == 0:
            return
        if last["context_direction"] != 0 and last["base_direction"] != 0 and (
            last["context_direction"] != last["base_direction"]
        ):
            state.router_history.append(int(last["context_direction"] * label > 0))
        if last["available"] and last["external_direction"] != 0 and last["router"] != 0 and (
            last["external_direction"] != last["router"]
        ):
            outcome = int(last["external_direction"] * label > 0)
            state.warm_history.append(outcome)
            state.hot_history.append(outcome)

    # -- refit --------------------------------------------------------------
    def _refit_for_block(self, block_start: int) -> None:
        """Extraction of the recovered walk-forward block fit, same constants."""

        state = self.state
        if block_start < t5_lab.MINIMUM_TRAINING_ROWS:
            return
        derived = t5_lab.derive_features(state.tail)
        offset = state.index_of_tail_start
        stop = block_start - offset  # exclusive, training is strictly past-only
        if stop <= 0:
            return
        start = max(0, block_start - t5_lab.PRIMARY_WINDOW - offset)
        window = derived.iloc[start:stop]
        label = window.label.to_numpy(float)
        eligible = np.isfinite(label) & (label != 0)
        target = (label > 0).astype(float)
        for name, head in state.heads.items():
            x = window[head.features].to_numpy(float)
            complete = np.isfinite(x).all(axis=1)
            rows = np.flatnonzero(complete & eligible & np.isfinite(target))
            head.scaler = None
            head.model = None
            head.fitted_at_index = None
            if len(rows) < t5_lab.MINIMUM_TRAINING_ROWS:
                continue
            if np.unique(target[rows]).size != 2:
                continue
            scaler = t5_lab.RobustScaler(quantile_range=(10, 90))
            x_train = scaler.fit_transform(x[rows])
            model = t5_lab.LogisticRegression(
                C=0.003, solver="lbfgs", max_iter=5_000, random_state=0
            )
            model.fit(
                x_train,
                target[rows].astype(np.int8),
                sample_weight=t5_lab.day_balanced_weights(window.ts.iloc[rows]),
            )
            head.scaler = scaler
            head.model = model
            head.fitted_at_index = block_start
            head.fit_count += 1


def _block_start(index: int) -> int:
    minimum = t5_lab.MINIMUM_TRAINING_ROWS
    refit = t5_lab.REFIT_EVERY
    if index < minimum:
        return -1
    return minimum + refit * ((index - minimum) // refit)


def _is_refit_boundary(index: int) -> bool:
    minimum = t5_lab.MINIMUM_TRAINING_ROWS
    return index >= minimum and (index - minimum) % t5_lab.REFIT_EVERY == 0


def _router_history(frame: pd.DataFrame, upto_index: int) -> list[int]:
    label = frame.label.to_numpy(float)
    base = frame.base_direction.to_numpy(np.int8)
    probability = frame.p_pf_context_logit.to_numpy(float)
    context = np.where(
        np.isfinite(probability), np.where(probability >= 0.5, 1, -1), 0
    ).astype(np.int8)
    history: list[int] = []
    for index in range(upto_index + 1):
        if (
            context[index] != 0
            and base[index] != 0
            and context[index] != base[index]
            and np.isfinite(label[index])
            and label[index] != 0
        ):
            history.append(int(context[index] * label[index] > 0))
    return history


def _hot_history(frame: pd.DataFrame, upto_index: int) -> list[int]:
    label = frame.label.to_numpy(float)
    external = frame.external_direction.to_numpy(np.int8)
    t5 = frame.t5_context_router_prediction.to_numpy(np.int8)
    rank = frame.external_rank.to_numpy(float)
    available = np.isfinite(rank) & (external != 0)
    history: list[int] = []
    for index in range(upto_index + 1):
        if not available[index] or not np.isfinite(label[index]) or label[index] == 0:
            continue
        if external[index] != 0 and t5[index] != 0 and external[index] != t5[index]:
            history.append(int(external[index] * label[index] > 0))
    return history


__all__ = [
    "IDENTITY",
    "ARCHIVED_COMPARISON",
    "LEDGER_COLUMNS",
    "CoverageC30Server",
    "run_batch",
    "stress",
    "waterfall",
]
