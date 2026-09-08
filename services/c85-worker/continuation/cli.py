"""Command line entry point for the C85 continuation rebuild.

    python -m continuation.cli status
    python -m continuation.cli advance [--stage NAME] [--end ISO]

`advance` is safe to call on every quarter-hour: stages already at the
requested end are skipped, so neither a restart nor a new boundary triggers a
full-history rebuild.
"""
from __future__ import annotations

import argparse
import json
import os

import pandas as pd

from .config import research_end
from .runner import Runner
from .stages import STAGES


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["status", "advance", "verify-live"])
    parser.add_argument("--stage")
    parser.add_argument("--end")
    parser.add_argument("--day", help="completed UTC day to verify live feed against")
    args = parser.parse_args()
    if args.end:
        os.environ["C85_RESEARCH_END"] = args.end
    end = research_end()
    runner = Runner(STAGES)
    if args.command == "verify-live":
        from .live_recovery import verify_against_archive
        from .stages import staged_producer
        builder, _ = staged_producer("binance_events", "build_multivenue", end)
        day = args.day or str((end - pd.Timedelta(days=2)).date())
        payload = {"research_end": str(end),
                   "verification": [verify_against_archive(v, day, builder, builder.RAW)
                                    for v in ("spot", "um")]}
    elif args.command == "status":
        payload = {"research_end": str(end), "stages": runner.status(end)}
    else:
        payload = {"research_end": str(end), "report": runner.advance(end, only=args.stage),
                   "stages": runner.status(end)}
    print(json.dumps(payload, indent=2, default=str))


if __name__ == "__main__":
    main()
