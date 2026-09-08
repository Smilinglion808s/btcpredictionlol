import sys, numpy as np, pandas as pd
sys.path.insert(0,'/dev-server/services/c85-worker/evaluation-fixtures/cache/c30root')
from external_research import t0_t5_fee_coverage_frontier_r1 as control
from external_research import t0_t5_fixed_floor_containment_r1 as ff
from external_research.t0_t5_branch_budget_stress_r1 import add_containment, evaluate
from compare import compare

frame = control.load_frame(control.DEFAULT_CHECKPOINT)
frame, ranks = control.add_confidence_scores(frame)
t5_rank = ranks["R2_R4_BLEND"]
opp = control.opportunity(frame)
masks = control.split_masks(frame)
full_prediction, full_stage = control.make_policy(frame, t5_rank, 0.0)
full = {s: control.metrics(frame, full_prediction, full_stage, m, opp) for s, m in masks.items()}
baseline, baseline_stage, baseline_threshold = control.make_adaptive_policy(frame, t5_rank, ff.TARGET_COVERAGE, opp)
baseline_row = {"identity":"SHARED_THRESHOLD_CONTROL","t0_floor":np.nan,"requested_coverage":ff.TARGET_COVERAGE,
                **evaluate(frame, baseline, baseline_stage, opp, masks)}
add_containment(baseline_row, full)
rows=[]; policies={}
for floor in ff.T0_FLOORS:
    p,s,t = ff.make_fixed_floor_policy(frame, t5_rank, floor, ff.TARGET_COVERAGE, opp)
    policies[floor]=(p,s,t)
    row={"identity":"FIXED_T0_FLOOR_T5_FILL","t0_floor":floor,"requested_coverage":ff.TARGET_COVERAGE,
         **evaluate(frame,p,s,opp,masks)}
    add_containment(row, full)
    for split in ("feb_apr_development","may_jun_validation","later_challenge","all"):
        row[f"{split}_win_rate_delta_pp"]=100*(row[f"{split}_win_rate"]-baseline_row[f"{split}_win_rate"])
    rows.append(row)
table = pd.DataFrame([baseline_row,*rows])
sub = table.loc[table.identity.eq("FIXED_T0_FLOOR_T5_FILL")].copy()
sub["pre_july_worst_win_rate"]=sub[["feb_apr_development_win_rate","may_jun_validation_win_rate"]].min(axis=1)
sub["pre_july_mean_win_rate"]=sub[["feb_apr_development_win_rate","may_jun_validation_win_rate"]].mean(axis=1)
selected = sub.sort_values(["pre_july_worst_win_rate","pre_july_mean_win_rate","t0_floor"],ascending=[False,False,True]).iloc[0]
floor=float(selected.t0_floor)
print("chosen floor", floor)
candidate, candidate_stage, candidate_threshold = policies[floor]
label = frame.label.to_numpy(float)
ledger = pd.DataFrame({
 "ts":frame.ts,"label":label,"opportunity":opp,"external_rank":frame.external_rank,
 "t5_reliability_rank":t5_rank,"t0_floor":floor,"active_t5_threshold":candidate_threshold,
 "candidate_prediction":candidate,"candidate_stage":candidate_stage,
 "candidate_score":np.where(opp&(candidate!=0),candidate*np.nan_to_num(label,nan=0.0),0).astype(np.int8),
 "control_prediction":baseline,"control_stage":baseline_stage,
 "control_active_threshold":baseline_threshold,
 "control_score":np.where(opp&(baseline!=0),baseline*np.nan_to_num(label,nan=0.0),0).astype(np.int8)})
compare('fixed_floor_shadow_ledger.parquet', ledger)
