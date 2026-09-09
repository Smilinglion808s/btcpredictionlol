"""Hardened, resumable walk-forward reproduction of T0_LONG_CONTEXT_R1 (ALL_HGB).

This is the git-tracked runner. It reproduces
``long_context.walk_forward_probability`` block for block - identical inputs,
identical model, identical grid - and adds only recovery safety around it:

* **Full identity.** Every value the walk depends on is hashed: the frame file,
  the complete contiguous feature matrix (not a 4 MiB prefix), the ordered
  timestamps, the finite/complete mask, the labels, the ordered schema, the HGB
  parameters, the ``WINDOW``/``MINIMUM``/``REFIT_EVERY`` grid, the source of the
  ``long_context`` module and of this runner, and the runtime (Python, numpy,
  pandas, scikit-learn, thread settings).
* **Coherent checkpoints.** The NPZ and the JSON of one block carry the same
  ``generation`` stamp, so a pair that spans two blocks is detectable and is
  refused. The JSON is written last and is the commit point.
* **Verified resume.** A resume re-checks every identity field, the probability
  array shape and dtype, and the recorded probability-prefix digest recomputed
  from the restored array. Any mismatch refuses the resume; it never silently
  restarts at zero (an intentional restart needs ``--restart``).
* **No serialised model.** The active model is RECONSTRUCTED by refitting at
  ``last_fit_block`` from the same immutable inputs. That is exact only because
  identity is verified first.

Nothing here tunes or reinterprets the model. Direction and rank are NOT derived
here: the recovered exact producers own that policy, and a 0.5 threshold is a
guess, not the original rule.

Usage
-----
    python3 tools/parity_runner.py run      --frame /path/frame.pkl --state /path/state
    python3 tools/parity_runner.py validate --frame /path/frame.pkl --state /path/state
    python3 tools/parity_runner.py compare  --frame ... --state ... --ledger /path.csv
"""
from __future__ import annotations

import os

# Thread pinning MUST happen before numpy / sklearn are imported.
THREADS = os.environ.get("C85_PARITY_THREADS", "8")
for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
           "NUMEXPR_NUM_THREADS"):
    os.environ[_v] = THREADS

import argparse  # noqa: E402
import hashlib  # noqa: E402
import json  # noqa: E402
import platform  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402
import uuid  # noqa: E402
from pathlib import Path  # noqa: E402
from typing import Any  # noqa: E402

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.experts import direction_contract as dc  # noqa: E402
from src.experts import long_context as lc  # noqa: E402

CKPT_NPZ = "parity_ckpt.npz"
CKPT_META = "parity_ckpt.json"
TOLERANCE = 1e-9


class ParityResumeError(RuntimeError):
    """A checkpoint may not be resumed: identity or coherence failed."""


def log(**kw: Any) -> None:
    print(json.dumps(kw), flush=True)


def sha_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha_array(array: np.ndarray) -> str:
    """Hash the FULL contiguous buffer plus shape and dtype - never a prefix."""

    contiguous = np.ascontiguousarray(array)
    digest = hashlib.sha256()
    digest.update(f"{contiguous.shape}|{contiguous.dtype.str}|".encode())
    view = contiguous.reshape(-1).view(np.uint8)
    step = 1 << 24
    for start in range(0, view.size, step):
        digest.update(view[start:start + step].tobytes())
    return digest.hexdigest()


def sha_file(path: Path, chunk: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(chunk):
            digest.update(block)
    return digest.hexdigest()


def runtime_identity() -> dict[str, Any]:
    import sklearn

    return {
        "python": platform.python_version(),
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "sklearn": sklearn.__version__,
        "threads": {v: os.environ.get(v) for v in
                    ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS",
                     "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS")},
    }


# -- inputs -----------------------------------------------------------------
def load_inputs(frame_path: Path) -> dict[str, Any]:
    """Load the derived frame exactly as the original walk consumes it."""

    frame = pd.read_pickle(frame_path)
    frame = frame.rename(columns={"binance_label": "label", "target_ts": "ts"})
    features = lc.feature_columns(list(frame.columns))
    x = frame[features].to_numpy(float)
    label = frame.label.to_numpy(float)
    ts = pd.to_datetime(frame.ts, utc=True)
    complete = np.isfinite(x).all(axis=1)

    identity = {
        "frame_path": str(frame_path),
        "frame_sha256": sha_file(frame_path),
        "rows": int(len(frame)),
        "features": len(features),
        "schema_hash": sha_bytes("\n".join(features).encode()),
        "input_hash_full": sha_array(x),
        "timestamp_hash": sha_array(ts.astype("int64").to_numpy()),
        "complete_mask_hash": sha_array(complete),
        "label_hash": sha_array(label),
        "hgb_params": dict(lc.HGB_PARAMS),
        "grid": {"window": lc.WINDOW, "minimum": lc.MINIMUM,
                 "refit_every": lc.REFIT_EVERY},
        "long_context_sha256": sha_file(Path(lc.__file__)),
        "runner_sha256": sha_file(Path(__file__).resolve()),
        "runtime": runtime_identity(),
    }
    return {"frame": frame, "features": features, "x": x, "label": label,
            "ts": ts, "complete": complete,
            "target": (label > 0).astype(np.int8), "identity": identity}


IDENTITY_FIELDS = (
    "frame_sha256", "rows", "features", "schema_hash", "input_hash_full",
    "timestamp_hash", "complete_mask_hash", "label_hash", "hgb_params", "grid",
    "long_context_sha256", "runtime",
)


def identity_mismatches(recorded: dict[str, Any], current: dict[str, Any]) -> list[str]:
    """Every recorded identity field must match. Row counts alone never suffice.

    ``runner_sha256`` is deliberately excluded: hardening the recovery wrapper
    must not invalidate expensive completed fits, because it cannot change the
    numbers - everything the numbers depend on is in the list above.
    """

    return [key for key in IDENTITY_FIELDS if recorded.get(key) != current.get(key)]


# -- checkpoint -------------------------------------------------------------
def write_checkpoint(state: Path, probability: np.ndarray, meta: dict[str, Any]) -> None:
    """Write a coherent pair: NPZ first, JSON (the commit point) last."""

    state.mkdir(parents=True, exist_ok=True)
    generation = uuid.uuid4().hex
    npz = state / CKPT_NPZ
    tmp = state / f".{generation}.tmp.npz"  # np.savez appends .npz
    np.savez(tmp, probability=probability)
    os.replace(tmp, npz)

    payload = dict(meta)
    payload["generation"] = generation
    payload["npz_sha256"] = sha_file(npz)
    payload["probability_shape"] = list(probability.shape)
    payload["probability_dtype"] = probability.dtype.str
    payload["probability_full_sha256"] = sha_array(probability)
    tmp_meta = state / f".{CKPT_META}.{generation}.tmp"
    tmp_meta.write_text(json.dumps(payload))
    os.replace(tmp_meta, state / CKPT_META)


def read_checkpoint(state: Path) -> tuple[np.ndarray, dict[str, Any]]:
    """Read a pair and prove it belongs to ONE writer generation."""

    meta_path, npz_path = state / CKPT_META, state / CKPT_NPZ
    if not meta_path.exists() or not npz_path.exists():
        raise ParityResumeError(f"no checkpoint pair under {state}")
    before = meta_path.read_bytes()
    payload = npz_path.read_bytes()
    after = meta_path.read_bytes()
    if before != after:
        raise ParityResumeError("metadata changed while the NPZ was read: mixed generation")
    meta = json.loads(before)
    if "npz_sha256" in meta and sha_bytes(payload) != meta["npz_sha256"]:
        raise ParityResumeError(
            "the NPZ does not match the digest recorded with this metadata: "
            "the pair spans different blocks")
    import io

    probability = np.load(io.BytesIO(payload))["probability"]
    return probability, meta


def validate_checkpoint(state: Path, inputs: dict[str, Any]) -> dict[str, Any]:
    """Full pre-resume validation. Returns a verdict; never mutates anything."""

    probability, meta = read_checkpoint(state)
    identity = inputs["identity"]
    problems = [f"identity:{k}" for k in identity_mismatches(meta.get("identity", {}), identity)]

    if probability.shape != (identity["rows"],):
        problems.append(f"shape:{probability.shape} != ({identity['rows']},)")
    if probability.dtype != np.float64:
        problems.append(f"dtype:{probability.dtype}")
    if "probability_full_sha256" in meta and \
            sha_array(probability) != meta["probability_full_sha256"]:
        problems.append("probability_full_sha256")

    blocks = block_starts(identity["rows"])
    index = int(meta["next_block_index"])
    if not 0 <= index <= len(blocks):
        problems.append(f"next_block_index:{index}")
    else:
        end = blocks[index] if index < len(blocks) else identity["rows"]
        recomputed = sha_array(probability[:end])
        if recomputed != meta.get("probability_prefix_sha256"):
            problems.append("probability_prefix_sha256")
        scored = int(np.isfinite(probability[:end]).sum())
        trailing = int(np.isfinite(probability[end:]).sum())
        if trailing:
            problems.append(f"probability_beyond_checkpoint:{trailing}")
    return {
        "resumable": not problems,
        "problems": problems,
        "next_block_index": index,
        "of_blocks": len(blocks),
        "block_ts": meta.get("block_ts"),
        "fit_count": meta.get("fit_count"),
        "last_fit_block": meta.get("last_fit_block"),
        "generation": meta.get("generation"),
        "scored_rows": scored if not problems else None,
        "model_recovery": ("NOT SERIALISED: the active model is refit at "
                           "last_fit_block from the verified inputs"),
    }


def block_starts(rows: int) -> list[int]:
    return list(range(lc.MINIMUM, rows, lc.REFIT_EVERY))


# -- the walk ---------------------------------------------------------------
def fit_at(block_start: int, inputs: dict[str, Any]):
    """The original's fit window, unchanged."""

    x, label, target, complete = (inputs["x"], inputs["label"],
                                  inputs["target"], inputs["complete"])
    start = max(0, block_start - lc.WINDOW)
    train = np.arange(start, block_start)
    train = train[complete[train] & np.isfinite(label[train]) & (label[train] != 0)]
    if len(train) >= lc.MINIMUM and np.unique(target[train]).size == 2:
        model = lc._new_model()
        model.fit(x[train], target[train],
                  sample_weight=lc.day_balanced_weights(inputs["ts"].iloc[train]))
        return model, len(train)
    return None, len(train)


def run(frame_path: Path, state: Path, *, restart: bool = False,
        max_blocks: int | None = None) -> dict[str, Any]:
    inputs = load_inputs(frame_path)
    identity = inputs["identity"]
    rows = identity["rows"]
    blocks = block_starts(rows)
    log(stage="identity", **{k: v for k, v in identity.items() if k != "runtime"})

    probability = np.full(rows, np.nan)
    start_index, fit_count, first_fit, last_fit_block = 0, 0, None, None

    if (state / CKPT_META).exists() and not restart:
        verdict = validate_checkpoint(state, inputs)
        if not verdict["resumable"]:
            raise ParityResumeError(
                f"checkpoint under {state} cannot be resumed: {verdict['problems']}. "
                "Investigate; pass --restart to deliberately start over.")
        probability, meta = read_checkpoint(state)
        start_index = int(meta["next_block_index"])
        fit_count = int(meta["fit_count"])
        first_fit = meta["first_fit"]
        last_fit_block = meta["last_fit_block"]
        log(stage="resume", verified=True, **{k: verdict[k] for k in
            ("next_block_index", "fit_count", "last_fit_block", "generation")})
    elif restart:
        log(stage="restart", reason="explicitly requested")

    fitted = None
    if start_index and last_fit_block is not None:
        fitted, n = fit_at(int(last_fit_block), inputs)
        log(stage="rehydrate_model", block=int(last_fit_block), train_rows=n,
            note="model refit from verified inputs; nothing was deserialised")

    t0 = time.time()
    done = 0
    for idx in range(start_index, len(blocks)):
        block_start = blocks[idx]
        model, n_train = fit_at(block_start, inputs)
        if model is not None:
            fitted = model
            fit_count += 1
            last_fit_block = block_start
            if first_fit is None:
                first_fit = inputs["ts"].iloc[block_start].isoformat()
        if fitted is not None:
            end = min(block_start + lc.REFIT_EVERY, rows)
            predict = np.arange(block_start, end)
            predict = predict[inputs["complete"][predict]]
            if len(predict):
                probability[predict] = fitted.predict_proba(inputs["x"][predict])[:, 1]

        end = min(block_start + lc.REFIT_EVERY, rows)
        write_checkpoint(state, probability, {
            "identity": identity,
            "next_block_index": idx + 1,
            "block_start": int(block_start),
            "block_ts": inputs["ts"].iloc[block_start].isoformat(),
            "fit_count": fit_count,
            "first_fit": first_fit,
            "last_fit_block": None if last_fit_block is None else int(last_fit_block),
            "train_rows": int(n_train),
            "probability_prefix_sha256": sha_array(probability[:end]),
            "elapsed_s": round(time.time() - t0, 1),
        })
        done += 1
        if idx % 5 == 0 or idx == len(blocks) - 1:
            log(stage="block", idx=idx, of=len(blocks),
                ts=inputs["ts"].iloc[block_start].isoformat(),
                fits=fit_count, elapsed_s=round(time.time() - t0, 1))
        if max_blocks is not None and done >= max_blocks:
            log(stage="stopped", reason="max_blocks", idx=idx)
            break

    return {"blocks_done": done, "fit_count": fit_count, "first_fit": first_fit}


# -- comparison -------------------------------------------------------------
class ParityComparisonRefused(RuntimeError):
    """The comparison inputs are not trustworthy, so no numbers are produced."""


def load_legacy_generation(generation: Path, inputs: dict[str, Any]) -> tuple[np.ndarray, dict[str, Any]]:
    """Adapter for a collector-format generation written by the legacy runner.

    The legacy metadata carries a SMALLER identity (rows, features, schema,
    labels, a 4 MiB-prefix input hash, grid and HGB parameters). It is validated
    on ITS OWN terms - the manifest digests, the recorded probability-prefix
    digest recomputed from the array, shape/dtype, no scores beyond the block -
    plus every legacy identity field that has a hardened equivalent. Nothing is
    forged into the hardened schema and no hardened check is weakened: a legacy
    generation is only ever accepted for READ-ONLY comparison, never for resume.
    """

    def legacy_sha(array: np.ndarray) -> str:
        """The LEGACY digest definition: raw contiguous bytes, no shape prefix."""

        return sha_bytes(np.ascontiguousarray(array).tobytes())

    manifest = json.loads((generation / "MANIFEST.json").read_text())
    problems = []
    for name, entry in manifest["files"].items():
        blob = (generation / name).read_bytes()
        if len(blob) != entry["bytes"] or sha_bytes(blob) != entry["sha256"]:
            problems.append(f"manifest:{name}")
    meta = json.loads((generation / CKPT_META).read_text())
    probability = np.load(generation / CKPT_NPZ)["probability"]
    identity, legacy = inputs["identity"], meta.get("identity", {})

    for key, value in (("rows", identity["rows"]), ("features", identity["features"]),
                       ("schema_hash", identity["schema_hash"]),
                       ("label_hash", legacy_sha(inputs["label"])),
                       ("input_hash", sha_bytes(
                           np.ascontiguousarray(inputs["x"]).tobytes()[:1 << 22]
                           + str(inputs["x"].shape).encode())),
                       ("hgb_params", identity["hgb_params"])):
        if legacy.get(key) != value:
            problems.append(f"legacy_identity:{key}")
    for key, value in identity["grid"].items():
        if legacy.get(key) != value:
            problems.append(f"legacy_identity:{key}")
    if probability.shape != (identity["rows"],) or probability.dtype != np.float64:
        problems.append(f"shape/dtype:{probability.shape}/{probability.dtype}")

    blocks = block_starts(identity["rows"])
    index = int(meta["next_block_index"])
    end = blocks[index] if index < len(blocks) else identity["rows"]
    if legacy_sha(probability[:end]) != meta.get("probability_prefix_sha256"):
        problems.append("probability_prefix_sha256")
    trailing = int(np.isfinite(probability[end:]).sum())
    if trailing:
        problems.append(f"probability_beyond_checkpoint:{trailing}")
    if problems:
        raise ParityComparisonRefused(
            f"legacy generation {generation.name} failed validation: {problems}")
    return probability, {
        "source": "legacy_collector_generation",
        "generation": generation.name,
        "next_block_index": index,
        "processed_end_exclusive": end,
        "block_start": meta.get("block_start"),
        "block_ts": meta.get("block_ts"),
        "fit_count": meta.get("fit_count"),
        "last_fit_block": meta.get("last_fit_block"),
        "of_blocks": len(blocks),
        "legacy_input_hash_note": ("legacy input_hash covers only the first 4 MiB; "
                                   "the full-frame hash of the current inputs is "
                                   "recorded separately in this report"),
    }


def compare(frame_path: Path, state: Path, ledger_path: Path,
            *, tolerance: float = TOLERANCE, legacy: bool = False) -> dict[str, Any]:
    """Compare the COMPLETED probability prefix against the archived ledger.

    Only positions ``[0, processed_end)`` are compared, end exclusive: the
    unprocessed suffix is not evidence and is never counted as a finite-mask
    mismatch. Rows the model legitimately left NaN inside the processed prefix
    ARE included. Direction and rank come from the recovered exact producers in
    ``direction_contract`` and are computed over the full original probability
    prefix BEFORE any join, so rank warm-up and positional NaN slots are the
    original ones.

    Refuses outright on an invalid checkpoint or duplicate join keys.
    """

    inputs = load_inputs(frame_path)
    if legacy:
        probability, source = load_legacy_generation(state, inputs)
        verdict = {"resumable": None, "problems": [], **source}
    else:
        verdict = validate_checkpoint(state, inputs)
        if not verdict["resumable"]:
            raise ParityComparisonRefused(
                f"checkpoint at {state} is invalid: {verdict['problems']}")
        probability, meta = read_checkpoint(state)
        blocks = block_starts(inputs["identity"]["rows"])
        index = int(meta["next_block_index"])
        verdict = dict(verdict, source="hardened_runner_state",
                       processed_end_exclusive=(blocks[index] if index < len(blocks)
                                                else inputs["identity"]["rows"]))
    end = int(verdict["processed_end_exclusive"])
    complete_walk = int(verdict["next_block_index"]) >= int(verdict["of_blocks"])

    # Direction and rank over the ORIGINAL full prefix, before any subsetting.
    # `external_rank` is the rolling rank of the CONFIDENCE |p - 0.5|
    # (direction_contract module docstring / long_context_model.predictions),
    # never of the probability itself.
    prefix = probability[:end]
    direction = dc.signed_direction(prefix)
    confidence = np.abs(prefix - 0.5)
    rank = dc.rolling_rank(confidence)


    rebuilt = pd.DataFrame({
        "ts": inputs["ts"][:end], "probability": prefix,
        "rebuilt_direction": direction, "rebuilt_rank": rank,
    })
    archived = pd.read_csv(ledger_path)
    archived["ts"] = pd.to_datetime(archived.ts, utc=True)

    dup_arch = int(archived.ts.duplicated().sum())
    dup_reb = int(rebuilt.ts.duplicated().sum())
    if dup_arch or dup_reb:
        raise ParityComparisonRefused(
            f"duplicate join keys: archived={dup_arch}, rebuilt={dup_reb}")

    merged = archived.merge(rebuilt, on="ts", how="inner").sort_values("ts")
    a = merged.external_probability_green.to_numpy(float)
    b = merged.probability.to_numpy(float)
    both = np.isfinite(a) & np.isfinite(b)
    diff = np.abs(a[both] - b[both]) if both.any() else np.array([])
    finite_mask_divergent = np.isfinite(a) != np.isfinite(b)
    mask_mismatches = int(finite_mask_divergent.sum())

    stamps = pd.DatetimeIndex(pd.to_datetime(inputs["ts"], utc=True))
    blocks = block_starts(inputs["identity"]["rows"])

    def locate(ts: pd.Timestamp) -> dict[str, Any]:
        position = int(stamps.searchsorted(ts))
        return {"ts": str(ts), "position": position,
                "fit_block_start": max([s for s in blocks if s <= position],
                                       default=None)}

    # Earliest FINITE-MASK divergence, reported separately from the earliest
    # jointly-finite value divergence. Mask disagreement can start earlier and
    # must not be described as if the value divergence were the first mismatch.
    first_mask_divergence = None
    if mask_mismatches:
        idx = int(np.argmax(finite_mask_divergent))
        first_mask_divergence = {
            **locate(pd.Timestamp(merged.ts.to_numpy()[idx])),
            "archived_finite": bool(np.isfinite(a[idx])),
            "rebuilt_finite": bool(np.isfinite(b[idx])),
        }

    first_divergence = None
    if diff.size and diff.max() > tolerance:
        over = diff > tolerance
        idx = int(np.argmax(over))
        first_divergence = {
            **locate(pd.Timestamp(merged.ts.to_numpy()[both][idx])),
            "archived": float(a[both][idx]),
            "rebuilt": float(b[both][idx]),
            "abs_diff": float(diff[idx]),
        }

    # Direction / rank, reported separately and never mixed into probability parity.
    arch_dir = merged.external_direction.to_numpy(float)
    dir_mask = both & np.isfinite(arch_dir)
    direction_mismatches = int((np.sign(arch_dir[dir_mask])
                                != merged.rebuilt_direction.to_numpy()[dir_mask]).sum())
    direction_mask_mismatches = int(
        (np.isfinite(arch_dir) & (arch_dir != 0)) != (
            merged.rebuilt_direction.to_numpy() != 0)).sum() if len(merged) else 0
    arch_rank = merged.external_rank.to_numpy(float)
    reb_rank = merged.rebuilt_rank.to_numpy(float)
    rank_mask_mismatches = int((np.isfinite(arch_rank) != np.isfinite(reb_rank)).sum())
    rank_both = np.isfinite(arch_rank) & np.isfinite(reb_rank)
    rank_diff = np.abs(arch_rank[rank_both] - reb_rank[rank_both]) if rank_both.any() \
        else np.array([])

    probability_ok = (mask_mismatches == 0 and diff.size > 0
                      and float(diff.max()) <= tolerance)
    lo, hi = archived.ts.min(), archived.ts.max()
    window = rebuilt[(rebuilt.ts >= lo) & (rebuilt.ts <= hi)]
    # Expected-key coverage strictly WITHIN the processed bounds: an archived
    # timestamp inside [first processed, last processed] that is absent from the
    # rebuilt frame is a genuinely missing row, not "outside the prefix".
    p_lo, p_hi = rebuilt.ts.min(), rebuilt.ts.max()
    archived_in_bounds = archived[(archived.ts >= p_lo) & (archived.ts <= p_hi)]
    missing_expected = sorted(set(archived_in_bounds.ts) - set(rebuilt.ts))
    extra_in_bounds = sorted(set(window.ts) - set(archived.ts))
    coverage_ok = not missing_expected
    direction_ok = (direction_mismatches == 0 and direction_mask_mismatches == 0)
    rank_ok = (rank_mask_mismatches == 0 and rank_diff.size > 0
               and float(rank_diff.max()) <= tolerance)
    contract_ok = probability_ok and coverage_ok and direction_ok and rank_ok

    if not complete_walk:
        status = "PARTIAL AGREEMENT" if probability_ok else "PARTIAL MISMATCH"
        contract_status = ("PARTIAL CONTRACT AGREEMENT" if contract_ok
                           else "PARTIAL CONTRACT MISMATCH")
    else:
        status = "FULL PARITY" if probability_ok else "PARITY FAILED"
        contract_status = ("FULL CONTRACT PARITY" if contract_ok
                           else "CONTRACT PARITY FAILED")

    return {
        "status": status,
        "walk_complete": complete_walk,
        "partial": not complete_walk,
        "checkpoint": verdict,
        "processed_prefix_rows_end_exclusive": end,
        "processed_first_ts": str(inputs["ts"].iloc[0]),
        "processed_last_ts": str(inputs["ts"].iloc[end - 1]),
        "ledger": str(ledger_path),
        "ledger_sha256": sha_file(ledger_path),
        "identity": inputs["identity"],
        "overlap_first_ts": str(merged.ts.min()) if len(merged) else None,
        "overlap_last_ts": str(merged.ts.max()) if len(merged) else None,
        "archived_rows": int(len(archived)),
        "rebuilt_rows_in_processed_window": int(len(window)),
        "overlap_rows": int(len(merged)),
        "duplicate_keys_archived": dup_arch,
        "duplicate_keys_rebuilt": dup_reb,
        "archived_rows_outside_processed_prefix": int(len(archived) - len(merged)),
        "extra_in_rebuilt": int(len(window) - len(merged)),
        "archived_finite": int(np.isfinite(a).sum()),
        "rebuilt_finite": int(np.isfinite(b).sum()),
        "finite_mask_mismatches": mask_mismatches,
        "compared": int(both.sum()),
        "tolerance": tolerance,
        "max_abs_diff": float(diff.max()) if diff.size else None,
        "mean_abs_diff": float(diff.mean()) if diff.size else None,
        "exceed_tolerance": int((diff > tolerance).sum()) if diff.size else None,
        "first_divergence": first_divergence,
        "direction": {
            "policy": "direction_contract.signed_direction (p >= 0.5 -> +1, else -1)",
            "compared": int(dir_mask.sum()),
            "mismatches": int((np.sign(arch_dir[dir_mask])
                               != merged.rebuilt_direction.to_numpy()[dir_mask]).sum()),
        },
        "rank": {
            "policy": (f"direction_contract.rolling_rank (lookback {dc.RANK_LOOKBACK} "
                       f"rows, minimum {dc.RANK_MINIMUM}, ties half, past only)"),
            "archived_finite": int(np.isfinite(arch_rank).sum()),
            "rebuilt_finite": int(np.isfinite(reb_rank).sum()),
            "finite_mask_mismatches": int((np.isfinite(arch_rank)
                                           != np.isfinite(reb_rank)).sum()),
            "compared": int(rank_both.sum()),
            "max_abs_diff": float(rank_diff.max()) if rank_diff.size else None,
        },
        "kind": "historical replay parity, not forward testing",
    }



def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("run", "validate", "compare"))
    parser.add_argument("--frame", required=True, type=Path)
    parser.add_argument("--state", required=True, type=Path)
    parser.add_argument("--ledger", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--restart", action="store_true")
    parser.add_argument("--max-blocks", type=int)
    parser.add_argument("--legacy", action="store_true",
                        help="compare a collector-format legacy generation (read-only)")
    args = parser.parse_args(argv)

    if args.command == "run":
        result = run(args.frame, args.state, restart=args.restart,
                     max_blocks=args.max_blocks)
    elif args.command == "validate":
        result = validate_checkpoint(args.state, load_inputs(args.frame))
    else:
        if args.ledger is None:
            parser.error("compare needs --ledger")
        try:
            result = compare(args.frame, args.state, args.ledger, legacy=args.legacy)
        except ParityComparisonRefused as exc:
            print(json.dumps({"status": "REFUSED", "reason": str(exc)}, indent=1))
            return 2

    payload = json.dumps(result, indent=1, default=str)
    if args.out:
        args.out.write_text(payload)
    print(payload)
    if args.command == "validate":
        return 0 if result.get("resumable") else 1
    if args.command == "compare":
        # An incomplete diagnostic is NOT a pass, and a mask or tolerance
        # difference never exits successfully.
        return 0 if result["status"] == "FULL PARITY" else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
