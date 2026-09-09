"""Runtime environment pinning, imported before any numeric library.

Measured in this build environment: one `HistGradientBoostingClassifier` fit
with the frozen `ALL_HGB` settings on 200 rows takes 13.29 s with the default
OpenMP thread pool and 0.119 s pinned to a single thread - a 110x difference
caused by thread oversubscription on a small container, not by the model.

That matters twice:

* a scheduled refit inside a boundary would blow the compute budget outright;
* the same oversubscription inflates ordinary inference latency, which is
  measured against the T+5 publication deadline.

Pinning happens at import time because the underlying libraries read these
variables once, when they load. Importing this module after numpy/sklearn has
no effect, so it must be the first import of every entrypoint.
"""
from __future__ import annotations

import os

THREAD_VARS = (
    "OMP_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
    "VECLIB_MAXIMUM_THREADS",
)


def pin_threads(threads: int = 1) -> dict[str, str]:
    """Pin numeric thread pools. Existing explicit settings are respected."""

    applied: dict[str, str] = {}
    for name in THREAD_VARS:
        os.environ.setdefault(name, str(threads))
        applied[name] = os.environ[name]
    return applied


pin_threads()
