"""Hash-pinned frozen estimators. Refuse expired fits; never train on a request."""
from pathlib import Path
import hashlib,json,pickle
import pandas as pd
import model,settlement_model  # trusted frozen pickle module bindings
from policy import choose

class Scorer:
    def __init__(self,root=None):
        self.root=Path(root) if root else Path(__file__).resolve().parents[1]/'artifacts'
        self.manifest=json.loads((self.root/'manifest.json').read_text())
        self.models={}
        for source in ('L','R'):
            spec=self.manifest['models'][source];raw=(self.root/spec['file']).read_bytes()
            if hashlib.sha256(raw).hexdigest()!=spec['sha256']:raise ValueError('MODEL_HASH_MISMATCH')
            self.models[source]=pickle.loads(raw)
    def score(self,frame,now):
        now=pd.Timestamp(now)
        if now.tzinfo is None:raise ValueError('TIMEZONE_REQUIRED')
        if not pd.Timestamp(self.manifest['valid_from'])<=now<pd.Timestamp(self.manifest['expires_at']):raise ValueError('MODEL_EXPIRED_OR_NOT_YET_VALID')
        if len(frame)!=1 or not frame.feature_valid.iloc[0] or not frame.quote_valid.iloc[0]:raise ValueError('INVALID_FEATURE_FRAME')
        # The caller must construct point-in-time features; target labels and
        # future quote/settlement fields have no role in estimator prediction.
        if pd.Timestamp(frame.decision_ts.iloc[0])>now:raise ValueError('FUTURE_FEATURE_FRAME')
        rows={}
        for source,m in self.models.items():
            row=frame.iloc[0].to_dict()
            if source=='L' and row['second'] not in (480,600,720):continue
            for key,value in m.predict(frame).items():row['p_'+key]=float(value[0])
            rows[source]=row
        return choose(rows.get('L'),rows.get('R')),rows
