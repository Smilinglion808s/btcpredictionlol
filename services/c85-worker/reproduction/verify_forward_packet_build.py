"""Measured evidence: build ONE forward packet from received data only.

Runs the real collectors for a bounded interval, then assembles the most
recently ELAPSED quarter-hour boundary at a declared shadow freeze (now), so
every source is read at one instant and the T+5 lateness is reported rather
than hidden. Prints the direction matrix shape/order check, finite counts, the
validity map and the source provenance — or the exact fail-closed blockers.

    python -m reproduction.verify_forward_packet_build --seconds 70
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402

from src.experts import ExpertRegistry, LiveExpertChain  # noqa: E402
from src.feeds import FeedRegistry  # noqa: E402
from src.features import DIRECTION_ORDER  # noqa: E402
from src.orchestration import RawPacketUnavailable, TargetInputs  # noqa: E402
from src.packets import LivePacketSource  # noqa: E402

NS = 1_000_000_000


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=int, default=70)
    args = parser.parse_args()

    feeds = FeedRegistry(dict(os.environ))
    await feeds.start()
    await asyncio.sleep(args.seconds)

    registry = ExpertRegistry()
    try:
        registry.chain = LiveExpertChain()
    except Exception as exc:  # noqa: BLE001
        print(f"expert chain unavailable: {type(exc).__name__}: {exc}")

    artifacts = None
    try:
        from src.artifacts import ArtifactStore

        artifacts = ArtifactStore(Path(os.environ.get("C85_ARTIFACT_DIR", "artifacts")))
    except Exception as exc:  # noqa: BLE001
        print(f"artifact store unavailable: {type(exc).__name__}: {exc}")

    now = datetime.now(timezone.utc)
    target = now.replace(minute=(now.minute // 15) * 15, second=0, microsecond=0)
    if (now - target) < timedelta(seconds=10):
        target -= timedelta(minutes=15)
    cutoff_ns = int(target.timestamp() * NS) + 5 * NS
    freeze_ns = time.time_ns()

    source = LivePacketSource(feeds=feeds, experts=registry, artifacts=artifacts)
    report: dict[str, object] = {
        "target_open_utc": target.isoformat(),
        "cutoff_ns": cutoff_ns,
        "freeze_ns": freeze_ns,
        "late_by_seconds": round((freeze_ns - cutoff_ns) / NS, 3),
        "direction_order_length": len(DIRECTION_ORDER),
    }
    try:
        packet: TargetInputs = source.build(target, cutoff_ns, freeze_ns=freeze_ns)
    except RawPacketUnavailable as exc:
        report["built"] = False
        report["blockers"] = str(exc).split(" || ")
    else:
        names = list(packet.direction_features)
        values = np.array([packet.direction_features[n] for n in names], dtype=float)
        report.update(
            {
                "built": True,
                "direction_columns": len(names),
                "direction_order_matches_source": names == list(DIRECTION_ORDER),
                "direction_finite": int(np.isfinite(values).sum()),
                "meta_columns": len(packet.meta_features_without_aux),
                "auxiliary_columns": sorted(packet.auxiliary_outputs),
                "validity": packet.validity,
                "validity_typed": isinstance(packet.validity, dict)
                and all(isinstance(v, bool) for v in packet.validity.values()),
                "source_typed": isinstance(packet.source, dict),
                "source": {
                    k: v for k, v in packet.source.items() if k != "feed_watermarks"
                },
                "c54_prediction": packet.c54_prediction,
                "market_q1": packet.market_q1,
                "aux_fit_month": packet.aux_fit_month,
            }
        )
    report["feed_watermarks"] = feeds.watermarks(freeze_ns)
    print(json.dumps(report, indent=2, default=str))
    await feeds.stop()


if __name__ == "__main__":
    asyncio.run(main())
