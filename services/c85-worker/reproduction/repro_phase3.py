import sys, pathlib, numpy as np, pandas as pd
sys.path.insert(0,'/tmp/c30root')
from external_research import c30_c70_lab_manager_r2_phase3 as p3
out = pathlib.Path('/tmp/c30root/phase3_repro_out'); out.mkdir(parents=True, exist_ok=True)
ref_dir = pathlib.Path('/tmp/c30root/external_research/c30_c70_lab_manager_r2_output')
p3.OUT = out
p3.main()
total=0
for p in sorted(out.glob('phase3_*.csv')):
    ref = ref_dir/p.name
    if not ref.exists(): print("no reference for", p.name); continue
    a=pd.read_csv(ref); b=pd.read_csv(p)
    if a.shape!=b.shape: print("SHAPE DIFF",p.name,a.shape,b.shape); total+=1; continue
    n=0
    for c in a.columns:
        if pd.api.types.is_numeric_dtype(a[c]) and pd.api.types.is_numeric_dtype(b[c]):
            af,bf=a[c].astype(float).to_numpy(),b[c].astype(float).to_numpy()
            n+=int((~(np.isclose(af,bf,rtol=0,atol=1e-12)|(np.isnan(af)&np.isnan(bf)))).sum())
        else:
            n+=int((a[c].astype(str)!=b[c].astype(str)).sum())
    print(f"{p.name}: {len(a)} rows, {n} cell mismatches"); total+=n
print("PHASE3 TOTAL MISMATCHES:", total)
