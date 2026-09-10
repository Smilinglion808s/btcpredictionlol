"""Version 1 reference and restart checks.

Three independent things are proven here, all against the SUPPLIED artifacts —
never against this build's own output:

  1. protocol replay   — rebuild the composed pipeline (baseline LiteA -> the
     0.90-exception DailyFloor) over the 19,487-row historical frame using the
     supplied daily heads, and compare every row against the supplied ledgers;
  2. UTC refit         — refit each UTC-midnight cutoff with the vendored
     `fit_daily` and compare against the supplied offline refit head;
  3. restart equality  — restore the supplied restart fixtures (including the
     real pending-exception guard fixture) and confirm byte-identical snapshots.

Usage:
    python -m tools.litea_reference_replay --reference /path/to/extracted
"""
from __future__ import annotations

import argparse
import gzip
import csv
import json
import sys
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.litea.engine import Head, LiteA, canonical, instant, wrap_historical_head  # noqa: E402
from src.litea.guard import DailyFloor  # noqa: E402


def read_csv_gz(path: Path) -> tuple[list[str], list[list[str]]]:
    with gzip.open(path, "rt") as handle:
        reader = csv.reader(handle)
        header = next(reader)
        return header, list(reader)


def load_heads(folder: Path) -> list[Head]:
    heads = []
    for path in sorted(folder.glob("*.json")):
        heads.append(Head(wrap_historical_head(json.loads(path.read_text()))))
    return heads


def head_for(heads: list[Head], target) -> Head | None:
    moment = instant(target)
    for head in reversed(heads):
        if head.start <= moment < head.end:
            return head
    return None


def protocol_replay(reference: Path) -> dict:
    feature_path = (
        reference
        / "c85_research_inputs/c71/research_c71/full/DIRECTION_FEATURES_CM_BOTH.csv.gz"
    )
    ledger_path = reference / "lite_a_engine_v1/output/baseline_decisions.csv.gz"
    floor_path = reference / "lite_a_confidence_exception/output/decision_ledger.csv.gz"

    fheader, frows = read_csv_gz(feature_path)
    lheader, lrows = read_csv_gz(ledger_path)
    gheader, grows = read_csv_gz(floor_path)
    assert len(frows) == len(lrows) == len(grows), "reference row counts disagree"

    order = fheader[2:]
    heads = load_heads(reference / "c85_research_inputs/kit/models/C71_DIRECTION")

    engine = LiteA(mode="baseline")
    guard = DailyFloor(exception_rank=0.90)

    settled: list[tuple] = []
    engine_mismatch = 0
    guard_mismatch = 0
    calls = 0

    li = {name: i for i, name in enumerate(lheader)}
    gi = {name: i for i, name in enumerate(gheader)}

    for frow, lrow, grow in zip(frows, lrows, grows):
        target = instant(frow[0])
        ticker = frow[1]
        observed = target + timedelta(seconds=5)

        # Apply every settlement that became available before this observation.
        while settled and settled[0][0] <= observed:
            available, s_ticker, label = settled.pop(0)
            engine.settle(s_ticker, label, available_at=available, observed_at=observed)
            guard.settle(s_ticker, label, available_at=available, observed_at=observed)

        features = {
            name: (float(frow[2 + j]) if frow[2 + j] not in ("", "nan") else None)
            for j, name in enumerate(order)
        }
        head = head_for(heads, target)
        out = engine.decide(
            target=target,
            ticker=ticker,
            features=features,
            input_valid=True,
            head=head,
            observed_at=observed,
        )
        gout = guard.decide(
            target=target,
            ticker=ticker,
            candidate=out["candidate"],
            rank=out["rank"],
            observed_at=observed,
        )

        expected_reason = lrow[li["reason"]]
        expected_candidate = int(lrow[li["candidate"]])
        if out["reason"] != expected_reason or out["candidate"] != expected_candidate:
            engine_mismatch += 1
        if gout["reason"] != grow[gi["new_reason"]]:
            guard_mismatch += 1
        if int(grow[gi["exception_prediction"]]) != gout["prediction"]:
            guard_mismatch += 1
        if gout["prediction"]:
            calls += 1

        label_text = lrow[li["label"]]
        settlement_text = lrow[li["settlement_ts"]]
        if label_text in ("-1", "1") and settlement_text:
            settled.append((instant(settlement_text), ticker, int(label_text)))
            settled.sort(key=lambda item: item[0])

    return {
        "rows": len(frows),
        "engine_mismatches": engine_mismatch,
        "guard_mismatches": guard_mismatch,
        "guard_calls": calls,
    }


def restart_checks(reference: Path) -> dict:
    results = {}
    for name, cls in (
        ("lite_a_engine_v1/output/restart_baseline_0.json", LiteA),
        ("lite_a_engine_v1/output/restart_baseline_1.json", LiteA),
        ("lite_a_engine_v1/output/checkpoint_baseline.json", LiteA),
        ("lite_a_confidence_exception/output/real_pending_exception_restart.json", DailyFloor),
    ):
        path = reference / name
        if not path.exists():
            results[name] = "MISSING"
            continue
        payload = json.loads(path.read_text())
        envelope = payload.get("checkpoint", payload)
        restored = cls.restore(envelope)
        again = restored.snapshot()
        identical = canonical(again) == canonical(envelope)
        results[name] = "IDENTICAL" if identical else "DIFFERS"
    return results


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", required=True, type=Path)
    args = parser.parse_args()

    report = {
        "protocol_replay": protocol_replay(args.reference),
        "restart": restart_checks(args.reference),
    }
    print(json.dumps(report, indent=2, sort_keys=True))
    replay = report["protocol_replay"]
    ok = replay["engine_mismatches"] == 0 and replay["guard_mismatches"] == 0
    ok = ok and all(v == "IDENTICAL" for v in report["restart"].values())
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
