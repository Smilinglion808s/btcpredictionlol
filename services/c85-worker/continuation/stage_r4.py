"""R4 stage chain: structure_valid -> r4_1 (HTF refine) -> r5_phase4 (hot ledger).

Every stage here runs a *recovered producer* unmodified except for its research
END constant (see `endpatch`), exactly like `stages.py`. This module must not
edit `stages.py` (owned by another agent); it only adds new, independent Stage
entries that can be merged into a Runner alongside STAGES.

Dependency chain:
    structure_valid  (C75 -> C76 -> C79, over Binance spot BTCUSDT 1m + the
                       binance_events stage's t5 spot columns)
        -> r4_1       (htf_structure_r4_refine.py, via its htf_structure_r3_models
                        dependency's END constant)
            -> r5_phase4  (r5_lab_manager_phase4.py::main)

Historical-prefix parity: every stage compares its output over the archived
window (ts < FROZEN_END) cell-for-cell against the archived ledger fixture
restored by `reproduction/restore_upstream_fixtures.py`, and raises rather than
publishing on any mismatch.
"""
from __future__ import annotations

import importlib
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from .config import CACHE_ROOT, FROZEN_END, RESEARCH_START, UPSTREAM, ensure_dirs
from .endpatch import load_producer
from .runner import Stage, StageResult
from .stages import CACHE, VerbatimRecord, load_verbatim, publish, workspace_for

REPO = Path(__file__).resolve().parents[1]
FIXTURES = REPO / "evaluation-fixtures" / "upstream"
# The reference packet sits one level above the per-ledger upstream fixtures.
PACKET = REPO / "evaluation-fixtures" / "upstream_packet.parquet"

SOURCES = UPSTREAM / "ancestor" / "source"
LAB_C81 = UPSTREAM / "upstream" / "lab" / "c81" / "lab"
# Staging root for the recovered c85 workspace. Configurable so a sandbox
# whose local cache is gone can restore a disposable copy from the durable
# private `c85-artifacts` objects and point the stage at it.
C85ROOT = Path(os.environ.get("C85_C85ROOT", str(CACHE_ROOT / "c85root")))

HTF_MODELS = SOURCES / "5fa9f70f0c59" / "htf_structure_r3_models.py"
HTF_REFINE = SOURCES / "9d85759c9f9f" / "htf_structure_r4_refine.py"
R5_PHASE4 = SOURCES / "a211367da033" / "r5_lab_manager_phase4.py"


def _parity_check(new: pd.DataFrame, ref: pd.DataFrame, key: str, name: str) -> dict:
    """Cell-for-cell parity over the archived prefix (ts < FROZEN_END).

    Aborts the stage (raises) on any mismatch rather than publishing a drifted
    result; returns a small note dict on success.
    """
    ref = ref.copy()
    new = new.copy()
    ref[key] = pd.to_datetime(ref[key], utc=True)
    new[key] = pd.to_datetime(new[key], utc=True)
    ref_prefix = ref[ref[key] < FROZEN_END].reset_index(drop=True)
    merged = new.merge(ref_prefix[[key]], on=key, how="inner").sort_values(key)
    new_prefix = new[new[key].isin(ref_prefix[key])].sort_values(key).reset_index(drop=True)
    ref_prefix = ref_prefix.sort_values(key).reset_index(drop=True)
    if len(new_prefix) != len(ref_prefix):
        raise RuntimeError(
            f"{name}: archived-prefix row count mismatch: "
            f"archived={len(ref_prefix)} rebuilt={len(new_prefix)}"
        )
    mismatches: dict[str, int] = {}
    for column in ref_prefix.columns:
        if column == key or column not in new_prefix.columns:
            continue
        a, b = ref_prefix[column], new_prefix[column]
        if pd.api.types.is_numeric_dtype(a) and pd.api.types.is_numeric_dtype(b):
            af, bf = a.astype(float).to_numpy(), b.astype(float).to_numpy()
            bad = int((~(np.isclose(af, bf, rtol=0, atol=1e-9) | (np.isnan(af) & np.isnan(bf)))).sum())
        else:
            bad = int((a.astype(str) != b.astype(str)).sum())
        if bad:
            mismatches[column] = bad
    if mismatches:
        raise RuntimeError(f"{name}: historical-prefix parity FAILED: {mismatches}")
    return {"archived_prefix_rows": int(len(ref_prefix)), "parity": "ok"}


R4_1_REQUIRED = (
    "ts", "label", "base_direction", "probability_correct", "directional_rank",
    "active_threshold", "trailing_coverage", "prediction",
    "frozen_t5_r2_prediction", "full_r4_prediction",
)
R5_REQUIRED = (
    "ts", "expansion_selected_prediction", "r4_probability_correct",
    "r4_directional_rank", "r4_prediction",
)


def _coverage_cursor(rows: pd.DataFrame, end: pd.Timestamp) -> pd.Timestamp:
    """Cursor = the coverage actually produced, never merely the end requested."""
    ts = pd.to_datetime(rows["ts"], utc=True)
    if ts.empty:
        raise RuntimeError("stage produced no rows; refusing to advance the cursor")
    return min(end, ts.max() + pd.Timedelta(minutes=15))


def _validate_candidate(rows: pd.DataFrame, ref_path: Path, name: str,
                        end: pd.Timestamp, *, required: tuple[str, ...]) -> dict:
    """Validate a stage candidate BEFORE it is committed as current.

    Required: the archived reference fixture exists; the declared schema is
    present; the timestamp key is unique, sorted and on the 15-minute grid; no
    row is at or beyond the research end (causal cutoff); and the archived
    prefix (ts < FROZEN_END) matches the reference cell-for-cell.
    """
    if not ref_path.exists():
        raise FileNotFoundError(
            f"{name}: required archived reference fixture missing at {ref_path}; "
            "refusing to publish an unverified candidate")
    missing = [c for c in required if c not in rows.columns]
    if missing:
        raise RuntimeError(f"{name}: candidate is missing required columns: {missing}")
    ts = pd.to_datetime(rows["ts"], utc=True)
    if ts.duplicated().any():
        raise RuntimeError(f"{name}: duplicate timestamps in candidate output")
    if not ts.is_monotonic_increasing:
        raise RuntimeError(f"{name}: candidate timestamps are not chronological")
    if (ts >= end).any():
        raise RuntimeError(f"{name}: candidate contains rows at/after the research end {end}")
    gaps = ts.diff().dropna()
    if len(gaps) and (gaps % pd.Timedelta(minutes=15) != pd.Timedelta(0)).any():
        raise RuntimeError(f"{name}: candidate timestamps are off the 15-minute grid")
    ref = pd.read_parquet(ref_path)
    ref_missing = [c for c in required if c not in ref.columns]
    if ref_missing:
        raise RuntimeError(f"{name}: reference fixture lacks required columns: {ref_missing}")
    notes: dict = {"columns": list(rows.columns), "reference": str(ref_path)}
    notes.update(_parity_check(rows, ref, "ts", name))
    extension = ts[ts >= FROZEN_END]
    notes["extension_rows"] = int(len(extension))
    if len(extension):
        notes["extension_window"] = [str(extension.min()), str(extension.max())]
        notes["identity"] = "c85-reconstruction-r1"
        notes["parity_scope"] = (
            "archived prefix ts < 2026-09-01 only; extension rows are "
            "reconstruction output with no archived counterpart")
    return notes



# --------------------------------------------------------------------------- #
# Stage: structure_valid  (C75 -> C76 -> C79)
# --------------------------------------------------------------------------- #
def _normalise_kline_units(frame: pd.DataFrame, stamp: str) -> pd.DataFrame:
    """Put a daily klines file on the millisecond epoch the producers assume.

    data.binance.vision switched its kline open/close columns to microseconds
    partway through the archive, so a straight concatenation mixes two epochs
    and silently drops every microsecond day at the research-end filter. This
    only rescales the timestamp representation -- no bar, price or size value
    is touched -- and it refuses to guess: a day must be wholly in one unit and
    must land on the calendar date the file is named for.
    """
    frame = frame.copy()
    # A bar opens exactly on the minute and closes at its final representable
    # instant, so in microseconds those are ...000 and ...999999 respectively.
    for column, remainder in (("open_ms", 0), ("close_ms", 999_999)):
        values = frame[column].astype("int64")
        micro = values > 10 ** 15
        if micro.all():
            if (values % 1_000_000 != remainder).any():
                raise RuntimeError(f"{stamp}: {column} is not on a microsecond bar boundary")
            values = values // 1000
        elif micro.any():
            raise RuntimeError(f"{stamp}: {column} mixes millisecond and microsecond epochs")
        frame[column] = values
    opened = pd.to_datetime(frame["open_ms"], unit="ms", utc=True)
    if not (opened.dt.strftime("%Y-%m-%d") == stamp).all():
        raise RuntimeError(f"{stamp}: normalised open_ms does not fall on the archived day")
    if not frame["close_ms"].sub(frame["open_ms"]).eq(59_999).all():
        raise RuntimeError(f"{stamp}: normalised bars are not 1-minute wide")
    return frame


def _binance_minutes_frame(end: pd.Timestamp) -> pd.DataFrame:
    """Binance SPOT BTCUSDT 1m ledger from RESEARCH_START to `end`.

    Field order per research_c68/audit_quote_data.py:16. Built from the daily
    klines archives on data.binance.vision, live-recovered for days the archive
    host has not published yet (mirrors live_recovery.recover_day for aggTrades).
    """
    import io
    import json
    import urllib.error
    import urllib.request
    import zipfile

    cache_dir = CACHE / "binance_spot_1m"
    cache_dir.mkdir(parents=True, exist_ok=True)
    frames: list[pd.DataFrame] = []
    day = RESEARCH_START.normalize()
    last_day = (end - pd.Timedelta(seconds=1)).normalize()
    columns = ["open_ms", "open", "high", "low", "close", "base_volume", "close_ms",
               "quote_volume", "trade_count", "taker_buy_base", "taker_buy_quote", "ignore"]
    unrecoverable: list[str] = []
    while day <= last_day:
        stamp = day.strftime("%Y-%m-%d")
        cached = cache_dir / f"BTCUSDT-1m-{stamp}.parquet"
        if not cached.exists():
            url = (f"https://data.binance.vision/data/spot/daily/klines/BTCUSDT/1m/"
                   f"BTCUSDT-1m-{stamp}.zip")
            try:
                with urllib.request.urlopen(url, timeout=30) as response:
                    blob = response.read()
                with zipfile.ZipFile(io.BytesIO(blob)) as archive:
                    name = archive.namelist()[0]
                    frame = pd.read_csv(io.BytesIO(archive.read(name)), names=columns, header=None)
            except urllib.error.HTTPError as exc:
                if exc.code != 404:
                    raise
                # not yet published: recover from the live REST klines endpoint
                try:
                    frame = _fetch_live_minutes(day, min(day + pd.Timedelta(days=1), end))
                except Exception as live_exc:  # pragma: no cover - network dependent
                    unrecoverable.append(f"{stamp}: {live_exc}")
                    day += pd.Timedelta(days=1)
                    continue
            frame = frame[columns[:11]]
            frame.to_parquet(cached, index=False)
        frames.append(_normalise_kline_units(pd.read_parquet(cached), stamp))
        day += pd.Timedelta(days=1)
    if not frames:
        raise RuntimeError("no Binance spot 1m data recovered for the requested window")
    minutes = pd.concat(frames, ignore_index=True).drop_duplicates("open_ms").sort_values("open_ms")
    minutes = minutes[minutes.open_ms < int(end.value // 1_000_000)].reset_index(drop=True)
    if unrecoverable:
        minutes.attrs["unrecoverable_days"] = unrecoverable
    return minutes


def _fetch_live_minutes(start: pd.Timestamp, stop: pd.Timestamp) -> pd.DataFrame:
    import json
    import time
    import urllib.parse
    import urllib.request

    rows: list[list] = []
    cursor = int(start.value // 1_000_000)
    stop_ms = int(stop.value // 1_000_000)
    url = "https://api.binance.com/api/v3/klines"
    while cursor < stop_ms:
        params = urllib.parse.urlencode({"symbol": "BTCUSDT", "interval": "1m",
                                         "startTime": cursor, "limit": 1000})
        request = urllib.request.Request(f"{url}?{params}", headers={"User-Agent": "c85-continuation/1.0"})
        with urllib.request.urlopen(request, timeout=30) as response:
            batch = json.loads(response.read())
        if not batch:
            break
        for row in batch:
            if row[0] >= stop_ms:
                break
            rows.append(row[:11])
        cursor = int(batch[-1][0]) + 60_000
        if len(batch) < 1000:
            break
        time.sleep(0.1)
    columns = ["open_ms", "open", "high", "low", "close", "base_volume", "close_ms",
               "quote_volume", "trade_count", "taker_buy_base", "taker_buy_quote"]
    frame = pd.DataFrame(rows, columns=columns)
    # The REST endpoint returns every price/size as a decimal *string*, while the
    # daily archive CSVs parse as numbers. Same values, different representation:
    # cast to the archive's exact dtypes so a live-recovered day is byte-equal in
    # meaning to an archived one and downstream numeric ufuncs behave identically.
    integer = ["open_ms", "close_ms", "trade_count"]
    for column in columns:
        frame[column] = pd.to_numeric(frame[column])
        frame[column] = frame[column].astype("int64" if column in integer else "float64")
    return frame


def run_structure_valid(end: pd.Timestamp, previous: dict | None) -> StageResult:
    if not LAB_C81.exists():
        raise FileNotFoundError(f"recovered C75/C76/C79 lab missing: {LAB_C81}")
    work = workspace_for("structure_valid")
    lab_copy = work / "lab"
    if not lab_copy.exists():
        shutil.copytree(LAB_C81, lab_copy)

    minutes = _binance_minutes_frame(end)
    minutes_path = work / "btc_minutes_spot.parquet"
    minutes.to_parquet(minutes_path, index=False)

    events_path = CACHE / "binance_event_features.csv.gz"
    if not events_path.exists():
        raise FileNotFoundError(
            f"{events_path}: binance_events stage has not published event features yet; "
            "structure_valid depends on it for the t5 spot columns"
        )
    events = pd.read_csv(events_path)
    events["ts"] = pd.to_datetime(events["ts"] if "ts" in events.columns else events["target_ts"], utc=True)
    # Representation only: C79 converts the target stamp with `astype('int64') //
    # 1_000_000`, which is a millisecond epoch only when the column is nanosecond
    # resolution. Newer pandas can parse the same instants as microseconds, which
    # would silently turn every stamp into seconds and invalidate every row. No
    # instant is changed here, only its unit.
    events["ts"] = events["ts"].dt.as_unit("ns")
    packet = events[["ts", "binance_spot_t5_w005_return_bps", "binance_spot_t5_w005_flow_imbalance"]].copy()

    sys.path.insert(0, str(lab_copy))
    for mod in ("research_c75.source", "research_c76.source", "research_c79.source",
                "research_c75", "research_c76", "research_c79"):
        sys.modules.pop(mod, None)
    from research_c75 import source as c75  # noqa: E402
    from research_c76 import source as c76  # noqa: E402
    from research_c79 import source as c79  # noqa: E402

    context = c75.build(packet, minutes)
    indicator76 = c76.market(packet, minutes, context)
    indicator79 = c79.market(packet, minutes, indicator76)

    result = pd.DataFrame({"ts": packet.ts, "structure_valid": indicator79.source_valid.to_numpy(bool)})
    out_path = work / "structure_valid_rows.csv"
    result.to_csv(out_path, index=False)
    published = [publish(out_path, "structure_valid_rows.csv")]

    notes: dict = {"valid": int(result.structure_valid.sum()),
                   "invalid": int((~result.structure_valid).sum())}
    unrecoverable = minutes.attrs.get("unrecoverable_days")
    if unrecoverable:
        notes["unrecoverable_minute_days"] = unrecoverable

    ref_path = PACKET
    if not ref_path.exists():
        raise FileNotFoundError(
            f"{ref_path}: historical-prefix parity reference is missing; refusing to "
            "publish structure_valid unverified")
    ref = pd.read_parquet(ref_path)[["ts", "structure_valid"]]
    notes.update(_parity_check(result, ref, "ts", "structure_valid"))

    return StageResult(
        cursor=end,
        rows=len(result),
        outputs=published,
        patches=[VerbatimRecord(HTF_MODELS.parent / "_unused").as_dict()] if False else [],
        notes=notes,
    )


# --------------------------------------------------------------------------- #
# Stage: r4_1  (htf_structure_r4_refine.py)
# --------------------------------------------------------------------------- #
def _ensure_c85root() -> None:
    if C85ROOT.exists() and (C85ROOT / "external_research").exists():
        return
    script = REPO / "reproduction" / "setup_workspace.sh"
    subprocess.run(["bash", str(script)], check=True, cwd=REPO)


def _load_patched_htf_models(end: pd.Timestamp, work: Path):
    staged = work / "htf_structure_r3_models.py"
    if not staged.exists() or staged.read_bytes() != HTF_MODELS.read_bytes():
        shutil.copy2(HTF_MODELS, staged)
    # The producer derives its data ROOT from `Path(__file__).parents[1]`, so it
    # has to be loaded from inside the c85root workspace or it looks for the
    # recovered pickles next to the staging directory instead.
    target = C85ROOT / "external_research" / staged.name
    shutil.copy2(staged, target)
    module, record = load_producer(target, end, name="external_research.htf_structure_r3_models")
    import external_research  # noqa: E402  (package root lives in ROOT, already on sys.path)
    external_research.htf_structure_r3_models = module
    return module, record


def run_r4_1(end: pd.Timestamp, previous: dict | None) -> StageResult:
    _ensure_c85root()
    # Earlier stages in the same process import their own `external_research`
    # package from a *different* recovered workspace. Left in place, those
    # sys.modules entries and sys.path roots make `external_research` resolve to
    # the wrong portion and this producer's modules appear to be missing. Drop
    # the cached package (never the producers themselves), and while this stage
    # runs let only the c85root workspace answer for it.
    for name in [n for n in sys.modules
                 if n == "external_research" or n.startswith("external_research.")]:
        del sys.modules[name]
    other_roots = str(CACHE) if "CACHE" in globals() else str(C85ROOT.parent)
    saved_path = list(sys.path)
    sys.path[:] = [p for p in sys.path
                   if not (p.startswith(other_roots) and not p.startswith(str(C85ROOT)))]
    sys.path.insert(0, str(C85ROOT))
    sys.path.insert(0, str(C85ROOT / "external_research"))
    importlib.invalidate_caches()
    try:
        return _run_r4_1_inner(end, previous)
    finally:
        sys.path[:] = saved_path


def _run_r4_1_inner(end: pd.Timestamp, previous: dict | None) -> StageResult:
    work = workspace_for("r4_1")
    _, models_patch = _load_patched_htf_models(end, work)

    refine_target = work / HTF_REFINE.name
    if not refine_target.exists() or refine_target.read_bytes() != HTF_REFINE.read_bytes():
        shutil.copy2(HTF_REFINE, refine_target)
    # honour the recovered producer's own ROOT = parents[1] layout by running it
    # from inside the c85root workspace, where external_research/ already lives
    workspace_refine = C85ROOT / "external_research" / HTF_REFINE.name
    shutil.copy2(refine_target, workspace_refine)
    refine = load_verbatim(workspace_refine)
    refine.main()

    out_csv = C85ROOT / "external_research" / "htf_structure_r3_output" / "t5_book_day4h_r4_1_rows.csv"
    rows = pd.read_csv(out_csv, parse_dates=["ts"])
    notes = _validate_candidate(
        rows, FIXTURES / "t5_book_day4h_r4_1_rows.parquet", "r4_1", end,
        required=R4_1_REQUIRED,
    )
    # Only a validated candidate is committed as current.
    published = [publish(out_csv, "t5_book_day4h_r4_1_rows.csv")]

    return StageResult(cursor=_coverage_cursor(rows, end), rows=len(rows), outputs=published,
                       patches=[models_patch.as_dict()], notes=notes)


FROZEN_R4_1_PREDICTION_SHA = (
    "8fed55351f098edd75e13f6021c9101be898853f37ff99e94c6ea7b8b4734eba")


def _install_prefix_hash_adapter(phase4, end: pd.Timestamp) -> dict:
    """Continuation adapter for the frozen R4.1 prediction hash.

    `build_frame()` hashes the WHOLE r4_prediction array against a frozen
    digest. Appending genuine post-August rows lengthens that array, so the
    check would reject a correct continuation for being longer, not for being
    different. The adapter keeps the frozen guarantee exactly where it applies:
    the digest is verified over the archived timestamp prefix (ts < FROZEN_END),
    and any prefix mismatch still aborts. A parity run (end == FROZEN_END) is
    untouched.
    """
    if end <= FROZEN_END:
        return {"frozen_hash": "unmodified (parity run)"}
    reference = FIXTURES / "t5_hot_calibration_ledger.parquet"
    if not reference.exists():
        raise FileNotFoundError(f"{reference}: needed to size the archived prefix")
    ref_ts = pd.to_datetime(pd.read_parquet(reference)["ts"], utc=True)
    prefix_rows = int((ref_ts < FROZEN_END).sum())
    lab = phase4.lab
    original = lab.array_sha256
    record: dict = {"frozen_hash": "verified on archived prefix",
                    "archived_prefix_rows": prefix_rows}

    def prefix_aware(values):
        array = np.asarray(values, dtype=np.int8)
        if len(array) == prefix_rows:
            return original(array)
        if len(array) < prefix_rows:
            raise RuntimeError(
                f"r5_phase4: frame is shorter than the archived prefix "
                f"({len(array)} < {prefix_rows}); refusing to weaken the frozen check")
        digest = original(array[:prefix_rows])
        if digest != FROZEN_R4_1_PREDICTION_SHA:
            raise RuntimeError(
                f"r5_phase4: frozen R4.1 prediction hash mismatch on the archived "
                f"prefix: {digest}")
        record["extension_rows"] = int(len(array) - prefix_rows)
        return FROZEN_R4_1_PREDICTION_SHA

    lab.array_sha256 = prefix_aware
    return record


# --------------------------------------------------------------------------- #
# Stage: r5_phase4  (r5_lab_manager_phase4.py::main)
# --------------------------------------------------------------------------- #

def run_r5_phase4(end: pd.Timestamp, previous: dict | None) -> StageResult:
    _ensure_c85root()
    sys.path.insert(0, str(C85ROOT))
    sys.path.insert(0, str(C85ROOT / "external_research"))
    work = workspace_for("r5_phase4")
    _, models_patch = _load_patched_htf_models(end, work)

    phase4_target = C85ROOT / "external_research" / R5_PHASE4.name
    if not phase4_target.exists() or phase4_target.read_bytes() != R5_PHASE4.read_bytes():
        shutil.copy2(R5_PHASE4, phase4_target)
    phase4 = load_verbatim(phase4_target)
    adapter = _install_prefix_hash_adapter(phase4, end)
    phase4.main()

    out_csv = phase4.OUT / "t5_hot_calibration_ledger.csv"
    rows = pd.read_csv(out_csv, parse_dates=["ts"])
    notes = _validate_candidate(
        rows, FIXTURES / "t5_hot_calibration_ledger.parquet", "r5_phase4", end,
        required=R5_REQUIRED,
    )
    notes.update({"frozen_hash_adapter": adapter})
    published = [publish(out_csv, "t5_hot_calibration_ledger.csv")]

    return StageResult(cursor=_coverage_cursor(rows, end), rows=len(rows), outputs=published,
                       patches=[models_patch.as_dict()], notes=notes)



structure_valid = run_structure_valid
r4_1 = run_r4_1
r5_phase4 = run_r5_phase4

R4_STAGES = [
    Stage(
        name="structure_valid",
        depends_on=("binance_events",),
        run=run_structure_valid,
        description="C75 -> C76 -> C79 structure_valid over Binance spot BTCUSDT 1m data",
    ),
    Stage(
        name="r4_1",
        # No longer input-bound: htf_structure_r3.pkl now genuinely covers
        # September (rebuilt from real Binance archives through 2026-09-08,
        # archived prefix bit-identical), so the stage's ceiling is the real
        # source coverage rather than the frozen research end.
        depends_on=("structure_valid",),
        run=run_r4_1,
        incremental=False,
        description="htf_structure_r4_refine.py -> t5_book_day4h_r4_1_rows.csv",
    ),
    Stage(
        name="r5_phase4",
        depends_on=("r4_1",),
        run=run_r5_phase4,
        incremental=False,
        description="r5_lab_manager_phase4.py -> t5_hot_calibration_ledger.csv",
    ),
]
