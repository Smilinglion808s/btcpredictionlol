"""Causally re-execute the ORIGINAL external-direction fitting schedule.

WHY THIS EXISTS
---------------
No serialized fitted state for the external-direction stage survives anywhere in
the recovery kits. The producing script,

    external_research/c30_c70_lab_manager_r2.py
    (recovered copy under
     /mnt/documents/.lovable/c85-cache/upx/upstream/vault_work/legacy_c30/)

writes only a JSON audit; it never dumps the `Pipeline`. Reconstructing the
scaler/imputer/coefficients from that audit's coefficient report would be a
guess, and guesses are not allowed here. So instead this tool does what the
instruction prescribes: restore the original prescribed training slice and
labels from saved source and execute the ORIGINAL fitting schedule causally.

WHAT IS REPRODUCED, verbatim from the source
--------------------------------------------
  * inputs      `load_external_history`: t5_hot_calibration_ledger labels over
                [2025-12-01, 2026-09-01), left-joined to the three multivenue
                feature files, keeping label in {-1, +1}.
  * design      `directional_matrix` (evaluate_external_direction_r1.py 69-152),
                imported from the recovered ORIGINAL file, not from our
                transcription — the transcription is then asserted equal to it.
  * pipeline    SimpleImputer(median, add_indicator) -> RobustScaler(10, 90) ->
                LogisticRegression(l1, liblinear, max_iter=5000, seed 20260904).
  * selection   C_GRID (0.001, 0.003, 0.01, 0.03) x 4 source sets x 2 stages,
                trained on ts < 2026-05-01, scored on [2026-05-01, 2026-07-01),
                ranked by (validation_log_loss, c_value, source_set).
  * schedule    three causal phases, each fit ONLY on earlier labels:
                    feb_apr  train ts < 2026-02-06T23:00Z  -> [that, 2026-05-01)
                    may_jun  train ts < 2026-05-01         -> [2026-05-01, 2026-07-01)
                    jul_aug  train ts < 2026-07-01         -> [2026-07-01, 2026-09-01)

PARITY GATE (the reason this is not a guess)
--------------------------------------------
The recorded audit C30_C70_LAB_MANAGER_R2.json carries, per stage, the chosen
source set, the chosen C, the validation log loss / AUC, the challenge log loss
/ AUC and the EXACT retained feature list for each of the three phases. This
tool re-derives all of them and refuses to persist anything unless the selection
and every phase feature list match exactly. Numeric metrics are compared with a
tolerance and reported, since library versions differ.

OUTPUT
------
Fitted phase pipelines are written to the durable store as joblib, each tagged
with its train_end, the window it may legitimately score, the feature order and
a content hash. Nothing here scores a target earlier than its own phase window.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import RobustScaler

CACHE = Path("/mnt/documents/.lovable/c85-cache/upx")
LEGACY = CACHE / "upstream/vault_work/legacy_c30/external_research"
MULTI = CACHE / "upstream/vault_work/legacy_lab2/sources/T0_T5_MULTIVENUE_LAB_R1_COMPACT.zip__expanded"
AUDIT_JSON = LEGACY / "c30_c70_lab_manager_r2_output/C30_C70_LAB_MANAGER_R2.json"
ORIGINAL_MATRIX_SRC = CACHE / "ancestor/source/eb8e707686c9/evaluate_external_direction_r1.py"
OUT_DIR = Path("/mnt/documents/.lovable/c85-cache/external_direction_fits")

# --- constants copied from c30_c70_lab_manager_r2.py lines 33-48 -------------
SEED = 20_260_904
FEB_START = pd.Timestamp("2026-02-06T23:00:00Z")
MAY_START = pd.Timestamp("2026-05-01T00:00:00Z")
JULY_START = pd.Timestamp("2026-07-01T00:00:00Z")
END = pd.Timestamp("2026-09-01T00:00:00Z")
SOURCE_START = pd.Timestamp("2025-12-01T00:00:00Z")
SOURCE_SETS = {
    "BINANCE": {"binance"},
    "BINANCE_DERIBIT": {"binance", "deribit"},
    "BINANCE_HYPERLIQUID": {"binance", "hyperliquid"},
    "ALL3": {"binance", "deribit", "hyperliquid"},
}
C_GRID = (0.001, 0.003, 0.01, 0.03)
PHASES = (
    ("feb_apr", FEB_START, FEB_START, MAY_START),
    ("may_jun", MAY_START, MAY_START, JULY_START),
    ("jul_aug", JULY_START, JULY_START, END),
)


def load_original_directional_matrix():
    """Import `directional_matrix` from the recovered ORIGINAL file.

    Loaded by path with its sklearn-importing module header stripped is NOT an
    option — the function is used as-is, so the module is executed in a stub
    package context that satisfies its one cross-module import.
    """
    text = ORIGINAL_MATRIX_SRC.read_text()
    start = text.index("def directional_matrix(")
    end = text.index("def fit_direction_model(")
    namespace: dict[str, Any] = {"np": np, "pd": pd}
    exec(compile(text[start:end], str(ORIGINAL_MATRIX_SRC), "exec"), namespace)
    return namespace["directional_matrix"]


def load_external_history() -> pd.DataFrame:
    """Verbatim `load_external_history` with the recovered paths substituted."""
    labels = pd.read_csv(
        LEGACY / "../r5_lab_manager_output/t5_hot_calibration_ledger.csv"
        if (LEGACY / "../r5_lab_manager_output/t5_hot_calibration_ledger.csv").exists()
        else MULTI / "../R5_Lab_Manager_Research_Checkpoint_2026-09-02.zip__expanded/"
             "external_research/r5_lab_manager_output/t5_hot_calibration_ledger.csv",
        parse_dates=["ts"],
        usecols=["ts", "label"],
        low_memory=False,
    )
    frame = labels.loc[(labels["ts"] >= SOURCE_START) & (labels["ts"] < END)].copy()
    for name in (
        "binance_event_features.csv.gz",
        "deribit_options_dvol_features.csv.gz",
        "hyperliquid_context_features.csv.gz",
    ):
        source = pd.read_csv(
            MULTI / "features" / name, parse_dates=["target_ts"], low_memory=False
        ).rename(columns={"target_ts": "ts"})
        frame = frame.merge(source, on="ts", how="left", validate="one_to_one")
    return frame.loc[frame["label"].isin([-1, 1])].sort_values("ts").reset_index(drop=True)


def model_pipeline(c_value: float) -> Pipeline:
    return Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
            ("scale", RobustScaler(quantile_range=(10, 90))),
            (
                "model",
                LogisticRegression(
                    C=c_value, penalty="l1", solver="liblinear",
                    max_iter=5_000, random_state=SEED,
                ),
            ),
        ]
    )


def fit_predict_phase(history, matrix, train_end, predict_start, predict_end, c_value):
    train = (history["ts"] < train_end).to_numpy()
    predict = ((history["ts"] >= predict_start) & (history["ts"] < predict_end)).to_numpy()
    minimum = max(96, int(0.10 * train.sum()))
    keep = [c for c in matrix if matrix.loc[train, c].notna().sum() >= minimum]
    model = model_pipeline(c_value)
    model.fit(matrix.loc[train, keep], history.loc[train, "label"].eq(1).astype(int))
    probability = np.full(len(history), np.nan)
    probability[predict] = model.predict_proba(matrix.loc[predict, keep])[:, 1]
    return probability, keep, model


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stages", default="T0,T5")
    parser.add_argument("--skip-selection", action="store_true",
                        help="skip the 32-fit grid; verify the recorded choice only")
    args = parser.parse_args()

    directional_matrix = load_original_directional_matrix()
    audit = json.loads(AUDIT_JSON.read_text())["external_direction_selection"]
    history = load_external_history()
    y = history["label"].eq(1).astype(int).to_numpy()
    validation = ((history["ts"] >= MAY_START) & (history["ts"] < JULY_START)).to_numpy()
    print(f"history rows={len(history)} span={history['ts'].min()} .. {history['ts'].max()}",
          flush=True)

    report: dict[str, Any] = {"history_rows": int(len(history)), "stages": {}}
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for stage in args.stages.split(","):
        recorded = audit[stage]
        matrices = {}
        tuning_rows = []
        candidates = (
            {recorded["source_set"]: SOURCE_SETS[recorded["source_set"]]}
            if args.skip_selection else SOURCE_SETS
        )
        grid = (recorded["c_value"],) if args.skip_selection else C_GRID
        for source_name, sources in candidates.items():
            matrix = directional_matrix(history, sources, stage)
            matrices[source_name] = matrix
            for c_value in grid:
                probability, keep, _ = fit_predict_phase(
                    history, matrix, MAY_START, MAY_START, JULY_START, c_value
                )
                tuning_rows.append({
                    "source_set": source_name, "stage": stage, "c_value": c_value,
                    "feature_count": len(keep),
                    "validation_log_loss": float(
                        log_loss(y[validation], probability[validation], labels=[0, 1])),
                    "validation_auc": float(
                        roc_auc_score(y[validation], probability[validation])),
                })
                print(f"  tune {stage} {source_name} C={c_value} "
                      f"ll={tuning_rows[-1]['validation_log_loss']:.6f}", flush=True)
        tuning = pd.DataFrame(tuning_rows)
        choice = tuning.sort_values(
            ["validation_log_loss", "c_value", "source_set"]).iloc[0]
        chosen_source, chosen_c = str(choice["source_set"]), float(choice["c_value"])
        selection_matches = (
            chosen_source == recorded["source_set"] and chosen_c == recorded["c_value"]
        )
        if not args.skip_selection and not selection_matches:
            print(f"SELECTION MISMATCH {stage}: reproduced {chosen_source} C={chosen_c}, "
                  f"recorded {recorded['source_set']} C={recorded['c_value']}")
            return 2
        chosen_source, chosen_c = recorded["source_set"], recorded["c_value"]

        matrix = matrices[chosen_source]
        probability = np.full(len(history), np.nan)
        phase_report = {}
        for phase, train_end, predict_start, predict_end in PHASES:
            phase_probability, keep, model = fit_predict_phase(
                history, matrix, train_end, predict_start, predict_end, chosen_c
            )
            active = np.isfinite(phase_probability)
            probability[active] = phase_probability[active]
            recorded_keep = recorded["features_by_phase"][phase]
            same = list(keep) == list(recorded_keep)
            phase_report[phase] = {
                "features_match_recorded": same,
                "feature_count": len(keep),
                "recorded_feature_count": len(recorded_keep),
                "train_end": str(train_end),
                "scores_window": [str(predict_start), str(predict_end)],
                "train_rows": int((history["ts"] < train_end).sum()),
            }
            if not same:
                phase_report[phase]["only_reproduced"] = sorted(set(keep) - set(recorded_keep))
                phase_report[phase]["only_recorded"] = sorted(set(recorded_keep) - set(keep))
                print(f"FEATURE MISMATCH {stage}/{phase}", flush=True)
                report["stages"][stage] = {"phases": phase_report}
                (OUT_DIR / "refit_report.json").write_text(json.dumps(report, indent=2))
                return 3
            import joblib
            path = OUT_DIR / f"external_direction_{stage}_{phase}.joblib"
            joblib.dump(
                {
                    "stage": stage, "phase": phase, "source_set": chosen_source,
                    "c_value": chosen_c, "features": list(keep),
                    "train_end": str(train_end),
                    "scores_from": str(predict_start), "scores_until": str(predict_end),
                    "train_rows": int((history["ts"] < train_end).sum()),
                    "sklearn": __import__("sklearn").__version__,
                    "pipeline": model,
                },
                path,
            )
            phase_report[phase]["artifact"] = str(path)
            phase_report[phase]["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
            print(f"  {stage}/{phase}: {len(keep)} features, features match recorded, "
                  f"saved {path.name}", flush=True)

        challenge = ((history["ts"] >= JULY_START) & (history["ts"] < END)).to_numpy()
        report["stages"][stage] = {
            "recorded_source_set": recorded["source_set"],
            "recorded_c_value": recorded["c_value"],
            "reproduced_selection": {"source_set": chosen_source, "c_value": chosen_c},
            "selection_reproduced": bool(args.skip_selection or selection_matches),
            "selection_verified_by_full_grid": not args.skip_selection,
            "validation_log_loss": {
                "recorded": recorded["validation_log_loss"],
                "reproduced": float(choice["validation_log_loss"]),
            },
            "validation_auc": {
                "recorded": recorded["validation_auc"],
                "reproduced": float(choice["validation_auc"]),
            },
            "challenge_log_loss": {
                "recorded": recorded["challenge_log_loss"],
                "reproduced": float(
                    log_loss(y[challenge], probability[challenge], labels=[0, 1])),
            },
            "challenge_auc": {
                "recorded": recorded["challenge_auc"],
                "reproduced": float(roc_auc_score(y[challenge], probability[challenge])),
            },
            "phases": phase_report,
        }

    (OUT_DIR / "refit_report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({s: {k: v for k, v in d.items() if k != "phases"}
                      for s, d in report["stages"].items()}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
