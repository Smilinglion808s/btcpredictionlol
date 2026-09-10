"""Version 1 — `lite-a-floor4-top10-r1`.

A SEPARATE model from `c85-multi-meta-r1` and from `c85-reconstruction-r1`.
It shares this worker's authentic feed adapters and signed backend, and nothing
else: no C30/C36/C37/R4/C42/C51/C54 ancestry, no LongContext, no monthly
LONG/RECENT auxiliaries, no 55-input correctness model, no T10/T45 pass-through.

Composition (locked; not tunable here):

    LiteA(mode="baseline")  ->  DailyFloor(exception_rank=0.90)

`baseline` deliberately applies NO risk gate of its own, so the daily floor is
applied exactly once, by the guard.

Execution is hard-off in both supplied modules and again at every call site in
this package.
"""

from .identity import (  # noqa: F401
    BASE_MODE,
    EXCEPTION_RANK,
    MODEL_ID,
    REFERENCE_ARTIFACTS,
)
