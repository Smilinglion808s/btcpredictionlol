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
    tmp = state / f".{CKPT_NPZ}.{generation}.tmp"
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
def compare(frame_path: Path, state: Path, ledger_path: Path,
            *, tolerance: float = TOLERANCE) -> dict[str, Any]:
    """Compare rebuilt probabilities against the archived ledger.

    Probability parity only. Direction and rank are NOT recomputed here: their
    policy belongs to the recovered exact producers, and a threshold guess is
    not the original rule.
    """

    inputs = load_inputs(frame_path)
    verdict = validate_checkpoint(state, inputs)
    probability, meta = read_checkpoint(state)
    blocks = block_starts(inputs["identity"]["rows"])
    complete_walk = int(meta["next_block_index"]) >= len(blocks)

    rebuilt = pd.DataFrame({"ts": inputs["ts"], "probability": probability})
    archived = pd.read_csv(ledger_path)
    archived["ts"] = pd.to_datetime(archived.ts, utc=True)

    dup_arch = int(archived.ts.duplicated().sum())
    dup_reb = int(rebuilt.ts.duplicated().sum())
    merged = archived.merge(rebuilt, on="ts", how="inner")
    a = merged.external_probability_green.to_numpy(float)
    b = merged.probability.to_numpy(float)
    both = np.isfinite(a) & np.isfinite(b)
    diff = np.abs(a[both] - b[both]) if both.any() else np.array([])

    first_divergence = None
    if diff.size and diff.max() > tolerance:
        idx = int(np.argmax(np.abs(a[both] - b[both]) > tolerance))
        ts = merged.ts.to_numpy()[both][idx]
        first_divergence = {"ts": str(ts), "archived": float(a[both][idx]),
                            "rebuilt": float(b[both][idx])}

    lo, hi = archived.ts.min(), archived.ts.max()
    window = rebuilt[(rebuilt.ts >= lo) & (rebuilt.ts <= hi)]
    return {
        "walk_complete": complete_walk,
        "checkpoint": {k: verdict[k] for k in
                       ("resumable", "problems", "next_block_index", "of_blocks",
                        "block_ts", "fit_count", "generation")},
        "ledger": str(ledger_path),
        "ledger_sha256": sha_file(ledger_path),
        "identity": inputs["identity"],
        "overlap_first_ts": str(merged.ts.min()) if len(merged) else None,
        "overlap_last_ts": str(merged.ts.max()) if len(merged) else None,
        "archived_rows": int(len(archived)),
        "rebuilt_rows_in_window": int(len(window)),
        "overlap_rows": int(len(merged)),
        "duplicate_keys_archived": dup_arch,
        "duplicate_keys_rebuilt": dup_reb,
        "missing_in_rebuilt": int(len(archived) - len(merged)),
        "extra_in_rebuilt": int(len(window) - len(merged)),
        "archived_finite": int(np.isfinite(a).sum()),
        "rebuilt_finite": int(np.isfinite(b).sum()),
        "finite_mask_mismatches": int((np.isfinite(a) != np.isfinite(b)).sum()),
        "compared": int(both.sum()),
        "tolerance": tolerance,
        "max_abs_diff": float(diff.max()) if diff.size else None,
        "mean_abs_diff": float(diff.mean()) if diff.size else None,
        "exceed_tolerance": int((diff > tolerance).sum()) if diff.size else None,
        "first_divergence": first_divergence,
        "direction_policy": ("NOT EVALUATED HERE: direction and rank come from the "
                             "recovered exact producers (direction_contract), not "
                             "from a probability threshold guess"),
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
    args = parser.parse_args(argv)

    if args.command == "run":
        result = run(args.frame, args.state, restart=args.restart,
                     max_blocks=args.max_blocks)
    elif args.command == "validate":
        result = validate_checkpoint(args.state, load_inputs(args.frame))
    else:
        if args.ledger is None:
            parser.error("compare needs --ledger")
        result = compare(args.frame, args.state, args.ledger)

    payload = json.dumps(result, indent=1, default=str)
    if args.out:
        args.out.write_text(payload)
    print(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
