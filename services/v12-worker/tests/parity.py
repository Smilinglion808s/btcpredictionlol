"""Run against the recovered, unmodified U evidence archive."""
from pathlib import Path
import sys,json,os
os.environ['OMP_NUM_THREADS']='2';os.environ['OPENBLAS_NUM_THREADS']='2'
import numpy as np,pandas as pd
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
from policy import candidate,choose,arrival_admissible
from scorer import Scorer
evidence=Path(sys.argv[1]);sys.path.append(str(evidence/'src'))
from union_policy import all_orders,choose_sources,first_admissions
report={}
for period,prefix in [('historical','data'),('later','output')]:
    frames={s:pd.read_parquet(evidence/prefix/(f'{s}_predictions.parquet' if period=='historical' else f'later_{s}_predictions.parquet')) for s in ['L','R']}
    expected=[];actual=[]
    for source,frame in frames.items():
        oracle=all_orders(frame,source);expected.append(oracle)
        found=[]
        for r in frame.to_dict('records'):
            c=candidate(r,source)
            if c is None:continue
            admitted=arrival_admissible(c,r['arrival_yes_ask'] if c.side==1 else r['arrival_no_ask'],bool(r['arrival_valid']))
            found.append(dict(ticker=r['ticker'],second=r['second'],source=source,entry_ts=r['decision_ts'],side=c.side,probability=c.probability,limit_all_in=c.limit_all_in,admitted=admitted))
        found=pd.DataFrame(found,columns=['ticker','second','source','entry_ts','side','probability','limit_all_in','admitted'])
        keys=['ticker','second'];o=oracle.sort_values(keys).reset_index(drop=True);a=found.sort_values(keys).reset_index(drop=True)
        assert o[keys].equals(a[keys]),(period,source,'selection')
        for col in ['side','probability','limit_all_in','admitted']:
            np.testing.assert_allclose(o[col].to_numpy(float),a[col].to_numpy(float),atol=1e-12,rtol=0)
        actual.append(found);report[f'{period}_{source}']={'rows_checked':len(frame),'eligible_orders':len(found),'exact_selection_and_admission':True}
    ex=first_admissions(choose_sources(pd.concat(expected)))
    ac=first_admissions(choose_sources(pd.concat(actual)))
    for col in ['ticker','second','source','side','admitted']:
        assert ex[col].tolist()==ac[col].tolist(),col
    report[period+'_union']={'entries':len(ac),'exact_first_admission':True}
scorer=Scorer()
for source in ['L','R']:
    d=pd.read_parquet(evidence/'output'/f'later_{source}_predictions.parquet')
    d=d[d.fit_ts.eq(pd.Timestamp('2026-09-14',tz='UTC'))&d.feature_valid&d.quote_valid]
    for name,p in scorer.models[source].predict(d).items():
        np.testing.assert_allclose(p,d['p_'+name],atol=1e-12,rtol=0,equal_nan=True)
    report['frozen_'+source]={'prediction_rows':len(d),'max_error_tolerance':1e-12,'passed':True}
# Source priority cannot inspect arrival; an L failure cannot become an R fill.
l={'second':480,'feature_valid':True,'quote_valid':True,'spread':.02,'yes_ask':.7,'no_ask':.32,'market_p':.69,'p_V12':.8,'p_LINEAR':.8,'p_NONLINEAR':.8}
r={**l,'p_V12_REPRICING':.85,'p_PHYSICAL':.85,'p_QUOTE':.85}
c=choose(l,r);assert c.source=='L' and not arrival_admissible(c,.95,True)
try:scorer.score(pd.DataFrame([l]),'2026-10-05T00:00:00Z');raise AssertionError('expired fit accepted')
except ValueError as e:assert str(e)=='MODEL_EXPIRED_OR_NOT_YET_VALID'
print(json.dumps(report,indent=2))
