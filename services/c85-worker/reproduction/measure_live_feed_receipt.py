"""Measured evidence: are the live collectors actually receiving events?

Runs the real `FeedRegistry` collectors for a bounded number of seconds, then
freezes them at a synthetic boundary cutoff and reports, per feed, the received
event count, the last event/receipt instants and the packet-source blockers.

This measures RECEIPT, not model output. It cannot and does not claim that a
forward prediction was computed; `LivePacketSource.build` still fails closed on
the unported producers, and that failure text is printed verbatim.

    python -m reproduction.measure_live_feed_receipt --seconds 30
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

from src.feeds import FeedRegistry  # noqa: E402
from src.orchestration import RawPacketUnavailable  # noqa: E402
from src.packets import LivePacketSource  # noqa: E402

NS = 1_000_000_000


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=int, default=30)
    args = parser.parse_args()

    feeds = FeedRegistry(dict(os.environ))
    await feeds.start()
    await asyncio.sleep(args.seconds)

    at_ns = time.time_ns()
    now = datetime.now(timezone.utc)
    # Use the most recently ELAPSED quarter-hour so the whole window is real.
    target = now.replace(minute=(now.minute // 15) * 15, second=0, microsecond=0)
    if (now - target) < timedelta(seconds=5):
        target -= timedelta(minutes=15)
    cutoff_ns = int(target.timestamp() * NS) + 5 * NS

    source = LivePacketSource(feeds=feeds, experts=type("E", (), {"chain": None, "status": staticmethod(lambda: {"blocking_reasons": []})})())
    try:
        source.build(target, cutoff_ns)
        packet_error = None
    except RawPacketUnavailable as exc:
        packet_error = str(exc)

    report = {
        "measured_at_utc": datetime.now(timezone.utc).isoformat(),
        "collector_seconds": args.seconds,
        "target_open_utc": target.isoformat(),
        "received_events": {
            name: {
                "buffered": len(buf.trades),
                "in_window_to_cutoff": len(
                    buf.slice(int(target.timestamp() * NS) - 15 * 60 * NS, cutoff_ns, cutoff_ns)
                ),
                **buf.freshness(at_ns),
            }
            for name, buf in feeds.buffers.items()
        },
        "packet_blocker": packet_error,
        "note": "receipt measurement only; no forward model output was produced",
    }
    print(json.dumps(report, indent=2))
    await feeds.stop()


if __name__ == "__main__":
    asyncio.run(main())
