"""Locked identity for Version 1. Nothing here is a tunable."""
from __future__ import annotations

MODEL_ID = "lite-a-floor4-top10-r1"
DISPLAY_NAME = "Lite A Floor4 Top10"

#: `LiteA(mode="baseline")` applies no risk gate, so the daily floor is applied
#: exactly once — by `DailyFloor`. Any other base mode would double-apply it.
BASE_MODE = "baseline"

#: The only exception rank the supplied guard implements.
EXCEPTION_RANK = 0.90

#: Confidence gate inside the supplied engine (kept here for reporting only —
#: the engine owns the actual comparison).
BASE_THRESHOLD = 0.638
RANK_WINDOW = 768
RANK_MINIMUM = 96

#: Daily fit protocol (owned by the supplied `fit.fit_daily`).
FIT_WINDOW_ROWS = 8_640
FIT_MINIMUM_ROWS = 672

#: Settled hypothetical unit P/L, in hundredths. Research accounting only:
#: there is no bankroll and no account integration in this model.
WIN_HUNDREDTHS = 87
LOSS_HUNDREDTHS = -100
FLOOR_HUNDREDTHS = -400

#: Boise calendar day owns the floor; late settlements keep their entry day.
DISPLAY_TIMEZONE = "America/Boise"

#: Vendored source files, verified against the supplied RUN_IDENTITY manifests.
VENDORED_SHA256 = {
    "engine.py": "cf87e5c64c30a167e8f600f5b18d79b51d0390ce25280f38cf6e21ad60065226",
}

#: Durable private reference, in the authenticated `c85-artifacts` bucket.
#: Bulky; never bundled into a startup image.
ARTIFACT_BUCKET = "c85-artifacts"
REFERENCE_PREFIX = "datasets/lite-a-floor4-top10-r1/reference/"
REFERENCE_ARTIFACTS = {
    REFERENCE_PREFIX + "Lite_A_Minimal_Engine_Research_Audit.zip":
        "513ff85c82a4cf0a89a8b5473d935ea0c5eeb58aed185e996ef7e309b4331905",
    REFERENCE_PREFIX + "Lite_A_Confidence_Exception_Audit.zip":
        "63938d4184f42444cdbdc24b29ca8d178a7ee4bebd54e241c4c7a3c7bc6cca97",
}

#: Version-scoped durable keys. Nothing here overlaps a C85 key.
TRAINING_PREFIX = "datasets/lite-a-floor4-top10-r1/training/"
HEAD_PREFIX = "datasets/lite-a-floor4-top10-r1/heads/"
STATE_PREFIX = "checkpoints/lite-a-floor4-top10-r1/"


def head_key(fit_cutoff_date: str) -> str:
    return f"{HEAD_PREFIX}{fit_cutoff_date}.json"
