"""Environment compatibility shims for the recovered research producers.

Two library-version differences, neither of which changes any model
calculation:

1. pandas here parses CSV datetimes as ``datetime64[us, UTC]`` where the
   original environment produced ``datetime64[ns, UTC]``; merges raise
   ``MergeError`` on the mismatch.  We normalise merge-key resolution only.

2. scikit-learn 1.9 raises ``ValueError: window shape cannot be larger than
   input array shape`` in ``_find_binning_thresholds`` when a feature column
   has zero observed values, because ``sliding_window_view(empty, 2)`` is
   invalid.  Earlier versions computed midpoints by slicing and returned an
   empty threshold array for that case.  We restore that exact behaviour.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def _align(left, right):
    """Cast only *right*'s merge-key datetime columns to *left*'s resolution.

    Leaving the left frame untouched keeps the caller's own dtypes intact, so
    downstream identity checks such as ``frame.ts.equals(continuous.ts)``
    still behave exactly as they did in the original environment.
    """
    if not isinstance(left, pd.DataFrame) or not isinstance(right, pd.DataFrame):
        return right
    changed = None
    for column in right.columns:
        if column not in left.columns:
            continue
        want, have = left[column].dtype, right[column].dtype
        if getattr(want, "kind", None) != "M" or getattr(have, "kind", None) != "M":
            continue
        if getattr(want, "unit", "ns") == getattr(have, "unit", "ns"):
            continue
        if changed is None:
            changed = right.copy()
        changed[column] = right[column].astype(want)
    return right if changed is None else changed


_merge = pd.merge
_merge_asof = pd.merge_asof
_frame_merge = pd.DataFrame.merge

pd.merge = lambda left, right, *a, **k: _merge(left, _align(left, right), *a, **k)
pd.merge_asof = lambda left, right, *a, **k: _merge_asof(left, _align(left, right), *a, **k)
pd.DataFrame.merge = lambda self, right, *a, **k: _frame_merge(self, _align(self, right), *a, **k)

try:
    from sklearn.ensemble._hist_gradient_boosting import binning as _binning

    _original = _binning._find_binning_thresholds

    def _find_binning_thresholds(col_data, max_bins, sample_weight=None):
        finite = col_data[~np.isnan(col_data)] if col_data.dtype.kind == "f" else col_data
        if finite.size == 0 or np.unique(finite).size == 0:
            return np.asarray([])
        return _original(col_data, max_bins, sample_weight=sample_weight)

    _binning._find_binning_thresholds = _find_binning_thresholds
except Exception:  # pragma: no cover - sklearn layout changed
    pass
