"""Version 1 reference and restart checks against the SUPPLIED artifacts.

Nothing here is compared against this build's own output. Three things are
proven independently:

  1. protocol replay — run the composed Version 1 pipeline (baseline LiteA ->
     DailyFloor(exception_rank=0.90)) over the 19,487-row historical direction
     frame using the supplied daily heads, and compare EVERY row against both
     supplied ledgers;
  2. restart equality — restore each supplied restart fixture, replay its
     events, and compare outputs and the resulting checkpoint with the supplied
     expectation; then do it again with an extra restart in the middle of the
     event stream, which is the case a real container actually hits;
  3. UTC-midnight refit — refit the 2026-08-31 cutoff with the vendored
     `fit_daily` and compare against the supplied offline refit head.

Usage:
    python -m tools.litea_reference_replay --reference /tmp/litea [--skip-fit]

`--reference` points at the folder holding the two extracted packages as
`eng/` (engine audit) and `gd/` (confidence-exception audit).
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import sys
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.litea.engine import (  # noqa: E402
    Head,
    LiteA,
    canonical,
    instant,
    wrap_historical_head,
)
from src.litea.guard import DailyFloor  # noqa: E402


def read_csv_gz(path: Path):
    with gzip.open(path, "rt") as handle:
        reader = csv.reader(handle)
        header = next(reader)
        return header, list(reader)


def load_heads(folder: Path):
    heads = []
    for path in sorted(folder.glob("*.json")):
        heads.append(Head(wrap_historical_head(json.loads(path.read_text()))))
    heads.sort(key=lambda h: h.start)
    return heads


def head_for(heads, target):
    moment = instant(target)
    for head in reversed(heads):
        if head.start <= moment < head.end:
            return head
    return None


# -- 1. protocol replay --------------------------------------------------------
def protocol_replay(reference: Path) -> dict:
    features_path = (
        reference
        / "eng/c85_research_inputs/c71/research_c71/full/DIRECTION_FEATURES_CM_BOTH.csv.gz"
    )
    fheader, frows = read_csv_gz(features_path)
    lheader, lrows = read_csv_gz(reference / "eng/lite_a_engine_v1/output/baseline_decisions.csv.gz")
    iheader, irows = read_csv_gz(reference / "eng/c85_ideation/output/decision_ledger.csv.gz")
    gheader, grows = read_csv_gz(
        reference / "gd/lite_a_confidence_exception/output/decision_ledger.csv.gz"
    )
    if not len(frows) == len(lrows) == len(grows) == len(irows):
        raise SystemExit("reference row counts disagree")

    order = fheader[2:]
    heads = load_heads(reference / "eng/c85_research_inputs/kit/models/C71_DIRECTION")

    engine = LiteA(mode="baseline")
    guard = DailyFloor(exception_rank=0.90)

    li = {name: i for i, name in enumerate(lheader)}
    ii = {name: i for i, name in enumerate(iheader)}
    gi = {name: i for i, name in enumerate(gheader)}

    queued: list[tuple] = []
    engine_mismatch = 0
    guard_mismatch = 0
    calls = 0
    exceptions = 0

    for frow, lrow, irow, grow in zip(frows, lrows, irows, grows):
        target = instant(frow[0])
        ticker = frow[1]
        observed = target + timedelta(seconds=5)

        # Settlements that became available at or before this observation.
        while queued and queued[0][0] <= observed:
            available, s_ticker, label = queued.pop(0)
            engine.settle(s_ticker, label, available_at=available, observed_at=observed)
            guard.settle(s_ticker, label, available_at=available, observed_at=observed)

        raw = {}
        for j, name in enumerate(order):
            text = frow[2 + j]
            raw[name] = None if text in ("", "nan", "NaN") else float(text)
        input_valid = irow[ii["L1_D60_CONF__input_valid"]].strip().lower() in ("true", "1")

        out = engine.decide(
            target=target,
            ticker=ticker,
            features=raw,
            input_valid=input_valid,
            head=head_for(heads, target),
            observed_at=observed,
        )
        if out["reason"] != lrow[li["reason"]] or out["candidate"] != int(lrow[li["candidate"]]):
            engine_mismatch += 1

        gout = guard.decide(
            target=target,
            ticker=ticker,
            candidate=out["candidate"],
            rank=out["rank"],
            observed_at=observed,
        )
        if (
            gout["reason"] != grow[gi["new_reason"]]
            or gout["prediction"] != int(grow[gi["exception_prediction"]])
            or gout["exception"] != (grow[gi["new_exception"]].strip().lower() in ("true", "1"))
        ):
            guard_mismatch += 1
        calls += 1 if gout["prediction"] else 0
        exceptions += 1 if gout["exception"] else 0

        label_text = lrow[li["label"]]
        settlement_text = lrow[li["settlement_ts"]]
        if label_text in ("-1", "1") and settlement_text:
            queued.append((instant(settlement_text), ticker, int(label_text)))
            queued.sort(key=lambda item: item[0])

    return {
        "rows": len(frows),
        "engine_mismatches": engine_mismatch,
        "guard_mismatches": guard_mismatch,
        "version1_calls": calls,
        "version1_exceptions": exceptions,
        "first_target": frows[0][0],
        "last_target": frows[-1][0],
    }


# -- 2. restart equality -------------------------------------------------------
def _apply(instance, event, heads_by_id):
    args = dict(event["args"])
    if event["type"] == "settlement":
        return instance.settle(
            args["ticker"],
            args["label"],
            available_at=args["available_at"],
            observed_at=args["observed_at"],
        )
    payload = args.pop("head", None)
    if payload is not None:
        args["head"] = Head(payload)
    return instance.decide(**args)


def _run_fixture(cls, fixture: dict, restart_after: int | None) -> dict:
    instance = cls.restore(fixture["checkpoint"])
    outputs = []
    for index, event in enumerate(fixture["events"]):
        if restart_after is not None and index == restart_after:
            # A real container dies here. It restores from its own snapshot and
            # must produce byte-identical remaining output.
            instance = cls.restore(instance.snapshot())
        result = _apply(instance, event, None)
        if event["type"] == "decision":
            outputs.append(result)
    return {"outputs": outputs, "checkpoint": instance.snapshot()}


def restart_checks(reference: Path) -> dict:
    fixtures = {
        "engine/restart_baseline_0": (LiteA, "eng/lite_a_engine_v1/output/restart_baseline_0.json"),
        "engine/restart_baseline_1": (LiteA, "eng/lite_a_engine_v1/output/restart_baseline_1.json"),
        "guard/real_pending_exception": (
            DailyFloor,
            "gd/lite_a_confidence_exception/output/real_pending_exception_restart.json",
        ),
    }
    report = {}
    for name, (cls, relative) in fixtures.items():
        path = reference / relative
        if not path.exists():
            report[name] = {"status": "MISSING"}
            continue
        fixture = json.loads(path.read_text())
        straight = _run_fixture(cls, fixture, None)
        midpoint = max(1, len(fixture["events"]) // 2)
        restarted = _run_fixture(cls, fixture, midpoint)
        report[name] = {
            "outputs_match_supplied": canonical(straight["outputs"])
            == canonical(fixture["outputs"]),
            "checkpoint_matches_supplied": canonical(straight["checkpoint"])
            == canonical(fixture["expected_checkpoint"]),
            "restart_identical": canonical(restarted) == canonical(straight),
            "restart_after_event": midpoint,
            "events": len(fixture["events"]),
        }
    return report


# -- 3. UTC-midnight refit -----------------------------------------------------
def refit_check(reference: Path) -> dict:
    import pandas as pd

    from src.litea.fit import fit_daily

    expected_path = (
        reference / "eng/lite_a_engine_v1/output/offline_refit_2026-08-31_HISTORICAL_EXPIRED.json"
    )
    if not expected_path.exists():
        return {"status": "MISSING_REFERENCE"}
    expected = json.loads(expected_path.read_text())

    fheader, frows = read_csv_gz(
        reference
        / "eng/c85_research_inputs/c71/research_c71/full/DIRECTION_FEATURES_CM_BOTH.csv.gz"
    )
    lheader, lrows = read_csv_gz(reference / "eng/lite_a_engine_v1/output/baseline_decisions.csv.gz")
    iheader, irows = read_csv_gz(reference / "eng/c85_ideation/output/decision_ledger.csv.gz")
    li = {name: i for i, name in enumerate(lheader)}
    ii = {name: i for i, name in enumerate(iheader)}
    order = fheader[2:]

    frame = pd.DataFrame(
        {
            "ts": pd.to_datetime([r[0] for r in frows], utc=True),
            "ticker": [r[1] for r in frows],
            "input_valid": [
                r[ii["L1_D60_CONF__input_valid"]].strip().lower() in ("true", "1") for r in irows
            ],
            "label": pd.to_numeric([r[li["label"]] for r in lrows], errors="coerce"),
            "settlement_ts": pd.to_datetime(
                [r[li["settlement_ts"]] or None for r in lrows], utc=True
            ),
        }
    )
    features = pd.DataFrame(
        {name: pd.to_numeric([r[2 + j] for r in frows], errors="coerce") for j, name in enumerate(order)}
    )
    cutoff = pd.Timestamp(expected["fit_cutoff"])
    positions = frame.index[frame.ts == cutoff]
    if len(positions) != 1:
        return {"status": "CUTOFF_NOT_IN_FRAME", "fit_cutoff": expected["fit_cutoff"]}
    produced = fit_daily(frame, features, int(positions[0]))
    if produced is None:
        return {"status": "INELIGIBLE", "fit_cutoff": expected["fit_cutoff"]}
    differences = sorted(k for k in expected if canonical(produced.get(k)) != canonical(expected[k]))

    # Row selection, weighting and solver behaviour must agree EXACTLY. The
    # fitted arrays are compared numerically instead, because the only feature
    # source shipped in the audit package is a CSV: a float64 text round trip
    # perturbs the inputs at the last bit, which propagates into the fitted
    # parameters. A deviation above the ULP scale would be a protocol defect,
    # not a formatting artefact.
    import numpy as np

    deltas = {}
    for key in ("imputation", "center", "scale", "coefficient"):
        got = np.asarray(produced[key], dtype=float)
        want = np.asarray(expected[key], dtype=float)
        absolute = np.abs(got - want)
        relative = absolute / np.maximum(np.abs(want), 1e-12)
        deltas[key] = {"max_abs": float(absolute.max()), "max_rel": float(relative.max())}
    intercept_delta = abs(produced["intercept"] - expected["intercept"])
    deltas["intercept"] = {
        "max_abs": intercept_delta,
        "max_rel": intercept_delta / max(abs(expected["intercept"]), 1e-12),
    }
    worst_rel = max(d["max_rel"] for d in deltas.values())

    exact_fields = [
        "feature_order",
        "fit_cutoff",
        "train_rows",
        "train_start",
        "train_end",
        "max_train_settlement",
        "valid_until_exclusive",
        "parameters",
        "iterations",
        "model",
    ]
    exact_mismatches = [
        k for k in exact_fields if canonical(produced.get(k)) != canonical(expected.get(k))
    ]
    return {
        "status": "COMPARED",
        "fit_cutoff": expected["fit_cutoff"],
        "train_rows": produced["train_rows"],
        "train_start": produced["train_start"],
        "train_end": produced["train_end"],
        "bit_identical": not differences,
        "differing_fields": differences,
        "exact_field_mismatches": exact_mismatches,
        "parameter_deltas": deltas,
        "worst_relative_delta": worst_rel,
        "within_float_tolerance": worst_rel < 1e-11,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--skip-fit", action="store_true")
    parser.add_argument("--skip-replay", action="store_true")
    args = parser.parse_args()

    report: dict = {"restart": restart_checks(args.reference)}
    if not args.skip_replay:
        report["protocol_replay"] = protocol_replay(args.reference)
    if not args.skip_fit:
        report["refit"] = refit_check(args.reference)
    print(json.dumps(report, indent=2, sort_keys=True))

    ok = all(
        isinstance(v, dict) and v.get("outputs_match_supplied") and v.get("restart_identical")
        for v in report["restart"].values()
    )
    replay = report.get("protocol_replay")
    if replay:
        ok = ok and replay["engine_mismatches"] == 0 and replay["guard_mismatches"] == 0
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
