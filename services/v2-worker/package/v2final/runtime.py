"""Small, offline decision engine. Existing gateway owns delivery and betting."""
from pathlib import Path
import hashlib,json,sqlite3
import numpy as np
import pandas as pd
import joblib
from .features import PRE,TECH,FEED,features_for_checkpoint
from .scoring import predict_bundle

MODEL_ID='v2-final-r1'
SLEEVES={'Direction8':('v2-direction8-r1',1.75),'Fade8':('v2-fade8-r1',2.20),'Direction45':('v2-direction45-r1',1.60)}

def admission(p8,q8,pfade,input_move_bps,gate_move_bps,p45=None,q45=None):
    """Vectorized historical policy; never uses labels or the future late call early."""
    p8=np.asarray(p8);c8=np.maximum(p8,1-p8);early=(c8>=q8)&(c8*1.75>=1.03)
    fade=(~early)&(np.asarray(pfade)>=.5)&(np.abs(input_move_bps)>=.5)&(np.sign(input_move_bps)==np.sign(gate_move_bps))&(np.abs(gate_move_bps)>=.5)
    sleeve=np.where(early,'Direction8',np.where(fade,'Fade8','ABSTAIN'))
    side=np.where(early,np.where(p8>=.5,1,-1),np.where(fade,-np.sign(input_move_bps),0)).astype(int)
    confidence=np.where(early,c8,np.where(fade,pfade,np.nan))
    if p45 is not None:
        p45=np.asarray(p45);c45=np.maximum(p45,1-p45);late=(sleeve=='ABSTAIN')&(c45>=q45)&(c45*1.6>=1.03)
        sleeve=np.where(late,'Direction45',sleeve);side=np.where(late,np.where(p45>=.5,1,-1),side);confidence=np.where(late,c45,confidence)
    return sleeve,side,confidence

class V2Final:
    def __init__(self,model_dir):
        self.root=Path(model_dir);self.schema=json.loads((self.root/'manifest.json').read_text())
        if self.schema['model_id']!=MODEL_ID:raise ValueError('Wrong model manifest')
        self.models={}
        for name,record in self.schema['models'].items():
            p=self.root/record['file']
            if hashlib.sha256(p.read_bytes()).hexdigest()!=record['sha256']:raise ValueError('Model hash mismatch')
            self.models[name]=joblib.load(p)
    def score(self,request):
        """Return an internal event; this is not a claim of webhook wire compatibility."""
        t=pd.Timestamp(request['target_open']);now=pd.Timestamp(request['decision_time']);pre=pd.Timestamp(request['preopen_asof']);received=pd.Timestamp(request['last_input_received_at'])
        if any(x.tzinfo is None for x in [t,now,pre,received]):raise ValueError('Timezone-aware timestamps required')
        sec=int(request['decision_second'])
        if sec not in [8,45] or t.value%900_000_000_000:raise ValueError('Invalid target or checkpoint')
        if request['feed']!=FEED:raise ValueError('Feed differs from the backtest')
        if not pd.Timestamp(self.schema['valid_from'])<=t<pd.Timestamp(self.schema['valid_until']):raise ValueError('Model is stale or not yet valid')
        if not t+pd.Timedelta(seconds=sec)<=now<t+pd.Timedelta(seconds=sec+1):raise ValueError('Checkpoint missed')
        if pre!=t-pd.Timedelta(milliseconds=1):raise ValueError('Pre-open snapshot is stale or late')
        tape=request['tape'];required=8 if sec==8 else 44;closes=np.asarray(request['close_time_ms'],np.int64)
        expected=t.value//1_000_000+np.arange(required)*1000+999
        if not np.array_equal(closes,expected):raise ValueError('Incomplete, stale or future opening tape')
        if not pd.Timestamp(closes[-1],unit='ms',tz='UTC')<=received<=now:raise ValueError('Invalid input receipt time')
        for k in ['open','high','low','close','volume','count','taker_buy_volume']:
            a=np.asarray(tape[k],float)
            if len(a)!=required or not np.isfinite(a).all():raise ValueError('Missing or invalid one-second bar')
        for k in ['open','high','low','close']:
            if np.any(np.asarray(tape[k])<=0):raise ValueError('Nonpositive price')
        for k in ['volume','count','taker_buy_volume']:
            if np.any(np.asarray(tape[k])<0):raise ValueError('Negative market activity')
        if np.any(np.asarray(tape['taker_buy_volume'])>np.asarray(tape['volume'])+1e-10):raise ValueError('Buy volume exceeds total')
        if set(request['preopen'])!=set(PRE+TECH):raise ValueError('Pre-open schema mismatch')
        if not np.isfinite(list(request['preopen'].values())).all():raise ValueError('Nonfinite pre-open feature')
        if set(request['scale'])!={'vol','meanvol','meancount'} or not all(np.isfinite(v) and v>0 for v in request['scale'].values()):raise ValueError('Invalid normalizer')
        direction,fade=features_for_checkpoint(request['preopen'],request['scale'],tape,sec)
        name='direction8' if sec==8 else 'direction45';bundle=self.models[name]
        x=np.array([[direction[k] for k in bundle['features']]])
        p=float(predict_bundle(bundle,x,'blend')['blend'][0]);conf=max(p,1-p);cut=bundle['cutoffs']['blend']['70'];odds=1.75 if sec==8 else 1.6
        sleeve='ABSTAIN';side=0;prob=conf
        if conf>=cut and conf*odds>=1.03:sleeve='Direction8' if sec==8 else 'Direction45';side=1 if p>=.5 else -1
        elif sec==8:
            b=self.models['fade8'];fp=float(predict_bundle(b,np.array([[fade[k] for k in b['features']]]),'blend')['blend'][0])
            op=tape['open'][0];move=(tape['close'][6]-op)/op*10000;gate=(tape['close'][7]-op)/op*10000
            if fp>=.5 and abs(move)>=.5 and abs(gate)>=.5 and np.sign(move)==np.sign(gate):sleeve='Fade8';side=int(-np.sign(move));prob=fp
        call=side!=0;model_id,odds=SLEEVES[sleeve] if call else (MODEL_ID,None)
        return dict(parent_model_id=MODEL_ID,model_id=model_id,target_open=t.isoformat(),target_ms=int(t.value//1_000_000),decision_second=sec,decision_time=now.isoformat(),sleeve=sleeve,side=side,direction='GREEN' if side==1 else 'RED' if side==-1 else 'ABSTAIN',confidence=prob,model_eligible=call,assumed_effective_odds=odds,execution_enabled=False,quote_verified=False,event_id=MODEL_ID+':'+str(t.value//1_000_000))

class DecisionStore:
    """Durable single-intent routing and an outbox. Consumers deduplicate event_id.

    Calls are committed before delivery. poll_pending/ack support retries without
    changing sleeve or creating a second candle intent. No network call occurs here.
    """
    def __init__(self,path,model):
        self.model=model;self.db=sqlite3.connect(path,timeout=30,isolation_level=None)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('CREATE TABLE IF NOT EXISTS decisions(target_ms INTEGER PRIMARY KEY, checkpoint INTEGER NOT NULL, called INTEGER NOT NULL, payload TEXT NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0)')
    def evaluate(self,request):
        key=int(pd.Timestamp(request['target_open']).value//1_000_000);sec=int(request['decision_second']);self.db.execute('BEGIN IMMEDIATE')
        try:
            prior=self.db.execute('SELECT checkpoint,called,payload FROM decisions WHERE target_ms=?',(key,)).fetchone()
            if prior and (prior[1] or prior[0]>=sec):
                out=json.loads(prior[2]);out.update(duplicate=True,should_emit=False);self.db.execute('COMMIT');return out
            if sec==45 and (prior is None or prior[0]!=8):raise ValueError('T+8 abstention record missing')
            out=self.model.score(request)
            self.db.execute('INSERT INTO decisions(target_ms,checkpoint,called,payload) VALUES(?,?,?,?) ON CONFLICT(target_ms) DO UPDATE SET checkpoint=excluded.checkpoint,called=excluded.called,payload=excluded.payload,acknowledged=0',(key,sec,int(out['model_eligible']),json.dumps(out)))
            self.db.execute('COMMIT');return {**out,'duplicate':False,'should_emit':out['model_eligible']}
        except Exception:self.db.execute('ROLLBACK');raise
    def poll_pending(self):return [json.loads(r[0]) for r in self.db.execute('SELECT payload FROM decisions WHERE called=1 AND acknowledged=0 ORDER BY target_ms')]
    def ack(self,event_id):
        for event in self.poll_pending():
            if event['event_id']==event_id:self.db.execute('UPDATE decisions SET acknowledged=1 WHERE target_ms=?',(event['target_ms'],));return
        raise KeyError(event_id)
    def close(self):self.db.close()
