"""One entry point for the offline C85 bootstrap / refit job.

    python -m bootstrap.cli inventory                 measured file inventory
    python -m bootstrap.cli advance [--end ISO]       resumable historical rebuild
    python -m bootstrap.cli refit-status              which fits exist / are missing
    python -m bootstrap.cli build [--version V]       build the deployment bundle
    python -m bootstrap.cli publish PATH [--activate] upload + register (+ activate)

`advance` delegates to the existing resumable stage runner, so a restart never
triggers a full-history rebuild: completed stages are skipped by cursor.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(prog="bootstrap")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("inventory")

    advance = sub.add_parser("advance")
    advance.add_argument("--end")
    advance.add_argument("--stage")

    refit = sub.add_parser("refit-status")
    refit.add_argument("--as-of")

    build = sub.add_parser("build")
    build.add_argument("--version")
    build.add_argument("--state", type=Path)
    build.add_argument("--parity", type=Path)

    publish = sub.add_parser("publish")
    publish.add_argument("summary", type=Path)
    publish.add_argument("--activate", action="store_true")

    args = parser.parse_args()

    if args.command == "inventory":
        from .inventory import measure

        payload = measure()
    elif args.command == "advance":
        from continuation.config import research_end
        from continuation.runner import Runner
        from continuation.stages import STAGES

        if args.end:
            os.environ["C85_RESEARCH_END"] = args.end
        end = research_end()
        runner = Runner(STAGES)
        payload = {
            "research_end": str(end),
            "report": runner.advance(end, only=args.stage),
            "stages": runner.status(end),
        }
    elif args.command == "refit-status":
        from .refit import status

        payload = status(args.as_of)
    elif args.command == "build":
        from .build import build as build_bundle

        payload = build_bundle(args.version, state_file=args.state, parity_report=args.parity)
    else:
        from .publish import publish as publish_bundle

        payload = publish_bundle(args.summary, activate=args.activate)

    print(json.dumps(payload, indent=2, default=str))


if __name__ == "__main__":
    main()
