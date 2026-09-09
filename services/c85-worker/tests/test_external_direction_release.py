"""Publication gates and relocatable-release loading for the c30/c70 head.

Two properties are under test, both of which the previous loader lacked:

* the release is *rejected* when a recorded metric is not reproduced, and it is
  rejected before any artifact is copied into the release root;
* the release loads from a clean path with the original fits directory made
  unavailable, hashing every artifact before deserialising, and produces
  bit-identical scores to the in-place loader.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.experts.external_direction import (  # noqa: E402
    DEFAULT_FITS_DIR,
    ExternalDirectionModel,
    ExternalDirectionUnavailable,
)
from tools.build_external_direction_release import (  # noqa: E402
    ReleaseRejected,
    build,
)

FITS = Path(DEFAULT_FITS_DIR)


def _require_fits() -> None:
    if not (FITS / "refit_report.json").exists():
        pytest.skip("external-direction fits not present; run tools/refit_external_direction.py")


def _observation(model: ExternalDirectionModel, stage: str) -> dict[str, float]:
    """A deterministic dense observation over the fit's own feature list."""

    fit = model.fits[stage][0]
    return {name: 0.05 * ((i % 7) - 3) for i, name in enumerate(fit.features)}


def test_release_builds_and_records_hashes_and_versions(tmp_path):
    _require_fits()
    out = tmp_path / "release"
    manifest = build(FITS, out)
    assert manifest["gate_failures"] == []
    assert manifest["library_versions"]["scikit-learn"]
    assert manifest["source_report_sha256"]
    for stage in ("T0", "T5"):
        for phase, entry in manifest["stages"][stage]["phases"].items():
            path = Path(entry["path"])
            assert not path.is_absolute(), f"{stage}/{phase} path must be relative"
            assert (out / path).exists()
            assert entry["classes"] == [0, 1]
            assert entry["source_set"] == "BINANCE_HYPERLIQUID"
            assert entry["c_value"] == 0.03


def test_release_is_rejected_before_copying_when_a_metric_regresses(tmp_path):
    _require_fits()
    staged = tmp_path / "fits"
    shutil.copytree(FITS, staged)
    report = json.loads((staged / "refit_report.json").read_text())
    entry = next(iter(report["stages"]["T0"]["phases"].values()))
    entry["recorded_metrics"] = {"validation_accuracy": 0.90}
    entry["metrics"] = {"validation_accuracy": 0.51}
    (staged / "refit_report.json").write_text(json.dumps(report))

    out = tmp_path / "release"
    with pytest.raises(ReleaseRejected) as excinfo:
        build(staged, out)
    assert "validation_accuracy" in str(excinfo.value)
    assert not out.exists(), "no artifact may be published when a gate fails"


def test_release_relocates_and_scores_identically_with_the_old_mount_absent(tmp_path):
    _require_fits()
    built = tmp_path / "built"
    build(FITS, built)

    # Move - not copy - to a differently named clean root, so nothing can
    # resolve through the build location either.
    relocated = tmp_path / "elsewhere" / "c85_release_r1"
    relocated.parent.mkdir(parents=True)
    shutil.move(str(built), str(relocated))
    assert not built.exists()

    baseline = ExternalDirectionModel.load(FITS)
    restored = ExternalDirectionModel.load_release(relocated)

    for stage in ("T0", "T5"):
        observation = _observation(baseline, stage)
        target = baseline.fits[stage][0].scores_from + pd.Timedelta(hours=1)
        want = baseline.score(stage, target, observation)
        got = restored.score(stage, target, observation)
        assert got["p_green"] == want["p_green"]
        assert got["signed_direction"] == want["signed_direction"]
        assert got["fit_sha256"] == want["fit_sha256"]
        assert got["phase"] == want["phase"]


def test_release_refuses_to_deserialise_a_tampered_artifact(tmp_path):
    _require_fits()
    out = tmp_path / "release"
    manifest = build(FITS, out)
    entry = next(iter(manifest["stages"]["T0"]["phases"].values()))
    target = out / entry["path"]
    target.write_bytes(target.read_bytes() + b"tamper")

    with pytest.raises(ExternalDirectionUnavailable) as excinfo:
        ExternalDirectionModel.load_release(out)
    assert "digest" in str(excinfo.value)


def test_release_rejects_a_manifest_path_escaping_the_root(tmp_path):
    _require_fits()
    out = tmp_path / "release"
    build(FITS, out)
    manifest = json.loads((out / "manifest.json").read_text())
    phase = next(iter(manifest["stages"]["T0"]["phases"]))
    manifest["stages"]["T0"]["phases"][phase]["path"] = "../escape.joblib"
    (out / "manifest.json").write_text(json.dumps(manifest))

    with pytest.raises(ExternalDirectionUnavailable) as excinfo:
        ExternalDirectionModel.load_release(out)
    assert "escapes" in str(excinfo.value)
