"""Settlement-aware Lite A research admission guard; standard library only.

The caller supplies the UNCHANGED Lite A candidate and its causal confidence
rank. This is neither a probability model nor a raw-feed predictor. No network
or execution client is present, and every returned record disables execution.
"""
from datetime import datetime, timezone
import hashlib
import json
import math
from zoneinfo import ZoneInfo

BOISE=ZoneInfo('America/Boise')


def time_utc(t):
    d=t if isinstance(t,datetime) else datetime.fromisoformat(str(t).replace('Z','+00:00'))
    if d.tzinfo is None:raise ValueError('Aware time required')
    return d.astimezone(timezone.utc)


def canonical(obj):return json.dumps(obj,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def checksum(obj):return hashlib.sha256(canonical(obj)).hexdigest()


class DailyFloor:
    def __init__(self, exception_rank=None):
        if exception_rank not in (None,.90):raise ValueError('Only the locked 0.90 exception is implemented')
        self.exception_rank=exception_rank
        self.days={};self.pending={};self.clock=None
        self.last_target=None;self.last_input=None;self.last_output=None

    def settle(self,ticker,label,*,available_at,observed_at):
        available,now=time_utc(available_at),time_utc(observed_at)
        if label not in (-1,1) or available>now:raise ValueError('Invalid/future settlement')
        if self.clock and now<time_utc(self.clock):raise ValueError('Observed time regressed')
        call=self.pending.get(ticker)
        if call and available<=time_utc(call['observed_at']):raise ValueError('Settlement predates call')
        self.clock=now.isoformat()
        if call is None:return False
        self.pending.pop(ticker)
        day=self.days[call['day']]
        day['pending']-=1
        day['pnl_hundredths']+=87 if call['direction']==label else -100
        return True

    def decide(self,*,target,ticker,candidate,rank,observed_at):
        target,now=time_utc(target),time_utc(observed_at)
        if (now-target).total_seconds()<5:raise ValueError('T+5 window not complete')
        if candidate not in (-1,0,1):raise ValueError('Invalid candidate encoding')
        if rank is not None and (not math.isfinite(rank) or not 0<=rank<=1):raise ValueError('Invalid rank')
        if candidate and (rank is None or rank<.638):raise ValueError('Candidate violates Lite A confidence gate')
        key={'target':target.isoformat(),'ticker':ticker,'candidate':candidate,'rank':rank}
        if self.last_target==target.isoformat():
            if key!=self.last_input:raise ValueError('Changed duplicate')
            return json.loads(canonical(self.last_output))
        if self.last_target and target<=time_utc(self.last_target):raise ValueError('Target order')
        if self.clock and now<time_utc(self.clock):raise ValueError('Observed time regressed')
        if ticker in self.pending:raise ValueError('Ticker already pending')
        self.clock=now.isoformat()
        day=target.astimezone(BOISE).date().isoformat()
        self.days={k:v for k,v in self.days.items() if k==day or v['pending']}
        state=self.days.setdefault(day,{'pnl_hundredths':0,'pending':0})
        before=dict(state)
        floor_allows=state['pnl_hundredths']-100*(state['pending']+1)>=-400
        exception=bool(candidate and not floor_allows and self.exception_rank is not None and rank>=self.exception_rank)
        prediction=candidate if candidate and (floor_allows or exception) else 0
        reason='BASE_NO_CALL' if not candidate else ('HIGH_CONFIDENCE_EXCEPTION' if exception else
                 ('ORDINARY_CALL' if prediction else 'DAILY_FLOOR_ABSTAIN'))
        if prediction:
            state['pending']+=1
            self.pending[ticker]={'day':day,'direction':candidate,'observed_at':now.isoformat(),'exception':exception}
        out={**key,'observed_at':now.isoformat(),'prediction':prediction,'reason':reason,
             'risk_before':before,'ordinary_floor_allows':floor_allows,'exception':exception,
             'model_id':'lite-a-floor4-top10-r1' if self.exception_rank is not None else 'lite-a-floor4-r1',
             'execution_enabled':False}
        self.last_target=target.isoformat();self.last_input=key;self.last_output=out
        return json.loads(canonical(out))

    def snapshot(self):
        s={'schema':1,'exception_rank':self.exception_rank,'days':self.days,'pending':self.pending,
           'clock':self.clock,'last_target':self.last_target,'last_input':self.last_input,'last_output':self.last_output}
        return {'state':json.loads(canonical(s)),'sha256':checksum(s)}

    @classmethod
    def restore(cls,obj):
        s=obj['state']
        if obj['sha256']!=checksum(s) or s['schema']!=1:raise ValueError('Checkpoint checksum/schema')
        e=cls(s['exception_rank'])
        for k in ['days','pending','clock','last_target','last_input','last_output']:
            setattr(e,k,json.loads(canonical(s[k])))
        for day,x in e.days.items():
            if x['pending']!=sum(v['day']==day for v in e.pending.values()):raise ValueError('Pending count mismatch')
        return e
