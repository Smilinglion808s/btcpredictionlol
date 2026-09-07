import numpy as np, pandas as pd
FIX='/dev-server/services/c85-worker/evaluation-fixtures/upstream/'
def compare(name, new, decision_prefixes=("prediction","stage","selected_prediction","selected_stage","control_prediction","control_stage","candidate_prediction","candidate_stage","full_prediction","full_stage","opportunity")):
    ref = pd.read_parquet(FIX+name)
    ref['ts']=pd.to_datetime(ref.ts,utc=True); new=new.copy(); new['ts']=pd.to_datetime(new.ts,utc=True)
    print(f"[{name}] rows ref={len(ref)} new={len(new)} window {ref.ts.min()} -> {ref.ts.max()}")
    assert len(ref)==len(new) and (ref.ts.values==new.ts.values).all(), "timestamp misalignment"
    cells=0; dec=0
    for col in ref.columns:
        if col not in new.columns:
            print("  MISSING COLUMN", col); cells+=1; continue
        a,b=ref[col],new[col]
        if pd.api.types.is_numeric_dtype(a) and pd.api.types.is_numeric_dtype(b):
            af,bf=a.astype(float).to_numpy(),b.astype(float).to_numpy()
            n=int((~(np.isclose(af,bf,rtol=0,atol=1e-12)|(np.isnan(af)&np.isnan(bf)))).sum())
            if n: print(f"  MISMATCH {col}: {n} rows max|d|={np.nanmax(np.abs(af-bf)):.3e}")
        else:
            n=int((a.astype(str)!=b.astype(str)).sum())
            if n: print(f"  MISMATCH {col}: {n} rows")
        cells+=n
        if any(col==p or col.startswith(p+"_") for p in decision_prefixes): dec+=n
    print(f"  TOTAL CELL MISMATCHES: {cells}   DECISION MISMATCHES: {dec}")
    return cells,dec
