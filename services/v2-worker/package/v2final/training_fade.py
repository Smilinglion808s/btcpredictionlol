"""Unchanged Fade8 fit recipe; no probability retuning."""
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
SEED=290951
def calibrate(raw,y):
    z=logit(np.clip(raw,1e-6,1-1e-6));n=len(y)
    def fun(ab):
        a,b=ab;v=a*z+b;p=expit(v);e=p-y
        return np.mean(np.logaddexp(0,v)-y*v)+5/n*((a-1)**2+b*b),np.array([(e*z).mean()+10/n*(a-1),e.mean()+10/n*b])
    opt=minimize(fun,[1.,0.],jac=True,bounds=[(0,None),(None,None)],method='L-BFGS-B')
    if not opt.success:raise RuntimeError(opt.message)
    return opt.x

def training_masks(d,b):
    end=START+pd.Timedelta(weeks=b-1);calstart=end-pd.Timedelta(weeks=4);start=end-pd.Timedelta(weeks=52);margin=pd.Timedelta(minutes=1)
    ok=d.eligible&d.label.isin([-1,1]);base=ok&(d.ts>=start)&(d.settlement_ts<=calstart-margin);cal=ok&(d.ts>=calstart)&(d.settlement_ts<=end-margin)
    assert base.sum()>=2000 and cal.sum()>=500 and not (base&cal).any();return base,cal,end,calstart

def fit(d,x,s,b,pack):
    base,cal,end,calstart=training_masks(d,b);X=x.to_numpy(float);yb=(d.side==d.label).astype(int).to_numpy();xb=X[base]
    lo,med,hi=np.quantile(xb,[.001,.5,.999],axis=0);scaler=StandardScaler().fit(np.column_stack([np.clip(xb,lo,hi),np.zeros_like(xb)]));prep=dict(lower=lo,median=med,upper=hi,scaler=scaler)
    models=dict(ridge=LogisticRegression(C=.1,max_iter=1000,random_state=SEED),boost=HistGradientBoostingClassifier(max_iter=160,learning_rate=.04,max_leaf_nodes=7,min_samples_leaf=200,l2_regularization=20,early_stopping=False,random_state=SEED))
    bundle=dict(features=list(x.columns),models=models,prep=prep,calibrators={},second=s,block=b,pack=pack,fit_end=end.isoformat(),cal_start=calstart.isoformat(),base_last_settlement=d.loc[base,'settlement_ts'].max().isoformat(),cal_last_settlement=d.loc[cal,'settlement_ts'].max().isoformat(),base_rows=int(base.sum()),cal_rows=int(cal.sum()),protocol_sha256=sha(ROOT/'FINAL_SPEC.md'))
    with threadpool_limits(limits=1),warnings.catch_warnings():
        warnings.simplefilter('error',ConvergenceWarning)
        for name,m in models.items():
            m.fit(ridge_transform(xb,prep) if name=='ridge' else xb,yb[base]);raw=m.predict_proba(ridge_transform(X[cal],prep) if name=='ridge' else X[cal])[:,1];bundle['calibrators'][name]=calibrate(raw,yb[cal])
    return bundle
