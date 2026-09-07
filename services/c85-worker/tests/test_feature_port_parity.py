"""End-to-end reference gate driven by the PORTED feature builders."""
import sys, json
from pathlib import Path
import numpy as np, pandas as pd
K=Path('/tmp/c85/kit')
sys.path.insert(0,str(K/'reference')); sys.path.insert(0,'/dev-server/services/c85-worker')
from reliability import portable_probability, policy
from src import features as F

up=pd.read_parquet(K/'fixtures/upstream_packet.parquet')
frame=pd.read_parquet(K/'fixtures/policy_frame.parquet')
valid=pd.read_parquet(K/'fixtures/head_validity.parquet')
original=pd.read_parquet(K/'fixtures/reference_predictions.parquet')
aux=pd.read_parquet(K/'fixtures/auxiliary_scores.parquet')

# 1. direction matrix from the ported builder
D=F.build_direction_features(up)
p_dir=np.full(len(frame),np.nan)
for path in sorted((K/'models/C71_DIRECTION').glob('*.json')):
    m=json.loads(path.read_text())
    ix=np.arange(m['prediction_start_row'],m['prediction_end_row_exclusive'])
    ix=ix[valid.direction_valid.to_numpy(bool)[ix]]
    p_dir[ix]=portable_probability(D.iloc[ix],m)
np.testing.assert_allclose(p_dir,frame.C85_probability_yes,atol=1e-12,rtol=0,equal_nan=True)
proposal=F.direction_from_probability(p_dir)
np.testing.assert_array_equal(proposal,frame.C85_proposal)

# 2. meta matrix from the ported builder, chained off our own proposal
M=F.build_meta_features(up,p_dir,proposal,F.auxiliary_logits(aux))
p_meta=np.full(len(frame),np.nan)
for path in sorted((K/'models/C85_META').glob('*.json')):
    m=json.loads(path.read_text())
    ix=np.arange(m['prediction_start_row'],m['prediction_end_row_exclusive'])
    ix=ix[valid.meta_valid.to_numpy(bool)[ix]]
    p_meta[ix]=portable_probability(M.iloc[ix],m)
np.testing.assert_allclose(p_meta,frame.C85_probability_correct,atol=1e-12,rtol=0,equal_nan=True)

# 3. online policy
g,state=policy(frame,p_meta)
for c in ['prediction','base_prediction','core','extension','proposal','rank','filter_rank','filter_count','weak','latest_state_ns']:
    np.testing.assert_array_equal(g[c],original[c])
calls=int(g.prediction.ne(0).sum());wins=int((g.prediction.ne(0)&g.prediction.eq(g.label)).sum());losses=calls-wins
assert (len(frame),calls,wins,losses)==(19487,6794,4083,2711)
print(json.dumps({'status':'PASS','source':'ported features.py','rows':len(frame),'calls':calls,'wins':wins,'losses':losses,'raw_net':wins-losses,'decision_mismatches':0}))
