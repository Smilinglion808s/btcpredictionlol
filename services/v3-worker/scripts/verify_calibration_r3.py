"""Offline independent implementation check against the supplied R3 lab ledger.

Usage: python scripts/verify_calibration_r3.py /path/to/regime_104_r3/outputs
Never imports proxy heads into production. All78 weekly calibration fits repeat.
"""
from pathlib import Path
import json,sys
import numpy as np
import pandas as pd
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'))
import calibration as C

def verify(source):
    d=pd.read_parquet(source/'stage2_panel.parquet');start=d.ts.min();history=int(start.timestamp())
    risk={h['boundary']:h for h in json.loads((source/'risk_weekly_heads.json').read_text())}
    rows=[]
    for r in d[d.union_side!=0].itertuples(index=False):
        h=risk[r.risk_boundary];c=int(r.ts.timestamp())
        rows.append(dict(candle_s=c,side=r.union_side,label=r.label,settlement_s=r.settlement_ts.timestamp(),
                         loss_probability=r.risk_probability70 if r.side_V3_risk else r.p_risk_lower60_all,
                         evaluated_at_ms=(c+45)*1000,lineage=C.PROXY_LINEAGE,risk_head_sha256=C.fingerprint(h),
                         risk_valid_from_s=h['boundary'],risk_valid_until_s=h['boundary']+C.WEEK,
                         risk_max_settlement_s=h['max_settlement_s']))
    predicted=d.side_V3_risk.to_numpy().copy();max_error=0.;fit_errors=[]
    archived={h['week']:h for h in json.loads((source/'stage2_numeric_heads.json').read_text()) if h['model']=='calibration'}
    for week in range(27,105):
        b=history+(week-1)*C.WEEK;h=C.fit(rows,b,history,C.PROXY_LINEAGE);g=d[d.week==week]
        for field in ['median','mean','scale','coef','intercept']:
            err=float(np.max(np.abs(np.asarray(h[field])-np.asarray(archived[week][field]))))
            fit_errors.append(err);assert err<1e-10,(week,field,err)
        for r in g.itertuples():
            if not r.union_side:
                predicted[r.Index]=0;continue
            p=C.predict(h,r.risk_probability70 if r.side_V3_risk else r.p_risk_lower60_all,int(r.ts.timestamp()),C.PROXY_LINEAGE)
            max_error=max(max_error,abs(p-r.p_calibration))
            predicted[r.Index]=C.route(r.side_V3_risk,r.union_side,p)[0]
    mismatches=int((predicted!=d.side_calibration_router.to_numpy()).sum())
    assert max_error<1e-12 and mismatches==0
    called=predicted!=0;wins=int((predicted[called]==d.label.to_numpy()[called]).sum())
    result=dict(opportunities=len(d),learned_opportunities=int((d.week>=27).sum()),refits=78,
                max_probability_error=max_error,max_parameter_error=max(fit_errors),decision_mismatches=mismatches,
                calls=int(called.sum()),wins=wins,losses=int(called.sum())-wins,raw=2*wins-int(called.sum()),
                first26weeks='unchanged baseline as in archived study',lineage=C.PROXY_LINEAGE,
                production_artifact_created=False)
    return result

if __name__=='__main__':
    print(json.dumps(verify(Path(sys.argv[1])),indent=2))
