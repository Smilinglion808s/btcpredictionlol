"""One real signed Version 1 shadow record over the live backend.

This is a RESEARCH row, explicitly: its inputs come from the reconstructed
September frame, not from a boundary that was armed before T. It proves the
persistence path end to end — signed envelope, version-scoped identity, sealed
paired checkpoint, no outbox — and nothing about live timing.

Then it restores the state purely from the durable checkpoint and re-commits
the SAME target, to show a restart neither advances a rank nor re-opens floor
exposure nor duplicates a log row.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import timezone
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.backend import BackendClient  # noqa: E402
from src.features import DIRECTION_ORDER  # noqa: E402
from src.litea.heads import DailyHeadStore  # noqa: E402
from src.litea.identity import MODEL_ID  # noqa: E402
from src.litea.state import LiteAState  # noqa: E402
from src.litea.store import LiteAStore, checkpoint_payload, target_row  # noqa: E402


class Packet:
    """The recorded, already frozen inputs for one September target."""

    def __init__(self, row: dict) -> None:
        self.features = {name: row[name] for name in DIRECTION_ORDER}
        self.input_valid = bool(row["input_valid"])
        self.blockers = []
        self.source = {"feed_watermarks": {"origin": "RECONSTRUCTED_SEPTEMBER_FRAME"}}

    def as_engine_features(self) -> dict:
        return self.features


def main() -> None:
    root = Path(sys.argv[1])
    ops_url = os.environ["LITEA_OPS_URL"]
    backend = BackendClient(
        ops_url,
        os.environ["C85_GATEWAY_SECRET"],
        os.environ.get("WORKER_ID", "litea-shadow-check"),
        model_version=MODEL_ID,
    )
    store = LiteAStore(backend, "litea-shadow-check")
    heads = DailyHeadStore(root / "heads")

    frame = pd.read_parquet(root / "training.parquet")
    row = frame.iloc[-1].to_dict()
    target = pd.Timestamp(row["ts"]).to_pydatetime().astimezone(timezone.utc)
    state = LiteAState.load(root / "state.json")
    packet = Packet(row)

    head = heads.head_for(target)
    engine_output = state.engine.decide(
        target=target,
        ticker=row["ticker"],
        features=packet.as_engine_features(),
        input_valid=packet.input_valid,
        head=head,
        observed_at=state.engine.clock,
    )
    guard_output = state.guard.decide(
        target=target,
        ticker=row["ticker"],
        candidate=int(engine_output["candidate"]),
        rank=engine_output["rank"],
        observed_at=state.guard.clock,
    )
    record = target_row(
        target_open=target,
        ticker=row["ticker"],
        engine_output=engine_output,
        guard_output=guard_output,
        packet=packet,
        timing={"target_open_ns": int(target.timestamp() * 1_000_000_000)},
    )
    # NEVER LIVE: these inputs were reconstructed after the fact.
    record["run_mode"] = "RESEARCH"
    record["features"]["provenance"] = "RECONSTRUCTED_SEPTEMBER_FRAME"

    checkpoint = checkpoint_payload(state, next_target=None)
    first = store.commit(record, checkpoint)
    print("commit#1", json.dumps(first)[:300])

    latest = store.latest_checkpoint() or {}
    envelope = (latest.get("expert_state") or {}).get("litea_paired_envelope")
    restored = LiteAState.restore(envelope)
    print(
        "restored_from_backend sha256=",
        restored.snapshot()["sha256"],
        "== local:",
        restored.snapshot()["sha256"] == state.snapshot()["sha256"],
        "last_target=",
        restored.engine.last_target,
        "consumed=",
        len(restored.cursors.consumed_settlements),
    )

    replay_engine = restored.engine.decide(
        target=target,
        ticker=row["ticker"],
        features=packet.as_engine_features(),
        input_valid=packet.input_valid,
        head=head,
        observed_at=restored.engine.clock,
    )
    replay_guard = restored.guard.decide(
        target=target,
        ticker=row["ticker"],
        candidate=int(replay_engine["candidate"]),
        rank=replay_engine["rank"],
        observed_at=restored.guard.clock,
    )
    print(
        "replay identical:",
        replay_engine == engine_output,
        replay_guard == guard_output,
        "state unchanged:",
        restored.snapshot()["sha256"] == state.snapshot()["sha256"],
    )
    second = store.commit(record, checkpoint_payload(restored, next_target=None))
    print("commit#2", json.dumps(second)[:300])


if __name__ == "__main__":
    main()
