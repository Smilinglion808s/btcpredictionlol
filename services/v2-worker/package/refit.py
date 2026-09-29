"""Fit a new versioned three-bundle directory at a scheduled four-week boundary."""
import os
for k in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS']:os.environ[k]='1'
import argparse,json,hashlib
from pathlib import Path
import pandas as pd
import joblib
from v2final.training_direction import fit_bundle
from v2final.training_fade import fit
START=pd.Timestamp('2024-09-16',tz='UTC')
def main():
    p=argparse.ArgumentParser();p.add_argument('--cutoff',required=True);p.add_argument('--data',required=True);p.add_argument('--output',required=True);a=p.parse_args();end=pd.Timestamp(a.cutoff)
    if end.tzinfo is None:raise ValueError('Cutoff must include UTC offset')
    n=(end-START)/pd.Timedelta(weeks=4)
    if n<0 or n!=int(n):raise ValueError('Not a scheduled four-week boundary')
    block=1+4*int(n);root=Path(a.data);out=Path(a.output)
    if out.exists():raise ValueError('Use a new model directory; existing artifacts are preserved')
    labels=pd.read_parquet(root/'inputs/labels.parquet');clock=pd.read_parquet(root/'inputs/fade_clock.parquet')
    if not labels.ts.equals(clock.ts):raise ValueError('Training clocks do not match')
    if labels.settlement_ts.max()<end:raise ValueError('Data do not reach the requested cutoff')
    if not labels.ts.is_unique or not labels.ts.is_monotonic_increasing:raise ValueError('Training clock not ordered and unique')
    features={name:pd.read_parquet(root/f'features/{name}.parquet') for name in ['direction8','fade8','direction45']}
    if any(len(x)!=len(labels) for x in features.values()):raise ValueError('Feature clock length mismatch')
    models={name:fit(clock,x,8,block,'technical') if name=='fade8' else fit_bundle(labels,x,8 if name=='direction8' else 45,52,block,'support_only') for name,x in features.items()}
    out.mkdir(parents=True);manifest=dict(model_id='v2-final-r1',feed='binance-spot-btcusdt',valid_from=end.isoformat(),valid_until=(end+pd.Timedelta(weeks=4)).isoformat(),models={})
    for name,b in models.items():
        path=out/(name+'.joblib');joblib.dump(b,path,compress=3);manifest['models'][name]=dict(file=path.name,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),features=b['features'],fit_end=b['fit_end'],base_last_settlement=b['base_last_settlement'],cal_last_settlement=b['cal_last_settlement'])
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2));print(out)
if __name__=='__main__':main()
