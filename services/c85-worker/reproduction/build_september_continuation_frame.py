"""Assemble the c85-reconstruction-r1 September continuation frame.

Runs the ORIGINAL recovered `build_long_context_features` code (no formula
change) over the verified source archives, computing every origin-sensitive
series from the FULL 2026-01-01 origin and slicing only afterwards, which is
the correction recorded in
`datasets/c85-reconstruction-r1/metric_origin_correction_2026-09/`.

Book-depth features are per-bar independent (every snapshot group is summarised
inside its own 15-minute bar), so only the September daily archives are needed
for them; price/qlib and metric features are rolling and are therefore built
from the whole 2026 series.

Environment:
    C85_LC_SOURCE   directory holding spot_1m/ futures_1m/ mark_1m/ index_1m/
                    premium_1m/ metrics/ bookDepth/ and manifest.csv
    C85_LC_BUILDER  directory holding the recovered builder modules
    C85_LC_OUT      output directory
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

SOURCE = Path(os.environ["C85_LC_SOURCE"])
BUILDER = Path(os.environ["C85_LC_BUILDER"])
OUT = Path(os.environ["C85_LC_OUT"])
OUT.mkdir(parents=True, exist_ok=True)


def load_builder():
    sys.path.insert(0, str(BUILDER))
    spec = importlib.util.spec_from_file_location(
        "build_long_context_features", BUILDER / "build_long_context_features.py")
    module = importlib.util.module_from_spec(spec)
    # Registered before execution so the book-depth ProcessPoolExecutor can
    # pickle `process_book_file` by qualified name, exactly as the original
    # `python build_long_context_features.py` invocation does.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    module.SOURCE = SOURCE  # the only substitution: where the archives live
    return module



def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    builder = load_builder()
    price = builder.build_price_features()
    print(json.dumps({"price_rows": len(price), "price_columns": len(price.columns)}), flush=True)
    book = builder.build_book_features()
    print(json.dumps({"book_rows": len(book), "book_columns": len(book.columns)}), flush=True)
    metrics = builder.build_metric_features(price.target_ts)
    print(json.dumps({"metric_rows": len(metrics)}), flush=True)

    frame = price.merge(book, on="target_ts", how="left", validate="one_to_one")
    frame = frame.merge(metrics, on="target_ts", how="left", validate="one_to_one")
    angle = 2 * np.pi * (frame.target_ts.dt.hour * 60 + frame.target_ts.dt.minute) / 1440
    frame["session_sin_external"] = np.sin(angle)
    frame["session_cos_external"] = np.cos(angle)
    dow = 2 * np.pi * frame.target_ts.dt.dayofweek / 7
    frame["dow_sin_external"] = np.sin(dow)
    frame["dow_cos_external"] = np.cos(dow)
    frame.replace([np.inf, -np.inf], np.nan, inplace=True)

    out = OUT / "september_full_origin_frame.pkl"
    frame.to_pickle(out)
    manifest = {
        "rows": int(len(frame)),
        "columns": int(len(frame.columns)),
        "start": frame.target_ts.min().isoformat(),
        "end": frame.target_ts.max().isoformat(),
        "book_rows": int(frame.book_snapshot_count.notna().sum()),
        "metric_rows": int(frame.metric_ts.notna().sum()),
        "sha256": sha256(out),
        "runtime": {
            "python": sys.version.split()[0],
            "pandas": pd.__version__,
            "numpy": np.__version__,
        },
        "source_archives": {
            dataset: sorted(p.name for p in (SOURCE / dataset).glob("*.zip"))[-3:]
            for dataset in ("spot_1m", "futures_1m", "mark_1m", "index_1m",
                            "premium_1m", "metrics", "bookDepth")
        },
        "source_counts": {
            dataset: len(list((SOURCE / dataset).glob("*.zip")))
            for dataset in ("spot_1m", "futures_1m", "mark_1m", "index_1m",
                            "premium_1m", "metrics", "bookDepth")
        },
    }
    (OUT / "september_full_origin_frame.json").write_text(json.dumps(manifest, indent=1))
    print(json.dumps(manifest, indent=1), flush=True)


if __name__ == "__main__":
    main()
