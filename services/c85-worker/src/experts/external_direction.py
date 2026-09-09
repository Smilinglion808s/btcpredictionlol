"""C30/C70 multivenue direction head: producers -> directional matrix -> fit.

NAMING CORRECTION (2026-09-09). This module is *not* the producer of the leaf
key ``external_direction``. Tracing the recovered sources end to end:

  long_context_model.predictions()            -> external_direction / external_rank
    -> t0_long_context_full_predictions.csv
    -> t0_t5_coverage_bridge_audit_r1.py      -> continuous_coverage_ledger.csv
    -> t0_t5_fee_coverage_frontier_r1.py      -> fee_coverage_shadow_ledger.csv
    -> build_c42_maturation_consensus_r1.py   -> C42 -> C85

``external_direction`` is therefore the signed call of the frozen
``T0_LONG_CONTEXT_R1`` head (``ALL_HGB``, retain 0.25) - see
``src/experts/direction_contract.py``, which carries that contract and matches
the archived ledger exactly. What *this* module holds is the
``c30_c70_lab_manager_r2.py`` head, whose outputs are ``p_t0_green`` /
``p_t5_green`` in ``map_external_scores`` (lines 368-390), consumed there via
``directional_past_rank`` of ``p_correct`` - a different rank family (lookback
768, minimum 96) from ``external_rank``. Nothing computed here may be written
into the ``external_direction`` / ``external_rank`` leaf fields.

The pipelines are the artifacts produced by ``tools/refit_external_direction.py``,
which re-executed the original schedule from ``c30_c70_lab_manager_r2.py`` and
reproduced its recorded selection (``BINANCE_HYPERLIQUID``, ``C=0.03`` for both
stages), its validation and challenge metrics, and its retained feature lists
exactly.

The three things this module is careful about, because getting any of them
wrong would quietly change the model:

**Causal fit selection.** Each phase artifact carries the training cutoff it
was fitted to and the window it was scheduled to score. A target is scored by
the phase whose scoring window contains it - never by a later fit that saw the
target's own outcome, and never by extending a fit past the window the original
schedule gave it. A target after the last scheduled window has *no applicable
fit*; that is reported as a blocker, not papered over with the newest artifact.

**Preprocessing.** The fitted ``Pipeline`` (median imputation with missingness
indicators -> RobustScaler(10,90) -> L1 logistic regression) is applied whole,
as fitted. Missing columns stay NaN into the imputer; they are not zero-filled
here, and a NaN is not turned into a no-call - the model was fitted to impute.

**Feature order.** Columns are reindexed to the artifact's own retained feature
list, so a producer that emits columns in another order, or omits one, cannot
silently shift coefficients onto the wrong feature.

Parity scope, stated honestly: the matrix transform is a verbatim
transcription with exact archived parity, and these pipelines reproduce the
original fit exactly. Feeding them from the live Binance/Hyperliquid producers
is validated here only where the raw samples and the fits overlap in time;
where they do not, the derived-matrix path is validated against archived
observations and that is *not* a raw end-to-end parity claim.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd

from .direction_contract import signed_direction
from .direction_matrix import SOURCE_SETS, directional_matrix

DEFAULT_FITS_DIR = Path(
    os.environ.get(
        "C85_EXTERNAL_DIRECTION_FITS",
        "/mnt/documents/.lovable/c85-cache/external_direction_fits",
    )
)
REPORT_NAME = "refit_report.json"
STAGES = ("T0", "T5")


class ExternalDirectionUnavailable(RuntimeError):
    """Raised when no artifact may legitimately score the requested target."""


@dataclass(frozen=True)
class PhaseFit:
    """One scheduled refit: what it was trained on and what it may score."""

    stage: str
    phase: str
    source_set: str
    c_value: float
    features: tuple[str, ...]
    train_end: pd.Timestamp
    scores_from: pd.Timestamp
    scores_until: pd.Timestamp
    sha256: str
    pipeline: Any

    def covers(self, target_ts: pd.Timestamp) -> bool:
        return self.scores_from <= target_ts < self.scores_until


class ExternalDirectionModel:
    """The fitted external-direction head for one stage set, loaded from disk."""

    def __init__(self, fits: Mapping[str, Sequence[PhaseFit]], *, report: dict[str, Any]):
        self.fits = {stage: tuple(sorted(v, key=lambda f: f.scores_from))
                     for stage, v in fits.items()}
        self.report = report

    # -- loading ------------------------------------------------------------
    @classmethod
    def load(cls, directory: Path | str = DEFAULT_FITS_DIR) -> "ExternalDirectionModel":
        import joblib

        directory = Path(directory)
        report_path = directory / REPORT_NAME
        if not report_path.exists():
            raise ExternalDirectionUnavailable(
                f"no refit report at {report_path}; run tools/refit_external_direction.py"
            )
        report = json.loads(report_path.read_text())
        fits: dict[str, list[PhaseFit]] = {}
        for stage in STAGES:
            stage_report = report["stages"][stage]
            if not stage_report.get("selection_reproduced"):
                raise ExternalDirectionUnavailable(
                    f"{stage} artifacts did not reproduce the recorded selection"
                )
            for phase, entry in stage_report["phases"].items():
                if not entry.get("features_match_recorded"):
                    raise ExternalDirectionUnavailable(
                        f"{stage}/{phase} feature list does not match the recorded one"
                    )
                blob = joblib.load(entry["artifact"])
                fits.setdefault(stage, []).append(PhaseFit(
                    stage=stage,
                    phase=phase,
                    source_set=blob["source_set"],
                    c_value=float(blob["c_value"]),
                    features=tuple(blob["features"]),
                    train_end=pd.Timestamp(blob["train_end"]),
                    scores_from=pd.Timestamp(blob["scores_from"]),
                    scores_until=pd.Timestamp(blob["scores_until"]),
                    sha256=entry["sha256"],
                    pipeline=blob["pipeline"],
                ))
        return cls(fits, report=report)

    # -- causal selection ---------------------------------------------------
    def phase_for(self, stage: str, target_ts: pd.Timestamp) -> PhaseFit:
        target_ts = pd.Timestamp(target_ts)
        if target_ts.tzinfo is None:
            target_ts = target_ts.tz_localize("UTC")
        for fit in self.fits[stage]:
            if fit.covers(target_ts):
                return fit
        last = self.fits[stage][-1]
        raise ExternalDirectionUnavailable(
            f"no {stage} fit is scheduled to score {target_ts.isoformat()}; the last "
            f"scheduled window ends {last.scores_until.isoformat()} - the next "
            f"scheduled refit has not been run"
        )

    def coverage(self) -> dict[str, Any]:
        """What these artifacts may legitimately score, for the readiness report."""
        return {
            stage: {
                "phases": [
                    {
                        "phase": f.phase,
                        "source_set": f.source_set,
                        "c_value": f.c_value,
                        "feature_count": len(f.features),
                        "train_end": f.train_end.isoformat(),
                        "scores_from": f.scores_from.isoformat(),
                        "scores_until": f.scores_until.isoformat(),
                        "sha256": f.sha256,
                    }
                    for f in fits
                ],
                "scores_until": fits[-1].scores_until.isoformat(),
            }
            for stage, fits in self.fits.items()
        }

    # -- scoring ------------------------------------------------------------
    def design_row(self, stage: str, target_ts: pd.Timestamp,
                   observation: Mapping[str, float | None]) -> pd.DataFrame:
        """The one-row design matrix, in the artifact's own feature order."""
        fit = self.phase_for(stage, target_ts)
        frame = pd.DataFrame([{
            "ts": pd.Timestamp(target_ts).tz_convert("UTC")
            if pd.Timestamp(target_ts).tzinfo else pd.Timestamp(target_ts, tz="UTC"),
            **{k: (np.nan if v is None else v) for k, v in observation.items()},
        }])
        matrix = directional_matrix(frame, SOURCE_SETS[fit.source_set], stage)
        # Absent columns become NaN, which is exactly what the fitted imputer
        # was fitted to handle. They are NOT zero-filled and NOT a no-call.
        return matrix.reindex(columns=list(fit.features))

    def score(self, stage: str, target_ts: pd.Timestamp,
              observation: Mapping[str, float | None]) -> dict[str, Any]:
        fit = self.phase_for(stage, target_ts)
        design = self.design_row(stage, target_ts, observation)
        proba = fit.pipeline.predict_proba(design)
        classes = list(fit.pipeline.classes_)
        green_index = classes.index(1)
        p_green = float(proba[0][green_index])
        present = [c for c in fit.features if not pd.isna(design.iloc[0][c])]
        return {
            "stage": stage,
            "target_ts": pd.Timestamp(target_ts).isoformat(),
            "phase": fit.phase,
            "fit_id": f"c30_c70_direction_{stage}_{fit.phase}",
            "fit_sha256": fit.sha256,
            "train_end": fit.train_end.isoformat(),
            "source_set": fit.source_set,
            # `p_t0_green` / `p_t5_green` in c30_c70_lab_manager_r2.map_external_scores.
            "p_green": p_green,
            # The positive class *index* in `pipeline.classes_`. This is a
            # bookkeeping value, NOT a call, and is deliberately named apart
            # from any `direction` field: the C85 leaf direction contract is
            # signed {-1,+1} with 0 for "no probability" (direction_contract).
            "class_index": int(green_index),
            # Signed under the same contract as the rest of the chain, so this
            # value can never be confused with a 1/0 class index. It is the
            # sign of *this* head only, not `external_direction`.
            "signed_direction": signed_direction(p_green),
            "features_present": len(present),
            "features_expected": len(fit.features),
            "features_missing": [c for c in fit.features if c not in present],
        }


class ExternalDirectionExpert:
    """Producers -> matrix -> fitted head, for exactly one target.

    Readiness is reported separately from the score: the acquisition evidence
    from each producer travels with the result instead of being folded into a
    silent veto. The original model imputes missing inputs, so this layer does
    not invent an abstention rule; it hands the policy layer the facts.
    """

    def __init__(self, model: ExternalDirectionModel, binance: Any, hyperliquid: Any):
        self.model = model
        self.binance = binance
        self.hyperliquid = hyperliquid

    def observation(self, target_ms: int, *, mode: str, freeze_ns: int | None
                    ) -> dict[str, float | None]:
        merged: dict[str, float | None] = {}
        merged.update(self.binance.features_for(target_ms * 1_000, mode=mode,
                                                freeze_ns=freeze_ns))
        merged.update(self.hyperliquid.features_for(target_ms, mode=mode,
                                                    freeze_ns=freeze_ns))
        return merged

    def evaluate(self, target_ms: int, stage: str, *, mode: str,
                 freeze_ns: int | None = None) -> dict[str, Any]:
        observation = self.observation(target_ms, mode=mode, freeze_ns=freeze_ns)
        coverage = {
            "binance": self.binance.input_coverage(target_ms * 1_000, mode=mode,
                                                   freeze_ns=freeze_ns),
            "hyperliquid": self.hyperliquid.input_coverage(target_ms, mode=mode,
                                                           freeze_ns=freeze_ns),
        }
        target_ts = pd.Timestamp(target_ms, unit="ms", tz="UTC")
        try:
            result = self.model.score(stage, target_ts, observation)
        except ExternalDirectionUnavailable as exc:
            return {"stage": stage, "target_ts": target_ts.isoformat(),
                    "scored": False, "blocker": str(exc), "input_coverage": coverage}
        result["scored"] = True
        result["input_coverage"] = coverage
        return result
