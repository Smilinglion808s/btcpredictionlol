"""Unchanged directional fit recipe; self-contained inputs supplied by caller."""
from pathlib import Path
import hashlib,warnings
import numpy as np
import pandas as pd
from scipy.special import expit,logit
from scipy.optimize import minimize
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.exceptions import ConvergenceWarning
from threadpoolctl import threadpool_limits
from .scoring import ridge_transform,calibrated,predict_bundle
ROOT=Path(__file__).resolve().parent.parent
START=pd.Timestamp("2024-09-16",tz="UTC")
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
SEED=280950
ALGORITHMS=["ridge","boost","blend"]
QUANTILES=[70,80,90]
def calibrate(raw,y):
    z=logit(np.clip(raw,1e-6,1-1e-6));n=len(y)
    def fun(ab):
        a,b=ab;v=a*z+b;p=expit(v);e=p-y
        return np.mean(np.logaddexp(0,v)-y*v)+5/n*((a-1)**2+b*b),np.array([(e*z).mean()+10/n*(a-1),e.mean()+10/n*b])
    opt=minimize(fun,[1.,0.],jac=True,bounds=[(0,None),(None,None)],method='L-BFGS-B')
    if not opt.success:raise RuntimeError(opt.message)
    return opt.x

def fit_bundle(labels,x,second,history,block,pack='full'):
    end=START+pd.Timedelta(weeks=block-1);calstart=end-pd.Timedelta(weeks=4);start=end-pd.Timedelta(weeks=history);margin=pd.Timedelta(minutes=1)
    base=(labels.ts>=start)&(labels.settlement_ts<=calstart-margin)&labels.label.isin([-1,1]);cal=(labels.ts>=calstart)&(labels.settlement_ts<=end-margin)&labels.label.isin([-1,1])
    assert base.sum()>3000 and cal.sum()>2600 and not (base&cal).any()
    X=x.to_numpy(float);y=(labels.label.to_numpy()==1).astype(int);xb=X[base]
    with warnings.catch_warnings():
        warnings.simplefilter('ignore',RuntimeWarning);lo,med,hi=np.nanquantile(xb,[.001,.5,.999],axis=0)
    lo=np.nan_to_num(lo,nan=0);med=np.nan_to_num(med,nan=0);hi=np.nan_to_num(hi,nan=0);missing=np.isnan(xb);filled=np.where(missing,med,np.clip(xb,lo,hi))
    scaler=StandardScaler().fit(np.column_stack([filled,missing.astype(float)]));prep=dict(lower=lo,median=med,upper=hi,scaler=scaler)
    models={'ridge':LogisticRegression(C=.1,max_iter=1000,solver='lbfgs',random_state=SEED),'boost':HistGradientBoostingClassifier(max_iter=160,learning_rate=.04,max_leaf_nodes=7,min_samples_leaf=200,l2_regularization=20,early_stopping=False,random_state=SEED)}
    b=dict(second=second,observed_seconds=second-1,history_weeks=history,block=block,pack=pack,features=list(x.columns),fit_end=end.isoformat(),cal_start=calstart.isoformat(),base_first_ts=labels.loc[base,'ts'].min().isoformat(),base_last_settlement=labels.loc[base,'settlement_ts'].max().isoformat(),cal_last_settlement=labels.loc[cal,'settlement_ts'].max().isoformat(),base_rows=int(base.sum()),cal_rows=int(cal.sum()),prep=prep,models=models,calibrators={},cutoffs={},protocol_sha256=sha(ROOT/'FINAL_SPEC.md'))
    cp={}
    with threadpool_limits(limits=1),warnings.catch_warnings():
        warnings.simplefilter('error',ConvergenceWarning)
        for name,model in models.items():
            fitx=ridge_transform(xb,prep) if name=='ridge' else xb;calx=ridge_transform(X[cal],prep) if name=='ridge' else X[cal]
            model.fit(fitx,y[base]);raw=model.predict_proba(calx)[:,1];ab=calibrate(raw,y[cal]);b['calibrators'][name]=ab;cp[name]=calibrated(raw,ab)
    cp['blend']=(cp['ridge']+cp['boost'])/2
    for name in ALGORITHMS:b['cutoffs'][name]={str(q):float(np.quantile(np.maximum(cp[name],1-cp[name]),q/100)) for q in QUANTILES}
    return b
