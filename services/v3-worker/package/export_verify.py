"""Export exact daily heads, replay fixtures and compact seed for Lovable."""
from pathlib import Path
import gzip
import hashlib
import json
import shutil
import zipfile

import numpy as np
import pandas as pd

from model import FEATURES, MODEL_VERSION, fit_head, predict, rank_before_append

ROOT = Path(__file__).resolve().parent
WORK = ROOT.parent
SOURCE = WORK / "upload/t45-priceflow-q375-2026-10-05(1).csv"
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == "47bbce6e91fb2421bb2fbcafe94653e0a69a5a1c0d01547d3d225be0c6557a01"
data = pd.read_csv(SOURCE, low_memory=False).sort_values("target_ts").reset_index(drop=True)
stamps = (pd.to_datetime(data.target_ts, utc=True).astype("int64") // 10**9).to_numpy()
reference = pd.read_parquet(WORK / "pf_polish/outputs/earlier_predictions.parquet")
assert np.array_equal((reference.ts.astype("int64") // 10**9).to_numpy(), stamps)
labels = data.actual_direction.to_numpy()
cutoff = int(pd.Timestamp("2026-10-05", tz="UTC").timestamp())
latest, full_heads, calculated, summaries, rank_seed = {}, {}, {}, {}, {}

def write_json(path, obj):
    raw = json.dumps(obj, separators=(",", ":"), allow_nan=False).encode()
    if str(path).endswith(".gz"):
        path.write_bytes(gzip.compress(raw, mtime=0))
    else:
        path.write_bytes(raw)

for checkpoint, names in FEATURES.items():
    x = data[["feature_t45_" + name for name in names]].to_numpy(float)
    good = np.isfinite(x).all(axis=1)
    probabilities = np.full(len(stamps), np.nan)
    heads = []
    for day in pd.date_range("2025-12-29", "2026-10-05", tz="UTC"):
        boundary = int(day.timestamp())
        try:
            head = fit_head(stamps, x, labels, boundary, checkpoint)
        except ValueError as exc:
            if str(exc) == "insufficient_training":
                continue
            raise
        heads.append(head)
        indices = np.flatnonzero((stamps >= boundary) & (stamps < boundary + 86400) & good)
        if len(indices):
            probabilities[indices] = predict(head, x[indices], boundary)
    latest[str(checkpoint)] = heads[-1]
    full_heads[str(checkpoint)] = heads
    key = f"t{checkpoint}_c0.001"
    mask = stamps < cutoff
    expected = reference["p_" + key].to_numpy()
    assert np.array_equal(np.isfinite(probabilities[mask]), np.isfinite(expected[mask]))
    error = float(np.nanmax(np.abs(probabilities[mask] - expected[mask])))
    assert error < 1e-12, (checkpoint, error)
    ranks = np.full(len(stamps), np.nan)
    history, history_rows = [], []
    for i, p in enumerate(probabilities):
        if not np.isfinite(p):
            continue
        rank = rank_before_append(float(p), history)
        if rank is not None:
            ranks[i] = rank
        history.append(abs(float(p) - .5))
        history_rows.append({"candle_s": int(stamps[i]), "confidence": abs(float(p) - .5),
                             "fit_day_s": int(stamps[i] // 86400 * 86400)})
    expected_rank = reference["rank_" + key].to_numpy()
    assert np.allclose(ranks[mask], expected_rank[mask], atol=0, rtol=0, equal_nan=True), checkpoint
    calculated[checkpoint] = (probabilities, ranks)
    rank_seed[str(checkpoint)] = [r for r in history_rows if r["candle_s"] < cutoff][-768:]
    summaries[str(checkpoint)] = {"prediction_count": int(np.isfinite(expected[mask]).sum()),
                                  "max_probability_error": error, "rank_exact": True,
                                  "daily_fits_including_oct5": len(heads)}
    print(checkpoint, summaries[str(checkpoint)], flush=True)

actual_times = np.zeros(len(stamps), dtype=int)
actual_directions = np.zeros(len(stamps), dtype=int)
for checkpoint in (30, 15):
    p, ranks = calculated[checkpoint]
    eligible = ranks >= .70
    actual_times[eligible] = checkpoint
    actual_directions[eligible] = np.where(p[eligible] >= .5, 1, -1)
expected_times = np.load(WORK / "pf_polish/inputs/earlier_times.npz")["E008"].copy()
expected_directions = np.load(WORK / "pf_polish/inputs/earlier_directions.npz")["E008"].copy()
expected_directions[expected_times == 45] = 0
expected_times[expected_times == 45] = 0
expected_directions[expected_times == 0] = 0
mask = stamps < cutoff
assert np.array_equal(actual_times[mask], expected_times[mask])
assert np.array_equal(actual_directions[mask], expected_directions[mask])
recent = (stamps >= int(pd.Timestamp("2026-09-14", tz="UTC").timestamp())) & mask
assert int((actual_times[recent] > 0).sum()) == 778

# Latest completed training seed only, not unfinished Oct5 outcomes.
seed_mask = (stamps >= cutoff - 8640 * 900) & (stamps < cutoff)
seed = []
for i in np.flatnonzero(seed_mask):
    row = {"candle_s": int(stamps[i]), "label": int(labels[i]) if labels[i] in (-1, 0, 1) else None}
    for name in FEATURES[30]:
        val = data.at[i, "feature_t45_" + name]
        row[name] = float(val) if np.isfinite(val) else None
    seed.append(row)

# 8 days of replay with supplied past-only starting histories.
fixture_start = cutoff - 8 * 86400
fixtures, initial = [], {}
for checkpoint in (15, 30):
    p, _ = calculated[checkpoint]
    prior = np.flatnonzero((stamps < fixture_start) & np.isfinite(p))[-768:]
    initial[str(checkpoint)] = [{"candle_s": int(stamps[i]), "confidence": abs(float(p[i]) - .5)} for i in prior]
for i in np.flatnonzero((stamps >= fixture_start) & mask):
    item = {"candle_s": int(stamps[i]), "expected_checkpoint": int(actual_times[i]),
            "expected_direction": int(actual_directions[i]), "heads": {}}
    for checkpoint in (15, 30):
        p, ranks = calculated[checkpoint]
        x = [data.at[i, "feature_t45_" + name] for name in FEATURES[checkpoint]]
        item["heads"][str(checkpoint)] = {"features": [float(v) if np.isfinite(v) else None for v in x],
            "p": float(p[i]) if np.isfinite(p[i]) else None,
            "rank": float(ranks[i]) if np.isfinite(ranks[i]) else None}
    fixtures.append(item)

write_json(ROOT / "seed.json.gz", {"model_version": MODEL_VERSION, "through_exclusive_s": cutoff,
           "label_source": "OKX confirmed BTC-USDT 15m direction", "rows": seed,
           "rank_histories": rank_seed, "heads": latest})
write_json(ROOT / "replay_fixture.json.gz", {"initial_histories": initial, "rows": fixtures,
           "heads": {k: [h for h in v if h["valid_from_s"] >= fixture_start] for k, v in full_heads.items()}})
write_json(ROOT / "verification.json", {"model_version": MODEL_VERSION,
           "source_sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(), "heads": summaries,
           "selection_parity_rows": int(mask.sum()), "selection_exact": True,
           "recent_signals": 778, "training_seed_rows": len(seed),
           "warning": "Retrospective parity only; no live-fill or prospective-profit claim."})
shutil.copyfile(WORK / "pf_polish/forward_candidate.json", ROOT / "forward_candidate.json")
manifest = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in ROOT.iterdir() if p.is_file() and p.name != "SHA256.json"}
write_json(ROOT / "SHA256.json", manifest)
print(json.dumps(json.loads((ROOT / "verification.json").read_text()), indent=2))
