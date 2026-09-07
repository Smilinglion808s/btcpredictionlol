"""Monthly prequential proxy models; never trained on Kalshi labels."""
from pathlib import Path
import argparse,hashlib,json,pickle
import numpy as np,pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier,HistGradientBoostingRegressor
ROOT=Path(__file__).resolve().parent
def digest(b): return hashlib.sha256(b).hexdigest()
def features(d):
    c=d.close; r=np.log(c/c.shift()); s=r.rolling(240,min_periods=240).std(ddof=0).clip(lower=1e-7)
    x={}
    for h in [1,5,15,60,240]:
        x[f'ret{h}']=(np.log(c/c.shift(h))/(s*np.sqrt(h))).clip(-20,20)
        v=d.volume.rolling(h,min_periods=h).sum()
        x[f'flow{h}']=(2*d.taker_buy.rolling(h,min_periods=h).sum()/v.where(v>0)-1).fillna(0)
    for h in [15,60]:
        x[f'volratio{h}']=np.log(r.rolling(h,min_periods=h).std(ddof=0).clip(lower=1e-7)/s).clip(-5,5)
        x[f'volumeratio{h}']=np.log(d.volume.rolling(h).mean().clip(lower=1e-6)/d.volume.rolling(240).mean().clip(lower=1e-6)).clip(-10,10)
        x[f'efficiency{h}']=(r.rolling(h).sum()/r.abs().rolling(h).sum().clip(lower=1e-12)).clip(-1,1)
    vwap=d.quote_volume/d.volume.where(d.volume>0)
    x['displacement']=(np.log(c/vwap)/(s*np.sqrt(15))).clip(-20,20)
    x['body']=(np.log(c/d.open)/s).clip(-20,20)
    x['location']=(2*(c-d.low)/(d.high-d.low).clip(lower=.01)-1).clip(-1,1)
    t=pd.to_datetime(d.open_time+60000,unit='ms',utc=True)
    mins=t.dt.hour*60+t.dt.minute
    x['clock_sin']=np.sin(2*np.pi*mins/1440);x['clock_cos']=np.cos(2*np.pi*mins/1440)
    x['dow_sin']=np.sin(2*np.pi*t.dt.dayofweek/7);x['dow_cos']=np.cos(2*np.pi*t.dt.dayofweek/7)
    out=pd.DataFrame(x)
    out.insert(0,'ts',t)
    out['sigma15']=s*np.sqrt(15)
    out['prior_close']=c;out['opening_vwap_proxy']=vwap
    out['source_last_close_ms']=d.close_time
    out['valid']=np.isfinite(out.select_dtypes('number')).all(axis=1)&d.volume.gt(0)
    return out.loc[(d.open_time+60000)%900000==0].reset_index(drop=True)
def dataset(d):
    f=features(d)
    vw=pd.Series((d.quote_volume/d.volume.where(d.volume>0)).to_numpy(),index=(d.open_time+60000).to_numpy())
    target_ms=f.ts.astype('int64')//1000000
    final=vw.reindex((target_ms+900000).to_numpy()).to_numpy()
    f['proxy_label']=np.where(np.isfinite(final),np.sign(final-f.opening_vwap_proxy),np.nan)
    f['proxy_scale_target']=np.log(.1+abs(np.log(final/f.prior_close))/f.sigma15)
    f['proxy_available_ns']=f.ts.astype('int64')+900_000_000_000
    return f
def run(f,end='2026-09-01',save=True):
    exclude=['ts','sigma15','prior_close','opening_vwap_proxy','source_last_close_ms','valid','proxy_label','proxy_scale_target','proxy_available_ns']
    cols=[c for c in f if c not in exclude]
    X=f[cols].to_numpy(float);valid=f.valid.to_numpy(bool)&np.isfinite(X).all(axis=1)
    ts=f.ts.astype('int64').to_numpy();avail=f.proxy_available_ns.to_numpy();y=f.proxy_label.to_numpy();target=f.proxy_scale_target.to_numpy()
    out=f[['ts','proxy_label','valid','sigma15','displacement','source_last_close_ms']].copy()
    for window in ['LONG','RECENT']:
        out[window+'_p']=np.nan;out[window+'_logscale']=np.nan
    fits=[]
    for month in pd.date_range('2025-03-01',pd.Timestamp(end)-pd.Timedelta(days=1),freq='MS',tz='UTC'):
        nxt=month+pd.offsets.MonthBegin(1)
        test=np.flatnonzero(valid&(ts>=month.value)&(ts<nxt.value))
        for window in ['LONG','RECENT']:
            tr=valid&(avail<month.value)&np.isin(y,[-1,1])&np.isfinite(target)
            if window=='RECENT': tr &= ts>=(month-pd.Timedelta(days=90)).value
            rows=np.flatnonzero(tr)
            if len(rows)<5000 or not len(test):continue
            params=dict(max_iter=100,learning_rate=.04,max_leaf_nodes=7,min_samples_leaf=256,l2_regularization=10,max_bins=64,random_state=85,early_stopping=False)
            classifier=HistGradientBoostingClassifier(**params).fit(X[rows],(y[rows]>0).astype(int))
            regressor=HistGradientBoostingRegressor(**params).fit(X[rows],target[rows])
            out.loc[test,window+'_p']=classifier.predict_proba(X[test])[:,1]
            out.loc[test,window+'_logscale']=regressor.predict(X[test])
            fits.append({'month':str(month),'window':window,'rows':len(rows),'train_first':str(f.ts.iloc[rows[0]]),'train_last':str(f.ts.iloc[rows[-1]]),'max_target_available_ns':int(avail[rows].max()),'fit_ns':month.value,'train_indices_hash':digest(rows.astype('<i8').tobytes()),'train_feature_hash':digest(X[rows].astype('<f8').tobytes()),'train_target_hash':digest(np.c_[y[rows],target[rows]].astype('<f8').tobytes())})
            if save:
                path=ROOT/'output'/'aux_models';path.mkdir(exist_ok=True)
                (path/f'{month:%Y%m}_{window}.pkl').write_bytes(pickle.dumps((cols,classifier,regressor)))
            print('aux',month.strftime('%Y-%m'),window,len(rows),flush=True)
    if save:
        out.to_parquet(ROOT/'output'/'auxiliary_predictions.parquet',index=False)
        (ROOT/'output'/'auxiliary_fits.json').write_text(json.dumps({'features':cols,'fits':fits},indent=2))
    return out,fits
if __name__=='__main__':
    d=pd.read_parquet(ROOT/'minutes.parquet'); f=dataset(d)
    f.to_parquet(ROOT/'output'/'proxy_dataset.parquet',index=False)
    run(f)
