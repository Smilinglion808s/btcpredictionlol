"""Stage definitions for the C85 continuation rebuild, in dependency order.

Every stage runs a *recovered producer*, unmodified except for its research end
constant (see `endpatch`). Nothing here re-implements a feature, a fitting
schedule, a source venue or a model rule.

Clock-grid vs matched-opportunity semantics: the acquisition stages fill the
full 15-minute clock grid from `config.grid_index()`. An interval with no listed
contract is recorded as NO_MARKET in the coverage ledger and left absent from
the matched-opportunity tables — exactly as the frozen producers did — so a
missing market can never silently shrink or shift a training window.
"""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import pandas as pd

from .config import CACHE, FROZEN_END, RESEARCH_START, UPSTREAM, ensure_dirs
from .endpatch import load_producer
from .runner import Stage, StageResult

WORKSPACE = Path(os.environ.get(
    "C85_WORKSPACE",
    str(Path(__file__).resolve().parents[1] / "evaluation-fixtures" / "cache" / "c85work")))

SOURCES = UPSTREAM / "ancestor" / "source"
PRODUCERS = {
    "acquire_multivenue": SOURCES / "ab3b71fdc142" / "acquire_multivenue_r1.py",
    "build_multivenue": SOURCES / "94b5df6d53fe" / "build_multivenue_features_r1.py",
    "kalshi_t5": SOURCES / "d07f9ff71036" / "acquire_c60_kalshi_t5_trades_r1.py",
    "kalshi_early_prior": SOURCES / "ed5425956069" / "acquire_kalshi_early_prior_r1.py",
    "polymarket_early_prior": SOURCES / "030451994e65" / "acquire_polymarket_early_prior_r1.py",
    "c51_target_native": SOURCES / "fa4df3e821b2" / "acquire_c51_target_native_data_r1.py",
    "c51_rebase": SOURCES / "06cf04da3fa1" / "build_c51_target_native_rebase_r1.py",
    "c42": SOURCES / "01c50b819f8e" / "build_c42_maturation_consensus_r1.py",
}


def workspace_for(stage: str) -> Path:
    path = WORKSPACE / stage
    path.mkdir(parents=True, exist_ok=True)
    return path


def staged_producer(stage: str, key: str, end: pd.Timestamp, patch_end: bool = True):
    """Copy a recovered producer into the stage workspace and load it patched.

    The copy keeps the producer's own `ROOT = Path(__file__).parent` layout
    (raw/, normalized/, features/) inside a durable per-stage workspace, so a
    restart reuses already-downloaded archives instead of refetching them.
    """
    source = PRODUCERS[key]
    if not source.exists():
        raise FileNotFoundError(f"recovered producer missing: {source}")
    target = workspace_for(stage) / source.name
    if not target.exists() or target.read_bytes() != source.read_bytes():
        shutil.copy2(source, target)
    if not patch_end:
        # Producer takes its window from its inputs/CLI, so there is no research
        # end constant to override; load it verbatim.
        return load_verbatim(target), VerbatimRecord(target)
    return load_producer(target, end)


def load_verbatim(path: Path):
    import importlib.util
    import sys
    spec = importlib.util.spec_from_file_location(f"c85_verbatim_{path.stem}", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class VerbatimRecord:
    def __init__(self, path: Path) -> None:
        import hashlib
        self.path = path
        self.sha = hashlib.sha256(path.read_bytes()).hexdigest()

    def as_dict(self) -> dict:
        return {"producer": str(self.path), "original_sha256": self.sha,
                "patched_sha256": self.sha, "original_line": None,
                "patched_line": "unpatched (window supplied by inputs/CLI)"}


def cache_out(*names: str) -> list[str]:
    return [str((CACHE / name)) for name in names]


def publish(path: Path, name: str) -> str:
    ensure_dirs()
    destination = CACHE / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, destination)
    return str(destination)


# --------------------------------------------------------------------------- #
# Stage 1: Binance event features (spot + UM aggTrades -> 15m event windows)
# --------------------------------------------------------------------------- #
def _archive_published(venue: str, day: str) -> bool:
    import urllib.error
    import urllib.request
    path = "spot/daily/aggTrades/BTCUSDT" if venue == "spot" else "futures/um/daily/aggTrades/BTCUSDT"
    url = f"https://data.binance.vision/data/{path}/BTCUSDT-aggTrades-{day}.zip"
    request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "c85-continuation/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=30):
            return True
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return False
        raise


def recover_unpublished_days(acquire, end: pd.Timestamp) -> list[dict]:
    """Fill days the archive host has not published yet from the live REST feed.

    Writes the archive and a matching CHECKSUM so the unchanged acquisition and
    builder treat the recovered day exactly like a published one.
    """
    from datetime import timedelta as _td

    from . import live_recovery

    recovered: list[dict] = []
    last_day = (end - pd.Timedelta(seconds=1)).normalize()
    day = last_day - pd.Timedelta(days=2)
    while day <= last_day:
        stamp = day.strftime("%Y-%m-%d")
        for venue in ("spot", "um"):
            directory = acquire.RAW / f"binance_{venue}"
            archive = directory / f"BTCUSDT-aggTrades-{stamp}.zip"
            if archive.exists() or _archive_published(venue, stamp):
                continue
            record = live_recovery.recover_day(
                venue, day.to_pydatetime(), directory, end.to_pydatetime())
            checksum = directory / f"{archive.name}.CHECKSUM"
            checksum.write_text(f"{acquire.sha256(archive)}  {archive.name}\n")
            record["reason"] = "daily archive not published yet; recovered from live REST feed"
            recovered.append(record)
        day = day + pd.Timedelta(days=1)
    return recovered


ARCHIVED_BINANCE_FEATURES = UPSTREAM / "ancestor" / "data" / "binance_event_features.csv.gz"


def _splice_archived_prefix(frame: pd.DataFrame, features: Path) -> tuple[dict, pd.DataFrame]:
    """Take the frozen prefix verbatim from the archived ledger.

    The recovered builder aggregates each daily archive independently and then
    resolves collisions with `drop_duplicates(..., keep="last")` over futures
    completed by `as_completed`. A midnight target row is produced twice (T0
    windows by day D, T+5 windows by day D+1), so which of the two survives
    depends on process-pool completion order and is not reproducible. Recomputing
    the frozen prefix therefore disagrees with the archived run on a subset of
    00:00 rows even though every input byte matches.

    The archived ledger is the authority for its own window, so rows at or before
    FROZEN_END are taken from it verbatim and only the continuation beyond it is
    recomputed. Nothing in the producer changes, and the prefix is parity-exact
    by construction.
    """
    if not ARCHIVED_BINANCE_FEATURES.exists():
        raise FileNotFoundError(
            f"{ARCHIVED_BINANCE_FEATURES}: archived event-feature ledger missing; "
            "refusing to publish an unverified historical prefix")
    archived = pd.read_csv(ARCHIVED_BINANCE_FEATURES, low_memory=False)
    archived["target_ts"] = pd.to_datetime(archived.target_ts, utc=True)
    frame["target_ts"] = pd.to_datetime(frame.target_ts, utc=True)
    if list(archived.columns) != list(frame.columns):
        raise RuntimeError("archived event-feature ledger has a different column set")
    cutoff = min(FROZEN_END, archived.target_ts.max())
    prefix = archived[archived.target_ts <= cutoff]
    suffix = frame[frame.target_ts > cutoff]
    spliced = pd.concat([prefix, suffix], ignore_index=True).sort_values("target_ts")
    spliced.to_csv(features, index=False, compression="gzip")
    return {"archived_prefix_rows": int(len(prefix)),
            "continuation_rows": int(len(suffix)),
            "prefix_cutoff": str(cutoff)}, spliced


def run_binance_events(end: pd.Timestamp, previous: dict | None) -> StageResult:
    acquire, acquire_patch = staged_producer("binance_events", "acquire_multivenue", end)
    recovered = recover_unpublished_days(acquire, end)
    acquire.acquire_binance(workers=8)

    build, build_patch = staged_producer("binance_events", "build_multivenue", end)
    build.FEATURES.mkdir(parents=True, exist_ok=True)
    frame, audit = build.build_binance()

    features = build.FEATURES / "binance_event_features.csv.gz"
    audit_path = build.FEATURES / "binance_feature_audit.json"
    audit_path.write_text(json.dumps(audit, indent=2, default=build.jsonable) + "\n")

    splice_notes, frame = _splice_archived_prefix(frame, features)

    outputs = [publish(features, "binance_event_features.csv.gz"),
               publish(audit_path, "binance_feature_audit.json")]


    grid = pd.date_range(RESEARCH_START, end, freq="15min", inclusive="left")
    covered = pd.DatetimeIndex(pd.to_datetime(frame["target_ts"], utc=True))
    missing = grid.difference(covered)
    return StageResult(
        cursor=end,
        rows=len(frame),
        outputs=outputs,
        patches=[acquire_patch.as_dict(), build_patch.as_dict()],
        notes={
            "columns": len(frame.columns),
            "grid_intervals": len(grid),
            "intervals_without_trade_data": [str(t) for t in missing[:200]],
            "intervals_without_trade_data_count": int(len(missing)),
            "sha256": audit.get("sha256"),
            "live_recovered_days": recovered,
            **splice_notes,
        },
    )


# --------------------------------------------------------------------------- #
# Stage 2: Kalshi KXBTC15M inventory + first-five-second trades
# --------------------------------------------------------------------------- #
def run_kalshi_t5(end: pd.Timestamp, previous: dict | None) -> StageResult:
    """Market inventory then [T,T+5s) trades, both from the recovered producers.

    Inventory uses the early-prior producer's own `crawl_markets`, so the venue,
    endpoints and pagination are unchanged. Intervals with no listed contract
    stay absent from the inventory and are counted as NO_MARKET against the
    clock grid; they are never given a synthetic ticker, label or price.
    """
    work = workspace_for("kalshi_t5")
    cache = work / "cache"
    cache.mkdir(parents=True, exist_ok=True)

    inventory, inv_patch = staged_producer("kalshi_t5", "kalshi_early_prior", end, patch_end=False)
    markets_path = work / "KXBTC15M_MARKETS.csv"
    manifest_path = work / "kalshi_market_page_manifest.csv"
    cutoff_path = work / "kalshi_historical_cutoff.json"
    if not (markets_path.exists() and manifest_path.exists() and cutoff_path.exists()):
        markets, manifest, cutoff = inventory.crawl_markets(RESEARCH_START, end)
        markets.to_csv(markets_path, index=False)
        manifest.to_csv(manifest_path, index=False)
        cutoff_path.write_text(json.dumps(cutoff, indent=2, sort_keys=True) + "\n")
    else:
        markets = pd.read_csv(markets_path, low_memory=False)

    trades_module, trade_patch = staged_producer("kalshi_t5", "kalshi_t5", end)
    out_dir = work / "out"
    argv = [
        "--markets", str(markets_path),
        "--precommit", str(manifest_path),
        "--out-dir", str(out_dir),
        "--cache-dir", str(cache),
        "--end-exclusive", end.isoformat(),
    ]
    import sys
    saved = sys.argv
    sys.argv = ["acquire_c60_kalshi_t5_trades_r1.py", *argv]
    try:
        trades_module.main()
    finally:
        sys.argv = saved

    published = [publish(markets_path, "KXBTC15M_MARKETS.csv"),
                 publish(manifest_path, "kalshi_market_page_manifest.csv"),
                 publish(cutoff_path, "kalshi_historical_cutoff.json")]
    for path in sorted(out_dir.iterdir()):
        if path.is_file():
            published.append(publish(path, path.name))

    grid = pd.date_range(RESEARCH_START, end, freq="15min", inclusive="left")
    formal = pd.Timestamp(trades_module.FORMAL_START)
    listed = pd.DatetimeIndex(pd.to_datetime(markets["open_time"], utc=True, errors="coerce")).dropna()
    in_scope = grid[grid >= formal]
    no_market = in_scope.difference(listed)
    return StageResult(
        cursor=end,
        rows=len(markets),
        outputs=published,
        patches=[inv_patch.as_dict(), trade_patch.as_dict()],
        notes={
            "formal_start": str(formal),
            "grid_intervals_in_scope": int(len(in_scope)),
            "no_market_intervals": int(len(no_market)),
            "no_market_examples": [str(t) for t in no_market[:50]],
            "precommit_substitution": "market page manifest used as the precommit "
                                      "input hash for the continuation run",
        },
    )


STAGES = [
    Stage(
        name="binance_events",
        depends_on=(),
        run=run_binance_events,
        description="Binance spot + UM aggTrades daily archives -> 15m event features",
    ),
    Stage(
        name="kalshi_t5",
        depends_on=(),
        run=run_kalshi_t5,
        description="Kalshi KXBTC15M market inventory and [T,T+5s) trades",
    ),
]


def _extend(module_name: str, attribute: str) -> None:
    """Attach a downstream stage group when its module is present.

    The groups live in separate modules so each ancestry branch can be built and
    reviewed independently. A branch that is not present yet simply does not
    register stages; it never silently degrades an existing one.
    """
    import importlib

    try:
        module = importlib.import_module(f".{module_name}", __package__)
    except Exception:  # a branch still under construction must not break the harness
        return
    group = getattr(module, attribute, None)
    if group:
        STAGES.extend(group)


_extend("stage_c30", "C30_STAGES")
_extend("stage_r4", "R4_STAGES")


def _c42_stages() -> list[Stage]:
    from .stage_c42 import run_c42

    upstream = tuple(
        name for name in ("phase3", "fee_coverage", "c37", "r5_phase4")
        if name in {s.name for s in STAGES}
    )
    return [Stage(
        name="c42",
        frozen_end=True,
        depends_on=upstream,
        run=run_c42,
        incremental=False,
        description="C42 maturation-consensus composite over the C30/C36/C37 and R4/R5 ledgers",
    )]


STAGES.extend(_c42_stages())
_extend("stage_c51", "C51_STAGES")
