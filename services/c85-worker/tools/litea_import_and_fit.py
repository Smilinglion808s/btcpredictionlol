"""Import the Version 1 rolling training frame, run the naturally due daily
fits, and carry the paired engine/guard state causally forward.

Inputs, all authentic:
  * the audited historical 60-column frame (19,487 recorded opportunities) and
    the audited official-label ledger, which also supplies each row's own
    INPUT_UNAVAILABLE sourcing verdict;
  * the September frame assembled by `litea_september_frame.py` from Binance
    archives and Kalshi settlement, in the same stage order as the live path;
  * the audited end-of-history paired checkpoints (`checkpoint_baseline.json`
    for the engine, `checkpoint_exception.json` for the 0.90 floor guard), so
    the September catch-up continues the proven causal state instead of
    replaying 19,487 rows again.

Only fits that are naturally due are run: one per AVAILABLE UTC-midnight target
after the last existing head cutoff, under the unchanged `fit.fit_daily`
protocol. Nothing is imputed, renamed, or back-dated.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.features import DIRECTION_ORDER  # noqa: E402
from src.litea.engine import LiteA  # noqa: E402
from src.litea.fit_service import run_due_fits  # noqa: E402
from src.litea.guard import DailyFloor  # noqa: E402
from src.litea.heads import DailyHeadStore, HeadUnavailable  # noqa: E402
from src.litea.state import Cursors, LiteAState  # noqa: E402
from src.litea.training import COLUMNS, TrainingFrame  # noqa: E402


def historical_frame(audit: Path, guard_audit: Path) -> pd.DataFrame:
    features = pd.read_csv(
        audit / "c85_research_inputs/c71/research_c71/full/DIRECTION_FEATURES_CM_BOTH.csv.gz"
    )
    features["ts"] = pd.to_datetime(features["ts"], utc=True)
    ledger = pd.read_csv(guard_audit / "decision_ledger.csv.gz")
    ledger["ts"] = pd.to_datetime(ledger["ts"], utc=True)
    ledger["settlement_ts"] = pd.to_datetime(ledger["settlement_ts"], utc=True)
    ledger["input_valid"] = ledger["base_reason"].ne("INPUT_UNAVAILABLE")
    merged = ledger[["ts", "ticker", "input_valid", "label", "settlement_ts"]].merge(
        features[["ts", *DIRECTION_ORDER]], on="ts", how="left", validate="one_to_one"
    )
    return merged[COLUMNS]


def september_frame(path: Path) -> pd.DataFrame:
    frame = pd.read_parquet(path)
    frame["ts"] = pd.to_datetime(frame["ts"], utc=True)
    frame["settlement_ts"] = pd.to_datetime(frame["settlement_ts"], utc=True)
    return frame[COLUMNS]


def seed_state(audit: Path, guard_audit: Path) -> LiteAState:
    engine = LiteA.restore(json.loads((audit / "checkpoint_baseline.json").read_bytes()))
    guard = DailyFloor.restore(json.loads((guard_audit / "checkpoint_exception.json").read_bytes()))
    return LiteAState(engine, guard, Cursors(last_committed_target=engine.last_target))


def catch_up(state: LiteAState, frame: pd.DataFrame, heads: DailyHeadStore) -> list[dict]:
    """Score every recorded opportunity after the seeded state, causally.

    Settlements are applied at their own observed availability, interleaved with
    decisions in real time order, so the daily floor sees exactly the exposure a
    live run would have seen.
    """
    start = pd.Timestamp(state.engine.last_target)
    pending = frame[frame.ts > start].sort_values("ts")
    events: list[tuple[pd.Timestamp, int, dict]] = []
    for row in pending.to_dict("records"):
        events.append((row["ts"] + pd.Timedelta(seconds=5), 0, row))
        if pd.notna(row["settlement_ts"]) and row["label"] in (-1.0, 1.0):
            events.append((row["settlement_ts"], 1, row))
    events.sort(key=lambda e: (e[0], e[1]))

    clock = pd.Timestamp(state.engine.clock)
    decisions: list[dict] = []
    for moment, kind, row in events:
        clock = max(clock, moment)
        if kind == 1:
            label = int(row["label"])
            state.engine.settle(
                row["ticker"], label, available_at=row["settlement_ts"], observed_at=clock
            )
            state.guard.settle(
                row["ticker"], label, available_at=row["settlement_ts"], observed_at=clock
            )
            state.cursors.consumed_settlements.append(row["ticker"])
            continue
        try:
            head = heads.head_for(row["ts"].to_pydatetime())
        except HeadUnavailable:
            head = None
        features = {name: row[name] for name in DIRECTION_ORDER}
        engine_output = state.engine.decide(
            target=row["ts"].to_pydatetime(),
            ticker=row["ticker"],
            features=features,
            input_valid=bool(row["input_valid"]),
            head=head,
            observed_at=clock,
        )
        guard_output = state.guard.decide(
            target=row["ts"].to_pydatetime(),
            ticker=row["ticker"],
            candidate=engine_output["candidate"],
            rank=engine_output["rank"],
            observed_at=clock,
        )
        state.cursors.last_committed_target = engine_output["target"]
        decisions.append({**engine_output, "floor_reason": guard_output["reason"],
                          "floor_prediction": guard_output["prediction"],
                          "exception": guard_output["exception"]})
    return decisions


def main() -> None:
    audit = Path(sys.argv[1])          # /tmp/litea/eng
    guard_audit = Path(sys.argv[2])    # /tmp/litea/gd/lite_a_confidence_exception/output
    september = Path(sys.argv[3])
    root = Path(sys.argv[4])           # artifact root, e.g. /var/lib/litea

    frame = pd.concat(
        [historical_frame(audit, guard_audit), september_frame(september)], ignore_index=True
    )
    training = TrainingFrame(frame)
    training_path = root / "training.parquet"
    sha = training.save(training_path)
    print(
        f"training rows={training.rows} sha256={sha} "
        f"first={training.frame.ts.iloc[0]} last={training.last_target}"
    )

    heads = DailyHeadStore(root / "heads")
    seed = audit / "lite_a_engine_v1/output/head_2026-08-31_HISTORICAL_EXPIRED.json"
    if seed.exists():
        heads.save(json.loads(seed.read_bytes()))
    after = heads.latest_cutoff()
    results = run_due_fits(training, heads, after=f"{after}T00:00:00+00:00" if after else None)
    for result in results:
        print(
            f"fit {result.cutoff} fitted={result.fitted} rows={result.train_rows} "
            f"head={result.head_id} valid_until={result.valid_until_exclusive} "
            f"{result.reason or ''}"
        )
    if results:
        last = results[-1]
        state_cutoff = last.cutoff
    else:
        state_cutoff = None

    state = seed_state(audit / "lite_a_engine_v1/output", guard_audit)
    decisions = catch_up(state, training.frame, heads)
    state.cursors.last_fit_cutoff = state_cutoff
    state.cursors.last_fit_result = "FITTED" if results and results[-1].fitted else None
    state.cursors.training_sha256 = sha
    state.cursors.training_rows = training.rows
    state.cursors.training_last_target = training.last_target
    digest = state.save(root / "state.json")

    ledger = pd.DataFrame(decisions)
    ledger.to_csv(root / "september_decisions.csv", index=False)
    summary = {
        "decisions": len(decisions),
        "reasons": ledger.reason.value_counts().to_dict() if len(ledger) else {},
        "floor_reasons": ledger.floor_reason.value_counts().to_dict() if len(ledger) else {},
        "calls": int((ledger.floor_prediction != 0).sum()) if len(ledger) else 0,
        "exceptions": int(ledger.exception.sum()) if len(ledger) else 0,
        "state_sha256": digest,
        "training_sha256": sha,
        "last_target": state.engine.last_target,
        "latest_head_cutoff": heads.latest_cutoff(),
        "heads": heads.inventory(),
    }
    (root / "catchup_summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
