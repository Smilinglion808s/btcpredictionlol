import sys, pathlib, pandas as pd
sys.path.insert(0,'/tmp/c30root')
from external_research import c37_balanced_maturation_r1 as c37
out = pathlib.Path('/tmp/c30root/c37_repro_out'); out.mkdir(parents=True, exist_ok=True)
c37.OUT = out
c37.PHASE3_OUT = pathlib.Path('/tmp/c30root/phase3_repro_out')  # connected: consume the newly ported upstream ledger
c37.TIMING_OUT = pathlib.Path('/tmp/c30root/c36t_repro_out')     # connected: reproduced timing ledger
c37.main()
ref = pd.read_csv('/tmp/c30root/external_research/c37_balanced_maturation_r1_output/c37_shadow_ledger.csv', parse_dates=['ts'])
new = pd.read_csv(out/'c37_shadow_ledger.csv', parse_dates=['ts'])
import numpy as np
print("rows", len(ref), len(new))
assert (ref.ts.values==new.ts.values).all()
cells=0; dec=0
for c in ref.columns:
    a,b=ref[c],new[c]
    if pd.api.types.is_numeric_dtype(a) and pd.api.types.is_numeric_dtype(b):
        af,bf=a.astype(float).to_numpy(),b.astype(float).to_numpy()
        n=int((~(np.isclose(af,bf,rtol=0,atol=1e-12)|(np.isnan(af)&np.isnan(bf)))).sum())
        if n: print(f"MISMATCH {c}: {n} max|d|={np.nanmax(np.abs(af-bf)):.3e}")
    else:
        n=int((a.astype(str)!=b.astype(str)).sum())
        if n: print(f"MISMATCH {c}: {n}")
    cells+=n
    if "prediction" in c or "stage" in c or "admitted" in c: dec+=n
print("C37 TOTAL CELL MISMATCHES:", cells, "DECISION MISMATCHES:", dec)
