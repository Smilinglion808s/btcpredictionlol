import sys, numpy as np, pandas as pd
sys.path.insert(0,'/dev-server/services/c85-worker')
sys.path.insert(0,'/dev-server/services/c85-worker/reproduction')
from run_coverage_control_stream import load_control, rows_from, PACKAGE
from src.experts.coverage_control import CoverageControlProducer
control = load_control()
frame = control.load_frame(PACKAGE/"restored_checkpoint"/"continuous_r1")
live = ((frame.ts>=control.LIVE_READY)&(frame.ts<control.END)).to_numpy()
records = rows_from(frame, live)
p = CoverageControlProducer(coverages=(0.30,))
res=[p.observe(r) for r in records]
led = pd.read_csv("/mnt/documents/.lovable/c85-cache/upx/upstream/vault_work/legacy_c30/external_research/c30_c70_lab_manager_r2_output/selected_shadow_ledger.csv", parse_dates=["ts"], usecols=["ts","prediction_cov30","stage_cov30"])
m = pd.DataFrame({"ts":frame.ts,
  "pred":[r["policies"]["cov30"]["prediction"] for r in res],
  "stage":[r["policies"]["cov30"]["stage"] for r in res]}).merge(led,on="ts",how="inner",validate="one_to_one")
print("archived C30 ledger rows matched:", len(m))
print("prediction_cov30 mismatches:", int((m.pred!=m.prediction_cov30).sum()))
print("stage_cov30 mismatches:", int((m.stage!=m.stage_cov30).sum()))
