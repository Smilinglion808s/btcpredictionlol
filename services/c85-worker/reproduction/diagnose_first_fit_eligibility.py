"""NO-FIT eligibility diagnostic for T0_LONG_CONTEXT_R1 (`ALL_HGB`).

Runs the *recovered original* preparation (`load_external`) and feature
selection (`feature_sets` / `model_specs`) from `long_context_model.py` on the
rebuilt long-context frame and reports, at each scheduled walk-forward
boundary, exactly how many training rows the original eligibility rule keeps
and which feature columns remove the rest. No model is fitted, nothing is
downloaded, and no missing-data rule is changed.

Usage:
    python diagnose_first_fit_eligibility.py \
        --research-root /path/to/c85root/external_research \
        --frame /path/to/long_context_features.pkl \
        --out /tmp/first_fit_eligibility.json
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def load_original(research_root: Path, frame_path: Path):
    """Import the recovered original module with FEATURES pointed at the frame."""
    module_path = research_root / "long_context_model.py"
    sys.path.insert(0, str(research_root.parent))
    spec = importlib.util.spec_from_file_location("recovered_long_context_model", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    module.FEATURES = frame_path
    return module, sha256_path(module_path)


def family_of(column: str) -> str:
    if column.startswith("book_"):
        return "DEPTH"
    if column.startswith("metric_"):
        return "METRICS"
    return "PRICE"


def boundary_report(module, frame, features, block_start: int) -> dict:
    x = frame[features].to_numpy(float)
    label = frame.label.to_numpy(float)
    target = (label > 0).astype(np.int8)
    finite = np.isfinite(x)
    complete = finite.all(axis=1)

    start = max(0, block_start - module.WINDOW)
    window = np.arange(start, block_start)
    label_ok = np.isfinite(label[window]) & (label[window] != 0)
    candidate = window[label_ok]                      # label-eligible rows
    train = window[complete[window] & label_ok]       # original training set

    # Missingness among label-eligible rows only.
    sub = finite[candidate]
    missing_per_feature = (~sub).sum(axis=0)
    per_feature = {
        features[i]: int(missing_per_feature[i])
        for i in range(len(features))
        if missing_per_feature[i]
    }
    per_family: dict[str, int] = {}
    for name in features:
        per_family.setdefault(family_of(name), 0)
    incomplete_rows = ~sub.all(axis=1)
    for fam in per_family:
        idx = [i for i, name in enumerate(features) if family_of(name) == fam]
        per_family[fam] = int((~sub[:, idx]).any(axis=1).sum())

    deficit = max(0, module.MINIMUM - len(train))

    # Smallest set of columns explaining the shortfall. Columns that share an
    # identical missing-row pattern are grouped first (dropping one of them
    # recovers nothing on its own), then groups are removed greedily.
    explanatory: list[dict] = []
    groups: dict[bytes, list[int]] = {}
    for i in range(len(features)):
        if missing_per_feature[i]:
            groups.setdefault((~sub[:, i]).tobytes(), []).append(i)
    if deficit:
        kept = np.ones(len(features), dtype=bool)
        rows_ok = sub.all(axis=1)
        remaining = list(groups.values())
        while remaining and rows_ok.sum() < module.MINIMUM:
            best, best_rows, best_mask = None, rows_ok.sum(), None
            for indices in remaining:
                trial = kept.copy()
                trial[indices] = False
                gained = int(sub[:, trial].all(axis=1).sum())
                if gained > best_rows:
                    best, best_rows, best_mask = indices, gained, trial
            if best is None:
                break
            kept = best_mask
            rows_ok = sub[:, kept].all(axis=1)
            remaining = [g for g in remaining if g is not best]
            explanatory.append(
                {
                    "columns": [features[i] for i in best],
                    "column_count": len(best),
                    "family": family_of(features[best[0]]),
                    "rows_missing_this_group": int(missing_per_feature[best[0]]),
                    "rows_recovered_to": int(best_rows),
                }
            )
    max_recoverable = int(len(candidate))


    fittable = len(train) >= module.MINIMUM and np.unique(target[train]).size == 2
    return {
        "block_start_position": int(block_start),
        "target_ts": frame.ts.iloc[block_start].isoformat(),
        "train_window_positions": [int(start), int(block_start)],
        "train_window_start_ts": frame.ts.iloc[start].isoformat(),
        "train_window_end_ts_exclusive": frame.ts.iloc[block_start].isoformat(),
        "candidate_rows_total": int(len(window)),
        "label_eligible_rows": int(len(candidate)),
        "complete_and_label_eligible_rows": int(len(train)),
        "minimum_required": int(module.MINIMUM),
        "deficit_from_minimum": int(deficit),
        "both_classes_present": bool(np.unique(target[train]).size == 2) if len(train) else False,
        "would_fit": bool(fittable),
        "incomplete_label_eligible_rows": int(incomplete_rows.sum()),
        "missing_by_family": per_family,
        "missing_by_feature": dict(sorted(per_feature.items(), key=lambda kv: -kv[1])),
        "minimal_explanatory_columns": explanatory,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--research-root", required=True, type=Path)
    parser.add_argument("--frame", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--archived-first-fit-ts", default="2026-03-02T00:15:00+00:00")
    parser.add_argument("--max-boundaries", type=int, default=64)
    args = parser.parse_args()

    module, source_sha = load_original(args.research_root, args.frame)
    frame = module.load_external()

    # integrity checks on the key
    duplicates = int(frame.ts.duplicated().sum())
    monotonic = bool(frame.ts.is_monotonic_increasing)
    deltas = frame.ts.diff().dropna().unique()
    grid_ok = len(deltas) == 1 and pd.Timedelta(deltas[0]) == pd.Timedelta(minutes=15)
    if duplicates or not monotonic:
        raise SystemExit(f"key integrity failure: duplicates={duplicates} monotonic={monotonic}")

    specs = module.model_specs(frame)
    features = specs["ALL_HGB"]["features"]

    archived = pd.Timestamp(args.archived_first_fit_ts)
    matches = np.where(frame.ts.to_numpy() == np.datetime64(archived.tz_convert("UTC").tz_localize(None), "ns"))[0]
    archived_position = int(matches[0]) if len(matches) else None

    boundaries = list(range(module.MINIMUM, len(frame), module.REFIT_EVERY))
    reports = []
    first_eligible = None
    for block_start in boundaries[: args.max_boundaries]:
        report = boundary_report(module, frame, features, block_start)
        reports.append(report)
        if report["would_fit"]:
            first_eligible = report
            break

    payload = {
        "diagnostic": "T0_LONG_CONTEXT_R1_FIRST_FIT_ELIGIBILITY_NO_FIT",
        "original_source_sha256": source_sha,
        "frame_path": str(args.frame),
        "frame_sha256": sha256_path(args.frame),
        "frame_rows": int(len(frame)),
        "frame_start_ts": frame.ts.iloc[0].isoformat(),
        "frame_end_ts": frame.ts.iloc[-1].isoformat(),
        "key_integrity": {
            "duplicate_timestamps": duplicates,
            "monotonic_increasing": monotonic,
            "uniform_15m_grid": bool(grid_ok),
        },
        "frozen_constants": {
            "WINDOW": module.WINDOW,
            "MINIMUM": module.MINIMUM,
            "REFIT_EVERY": module.REFIT_EVERY,
        },
        "selected_feature_count": len(features),
        "selected_features_sha256": hashlib.sha256("\n".join(features).encode()).hexdigest(),
        "archived_first_fit_ts": archived.isoformat(),
        "archived_first_fit_position_in_rebuilt_frame": archived_position,
        "position_MINIMUM_ts": frame.ts.iloc[module.MINIMUM].isoformat(),
        "rebuilt_first_eligible_boundary": first_eligible["target_ts"] if first_eligible else None,
        "boundaries": reports,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps({k: v for k, v in payload.items() if k != "boundaries"}, indent=2))
    for report in reports:
        print(
            report["target_ts"],
            "train=", report["complete_and_label_eligible_rows"],
            "deficit=", report["deficit_from_minimum"],
            "would_fit=", report["would_fit"],
        )


if __name__ == "__main__":
    main()
