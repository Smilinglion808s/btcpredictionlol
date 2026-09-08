import sys, numpy as np, pandas as pd
sys.path.insert(0, '/dev-server/services/c85-worker/evaluation-fixtures/cache/c30root')
from external_research import t0_t5_fee_coverage_frontier_r1 as control

frame = control.load_frame(control.DEFAULT_CHECKPOINT)
frame, ranks = control.add_confidence_scores(frame)
opp = control.opportunity(frame)
masks = control.split_masks(frame)
_, policies = control.build_adaptive_frontier(frame, ranks["R2_R4_BLEND"], opp, masks)

export = frame[[
    "ts","label","label_source","source_segment","candidate_prediction","candidate_stage",
    "candidate_t5_router_prediction","external_direction","external_rank",
    "r2_adjusted_probability_correct","r4_adjusted_probability_correct",
    "reliability_blend_probability_correct","active_direction_margin","t5_reliability_rank",
]].copy()
for target, (prediction, stage, threshold) in policies.items():
    tag = f"cov{int(round(target*100))}"
    export[f"active_threshold_{tag}"] = threshold
    export[f"prediction_{tag}"] = prediction
    export[f"stage_{tag}"] = stage

ref = pd.read_parquet('/dev-server/services/c85-worker/evaluation-fixtures/upstream/fee_coverage_shadow_ledger.parquet')
ref['ts'] = pd.to_datetime(ref.ts, utc=True)
export['ts'] = pd.to_datetime(export.ts, utc=True)
print("rows ref/new", len(ref), len(export), "window", ref.ts.min(), "->", ref.ts.max())
assert (ref.ts.values == export.ts.values).all(), "timestamp misalignment"
bad = 0
for col in ref.columns:
    if col not in export.columns:
        print("MISSING COLUMN", col); bad += 1; continue
    a, b = ref[col], export[col]
    if pd.api.types.is_numeric_dtype(a) and pd.api.types.is_numeric_dtype(b):
        af, bf = a.astype(float).to_numpy(), b.astype(float).to_numpy()
        same = (np.isclose(af, bf, rtol=0, atol=1e-12) | (np.isnan(af) & np.isnan(bf)))
        n = int((~same).sum())
        if n: print(f"MISMATCH {col}: {n} rows, max abs diff {np.nanmax(np.abs(af-bf)):.3e}")
    else:
        n = int((a.astype(str) != b.astype(str)).sum())
        if n: print(f"MISMATCH {col}: {n} rows")
    bad += n
print("TOTAL CELL MISMATCHES:", bad)
dec = [c for c in ref.columns if c.startswith("prediction_") or c.startswith("stage_")]
dm = sum(int((ref[c].astype(str) != export[c].astype(str)).sum()) for c in dec)
print("DECISION MISMATCHES:", dm, "over", len(dec), "decision columns")
