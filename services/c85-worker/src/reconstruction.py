"""Reconstruction identity for the C85 rebuild.

This worker no longer claims to be the archived `c85-multi-meta-r1` model.
Numerical parity with the archived long-context frame (`8618768f…`) was never
established, so everything this build produces — fits, checkpoints, prediction
logs, artifacts — is written under a SEPARATE identity:

    archived   c85-multi-meta-r1        historical ledgers, archived performance
    this build c85-reconstruction-r1    reconstructed inputs + recovered source

The two must never share a row. `c85_targets`, `c85_state_checkpoints`,
`c85_settlements` and `c85_model_versions` are all keyed on `model_version`, so
using a distinct value is what physically prevents mixing. Startup refuses to
run if the reconstruction id is set to the archived one.

Nothing here inherits the archived win rate, drawdown or parity claims. A
consumer reading a reconstruction row is told so explicitly by the stamped
`lineage` / `inherits_archived_performance` fields.
"""
from __future__ import annotations

import os
from typing import Any

ARCHIVED_MODEL_VERSION = "c85-multi-meta-r1"
DEFAULT_RECONSTRUCTION_ID = "c85-reconstruction-r1"

LINEAGE = "RECONSTRUCTION"

#: Human-readable statement stamped onto every reconstruction row.
PROVENANCE = (
    "Reconstructed C85: recovered original source executed on rebuilt inputs. "
    "NOT numerically verified against the archived c85-multi-meta-r1 ledger; "
    "archived performance does not transfer."
)


class ReconstructionIdentityError(RuntimeError):
    """The configured identity would mix reconstruction and archived rows."""


def reconstruction_id() -> str:
    value = (os.environ.get("C85_RECONSTRUCTION_ID") or DEFAULT_RECONSTRUCTION_ID).strip()
    if not value:
        raise ReconstructionIdentityError("C85_RECONSTRUCTION_ID must not be empty")
    if value == ARCHIVED_MODEL_VERSION:
        raise ReconstructionIdentityError(
            "C85_RECONSTRUCTION_ID must not equal the archived model version "
            f"'{ARCHIVED_MODEL_VERSION}': reconstruction rows would overwrite the "
            "archived ledger and inherit its performance claims."
        )
    return value


def logging_model_version() -> str:
    """The `model_version` every persisted row of this build carries."""
    return reconstruction_id()


def identity() -> dict[str, Any]:
    """The stamp attached to decisions, checkpoints and heartbeats."""
    return {
        "reconstruction_id": reconstruction_id(),
        "lineage": LINEAGE,
        "supersedes_archived": ARCHIVED_MODEL_VERSION,
        "inherits_archived_performance": False,
        "archive_parity_verified": False,
        "provenance": PROVENANCE,
    }


def artifact_namespace(kind: str = "checkpoints") -> str:
    """Private-storage prefix, namespaced so archived objects are untouched.

    Only `releases/`, `checkpoints/` and `datasets/` are accepted by the signed
    ops endpoint, so the reconstruction id becomes the second path segment.
    """
    if kind not in ("releases", "checkpoints", "datasets"):
        raise ReconstructionIdentityError(f"unsupported artifact kind {kind!r}")
    return f"{kind}/{reconstruction_id()}/"
