"""Preserved calibrated inference math from the lab."""
import numpy as np
from scipy.special import expit,logit
from threadpoolctl import threadpool_limits
ALGORITHMS=["ridge","boost","blend"]
def calibrated(p,ab):return expit(ab[0]*logit(np.clip(p,1e-6,1-1e-6))+ab[1])

def ridge_transform(x,prep):
    missing=np.isnan(x);filled=np.where(missing,prep['median'],np.clip(x,prep['lower'],prep['upper']))
    return prep['scaler'].transform(np.column_stack([filled,missing.astype(float)]))

def predict_bundle(b,x,algorithm=None):
    names=ALGORITHMS if algorithm is None else [algorithm];required=['ridge','boost'] if algorithm in [None,'blend'] else [algorithm];out={}
    with threadpool_limits(limits=1):
        for name in required:
            xx=ridge_transform(x,b['prep']) if name=='ridge' else x;out[name]=calibrated(b['models'][name].predict_proba(xx)[:,1],b['calibrators'][name])
    if 'blend' in names:out['blend']=(out['ridge']+out['boost'])/2
    return {k:out[k] for k in names}
