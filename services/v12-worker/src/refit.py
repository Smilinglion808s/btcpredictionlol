"""Original U's unchanged 21-day fit schedule. Offline labels never enter dispatch.

84-day lookback, one-day embargo, official settled outcomes, identical L/R
estimators and checkpoint sets. No return-based selection or threshold tuning.
"""
import hashlib,json,os,pickle,sqlite3,sys
from pathlib import Path
import numpy as np
import pandas as pd
from model import V12Model
from settlement_model import SettlementModel

ANCHOR=pd.Timestamp('2026-09-14',tz='UTC')
PERIOD=pd.Timedelta(days=21)
SOURCES={'L':(V12Model,(480,600,720)),'R':(SettlementModel,(120,180,300,480,600,720))}
RAW_FIELDS=['market_p','spread','second','previous_bid','previous_ask','z','sigma_min_bps','time_fraction',
 'log_vol','vol_ratio','vol_vs_pre','index_ret1','index_ret3','index_ret5','spot_flow1','spot_flow3',
 'perp_flow1','perp_flow3','flow_change','flow_gap','spot_index_gap1','perp_spot_gap1','perp_spot_gap3',
 'flow_price_residual','vwap_gap','path_efficiency','range_location','range_scaled','volume_rate_change',
 'feature_t45_quote_flow_45s','feature_t45_quote_flow_15s','feature_t45_close_vwap_gap_bps',
 'feature_t45_path_efficiency_45s','norm_feature_t45_last15_ret_bps','feature_t45_trade_count_last15_share']
SEED_FIELDS=['ts','ticker','label','settlement_ts','feature_valid','quote_valid',*RAW_FIELDS]

def period_start(now):
    now=pd.Timestamp(now)
    if now.tzinfo is None or now<ANCHOR:raise ValueError('INVALID_FIT_CLOCK')
    return ANCHOR+((now-ANCHOR)//PERIOD)*PERIOD

def training_slice(data,fit,source):
    fit=pd.Timestamp(fit)
    if fit!=period_start(fit):raise ValueError('OFF_SCHEDULE_FIT')
    cutoff=fit-pd.Timedelta(days=1)
    if data.duplicated(['ticker','second']).any():raise ValueError('DUPLICATE_TRAINING_ROW')
    mask=(data.ts.ge(fit-pd.Timedelta(days=84)) & data.ts.lt(cutoff) &
      data.settlement_ts.lt(cutoff) & data.settlement_ts.gt(data.ts) & data.label.isin([1,-1]) &
      data.second.isin(SOURCES[source][1]) & data.feature_valid.eq(True) & data.quote_valid.eq(True))
    if 'label_observed_at' in data:mask &= data.label_observed_at.isna() | data.label_observed_at.lt(cutoff)
    result=data[mask].sort_values(['ts','second']).copy()
    if result.ticker.nunique()<=1000:raise ValueError('INSUFFICIENT_TRAINING_MARKETS')
    return result

def atomic_bytes(path,raw):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix(path.suffix+'.tmp')
    with temp.open('wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
    os.replace(temp,path)

def load_history(seed_root,db_path=None):
    root=Path(seed_root);spec=json.loads((root/'training-seed.json').read_text())
    frames=[]
    for part in spec.get('parts',[spec]):
        raw=(root/part['file']).read_bytes()
        if hashlib.sha256(raw).hexdigest()!=part['sha256']:raise ValueError('TRAINING_SEED_HASH_MISMATCH')
        frames.append(pd.read_parquet(root/part['file']))
    data=pd.concat(frames,ignore_index=True)
    if db_path:
        with sqlite3.connect(db_path) as db:
            rows=db.execute('select s.frame,m.label,m.settlement_ts,m.observed_at from training_samples s join training_outcomes m on s.ticker=m.ticker').fetchall()
        live=[]
        for frame,label,settled,observed in rows:
            row=json.loads(frame);row.update(label=label,settlement_ts=settled,label_observed_at=observed);live.append(row)
        if live:data=pd.concat([data,pd.DataFrame(live)],ignore_index=True)
    for key in ('ts','settlement_ts','label_observed_at'):
        if key in data:data[key]=pd.to_datetime(data[key],utc=True)
    return data

def fit_models(data,fit,destination,check_freshness=True):
    fit=pd.Timestamp(fit);cutoff=fit-pd.Timedelta(days=1);root=Path(destination)
    manifest={'version':'original-u-'+fit.strftime('%Y%m%d'),'valid_from':fit.isoformat(),
      'expires_at':(fit+PERIOD).isoformat(),'training_cutoff':cutoff.isoformat(),
      'created_at':pd.Timestamp.now(tz='UTC').isoformat(),'models':{},'audit':{}}
    for source,(cls,_) in SOURCES.items():
        train=training_slice(data,fit,source)
        # Operational data-completeness checks, never a performance gate.
        recent=train[train.ts.ge(cutoff-pd.Timedelta(days=7))]
        if check_freshness and (train.settlement_ts.max()<cutoff-pd.Timedelta(days=1) or recent.ticker.nunique()<500):
            raise ValueError('RECENT_TRAINING_COVERAGE_INSUFFICIENT')
        fitted=cls().fit(train)
        sample=train[(train.previous_bid>0)&(train.previous_ask<1)&(train.previous_bid<=train.previous_ask)].tail(32)
        if len(sample)<16:raise ValueError('INSUFFICIENT_FIT_SMOKE_INPUTS')
        for values in fitted.predict(sample).values():
            if not np.isfinite(values).all() or not ((values>=0)&(values<=1)).all():raise ValueError('INVALID_FIT_PROBABILITIES')
        raw=pickle.dumps(fitted,protocol=5);name=source+'.pkl';atomic_bytes(root/name,raw)
        manifest['models'][source]={'file':name,'sha256':hashlib.sha256(raw).hexdigest()}
        manifest['audit'][source]={'rows':len(train),'markets':int(train.ticker.nunique()),
          'first':str(train.ts.min()),'last':str(train.ts.max()),'max_settlement':str(train.settlement_ts.max()),
          'recent_7d_markets':int(recent.ticker.nunique()),'inner':getattr(fitted,'inner_audit',[])}
    # This pointer appears only after BOTH models and all checks succeed.
    atomic_bytes(root/'manifest.json',json.dumps(manifest,indent=2).encode())
    return manifest

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--seed',required=True);p.add_argument('--db');p.add_argument('--fit',required=True);p.add_argument('--output',required=True)
    a=p.parse_args();fit=pd.Timestamp(a.fit)
    if pd.Timestamp.now(tz='UTC')<fit-pd.Timedelta(days=1)+pd.Timedelta(minutes=10):raise ValueError('TRAINING_CUTOFF_NOT_AVAILABLE')
    manifest=fit_models(load_history(a.seed,a.db),fit,a.output)
    print(json.dumps({'version':manifest['version'],'expires_at':manifest['expires_at'],'audit':manifest['audit']}),flush=True)
