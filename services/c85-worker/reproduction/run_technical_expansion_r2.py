"""Run the recovered `build_technical_expansion_r2.py` producer unmodified.

Only one environmental difference is normalised: the regenerated
`long_context_features.pkl` carries microsecond-resolution datetimes under the
current pandas build, while the producer's own `pd.to_datetime(...)` calls
create nanosecond-resolution keys. pandas refuses to merge the two
resolutions (`MergeError: incompatible merge keys ... datetime64[ns, UTC] and
datetime64[us, UTC]`).

Casting the loaded pickle's datetime columns to nanoseconds changes no value,
no feature definition, no fitting schedule and no source venue - it only
restores the datetime unit the producer was originally written against.

Usage (from the reproduction workspace's external_research directory):

    python3 /dev-server/services/c85-worker/reproduction/run_technical_expansion_r2.py
"""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

import pandas as pd

_original_read_pickle = pd.read_pickle


def _to_ns(frame):
    if not isinstance(frame, pd.DataFrame):
        return frame
    for position, dtype in enumerate(frame.dtypes):
        if not str(dtype).startswith("datetime64[") or "[ns" in str(dtype):
            continue
        series = frame.iloc[:, position]
        try:
            frame.isetitem(position, series.dt.as_unit("ns"))
        except Exception:
            pass
    if isinstance(frame.index, pd.DatetimeIndex) and "[ns" not in str(frame.index.dtype):
        try:
            frame.index = frame.index.as_unit("ns")
        except Exception:
            pass
    return frame


def _patched_read_pickle(*args, **kwargs):
    return _to_ns(_original_read_pickle(*args, **kwargs))


pd.read_pickle = _patched_read_pickle

# Some intermediate frames are built from readers other than read_pickle, so the
# same unit mismatch can reappear at merge time. Aligning merge keys to
# nanoseconds is again a pure representation change - no value is altered.
_original_merge_asof = pd.merge_asof
_original_merge = pd.merge


def _patched_merge_asof(left, right, *args, **kwargs):
    return _original_merge_asof(_to_ns(left.copy()), _to_ns(right.copy()), *args, **kwargs)


def _patched_merge(left, right, *args, **kwargs):
    return _original_merge(_to_ns(left.copy()), _to_ns(right.copy()), *args, **kwargs)


pd.merge_asof = _patched_merge_asof
pd.merge = _patched_merge
pd.DataFrame.merge = lambda self, right, *a, **k: _original_merge(
    _to_ns(self.copy()), _to_ns(right.copy()) if isinstance(right, pd.DataFrame) else right, *a, **k
)

PRODUCER = Path.cwd() / "build_technical_expansion_r2.py"
if not PRODUCER.exists():
    raise SystemExit(f"run from the workspace external_research directory; {PRODUCER} not found")

sys.argv = [str(PRODUCER)]
runpy.run_path(str(PRODUCER), run_name="__main__")
