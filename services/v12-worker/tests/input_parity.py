"""Rebuild live input functions against the original archived observations."""
import sys,io,zipfile,json
from pathlib import Path
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from features import build_state
from capture import early_features

root=Path(sys.argv[1]);raw=root/'data/later_raw'
def read(kind,day=None):
    frames=[]
    for p in sorted(raw.glob(kind+'_*.zip')):
        if day and day not in p.name:continue
        with zipfile.ZipFile(p) as z:payload=z.read(z.namelist()[0])
        a=pd.read_csv(io.BytesIO(payload),header=None,skiprows=int(payload[:1].isalpha()))
        a.columns=['open_time','open','high','low','close','volume','close_time','quote_volume','count','taker_buy_volume','taker_buy_quote_volume','ignore']
        a['ts']=pd.to_datetime(a.open_time,unit='us' if int(a.open_time.iloc[0])>10**14 else 'ms',utc=True)
        frames.append(a)
    return pd.concat(frames).set_index('ts').sort_index()

old=pd.read_parquet(root/'data/later_inputs.parquet')
ref=old[['ts','ticker','floor_strike']].drop_duplicates().sort_values('ts').reset_index(drop=True)
ix,s,per=[read(k) for k in ('indexusd','spot','perp')]
clock=pd.date_range('2026-08-27','2026-09-17',freq='min',tz='UTC',inclusive='left')
new=build_state(ix.reindex(clock),s.reindex(clock),per.reindex(clock),ref)
joined=new.merge(old,on=['ticker','second'],suffixes=('_new','_old'),validate='one_to_one')
fields=[c for c in new if c not in ('ts','ticker','second','row_id','floor_strike') and c in old]
for c in fields:
    assert np.allclose(joined[c+'_new'].to_numpy(float),joined[c+'_old'].to_numpy(float),rtol=1e-10,atol=1e-10,equal_nan=True),c

early=pd.read_parquet(root/'data/later_early_features.parquet').sort_values('ts')
legacy=pd.read_parquet(root/'data/early_feature_reference.parquet').sort_values('ts')
ctx='ctx_binance_spot_t0_w900_return_bps'
seq=pd.concat([legacy.loc[legacy.ts.lt(early.ts.min()),['ts',ctx]],early[['ts',ctx]]]).sort_values('ts')
seconds=read('spot1s','2026-09-15')
checked=0
for row in early[early.ts.dt.strftime('%Y-%m-%d').eq('2026-09-15')].itertuples():
    history=seq.loc[seq.ts.le(row.ts),ctx].tail(96).tolist()
    values=early_features(seconds.loc[row.ts:row.ts+pd.Timedelta(seconds=44)],history)
    for key,value in values.items():
        assert np.isclose(value,getattr(row,key),rtol=1e-10,atol=1e-10),key
    checked+=1
print(json.dumps({'minute_rows':len(joined),'minute_fields':len(fields),'early_targets':checked,'pass':True}))
