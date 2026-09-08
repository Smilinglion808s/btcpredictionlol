import sys, numpy as np, pandas as pd
sys.path.insert(0,'/dev-server/services/c85-worker')
from src import features as F

K='/dev-server/services/c85-worker/evaluation-fixtures/cache/kit/fixtures/'
up=pd.read_parquet(K+'upstream_packet.parquet')
d60=pd.read_parquet(K+'direction60.parquet')
m55=pd.read_parquet(K+'meta55.parquet')
hv=pd.read_parquet(K+'head_validity.parquet')
ref=pd.read_parquet(K+'reference_predictions.parquet')
print('ref cols', [c for c in ref.columns][:40])

# direction
mine=F.build_direction_features(up)
same = np.allclose(mine.to_numpy(float), d60[F.DIRECTION_ORDER].to_numpy(float), equal_nan=True)
print('direction60 exact:', same, mine.shape)
if not same:
    diff=[c for c in F.DIRECTION_ORDER if not np.allclose(mine[c].to_numpy(float), d60[c].to_numpy(float), equal_nan=True)]
    print('mismatch cols', diff[:10])

aux=pd.read_parquet(K+'auxiliary_scores.parquet')
print('aux cols',list(aux.columns))
py=ref.probability_yes.to_numpy(float); prop=ref.proposal.to_numpy(np.int8)
lg=F.auxiliary_logits(aux)
mymeta=F.build_meta_features(up, py, prop, lg)
ok=np.allclose(mymeta.to_numpy(float), m55[F.META_ORDER].to_numpy(float), equal_nan=True)
print('meta55 exact:', ok, mymeta.shape)
if not ok:
    bad=[c for c in F.META_ORDER if not np.allclose(mymeta[c].to_numpy(float), m55[c].to_numpy(float), equal_nan=True)]
    print('mismatch', bad[:12])

lgd=lg[['LONG_logit','LONG_logscale','RECENT_logit','RECENT_logscale']]
sok=F.auxiliary_source_ok(aux, up.ts, lgd)
print('source_ok exact:', bool((sok==ref.source_ok.to_numpy(bool)).all()), int(sok.sum()))
cv=F.core_valid(up, sok)
print('core_valid exact:', bool((cv==ref.core_valid.to_numpy(bool)).all()), int(cv.sum()))
print('head_validity cols', list(hv.columns))
print('direction_valid match:', bool((hv.direction_valid.to_numpy(bool)==(up.binance_complete.to_numpy(bool)&F.frame_anchor_valid(up).to_numpy(bool)&F.cm_valid(up))).all()))
