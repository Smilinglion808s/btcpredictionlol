import sys, pathlib, numpy as np, pandas as pd
sys.path.insert(0,'/tmp/c30root')
from external_research import c36_fee_frontier_r3 as fr
out = pathlib.Path('/tmp/c30root/c36f_repro_out'); out.mkdir(parents=True, exist_ok=True)
ref_dir = pathlib.Path('/tmp/upx/vault_work/legacy_c37/external_research/c36_fee_frontier_r3_output')
fr.OUT = out
fr.main()
total=0
for p in sorted(ref_dir.glob('*.csv')):
    a=pd.read_csv(p); b=pd.read_csv(out/p.name)
    if a.shape!=b.shape: print("SHAPE DIFF",p.name,a.shape,b.shape); total+=1; continue
    n=0
    for c in a.columns:
        if pd.api.types.is_numeric_dtype(a[c]) and pd.api.types.is_numeric_dtype(b[c]):
            af,bf=a[c].astype(float).to_numpy(),b[c].astype(float).to_numpy()
            n+=int((~(np.isclose(af,bf,rtol=0,atol=1e-12)|(np.isnan(af)&np.isnan(bf)))).sum())
        else:
            n+=int((a[c].astype(str)!=b[c].astype(str)).sum())
    print(f"{p.name}: {len(a)} rows, {n} cell mismatches"); total+=n
print("C36_FRONTIER TOTAL MISMATCHES:", total)
