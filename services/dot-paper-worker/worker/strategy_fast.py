"""Versioned 15-second BTC cash-spot paper hypothesis. No LLM or order calls.
The same streaming feature and decision implementation serves replay and forward.
"""
from pathlib import Path
from collections import deque
import math,json,hashlib
from typing import Mapping,Any,Sequence
STRATEGY_VERSION='DOT-BTC-SPOT-FLOW-0.1.0'
CONFIG_PATH=Path(__file__).with_name('strategy_fast_config.json')
CONFIG=json.loads(CONFIG_PATH.read_text());config=CONFIG
CONFIG_HASH=hashlib.sha256(CONFIG_PATH.read_bytes()).hexdigest()
STRATEGY_HASH=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()

class FlowWindow:
 """O(1) chronological state. Reset on invalid/gapped input; never impute."""
 def __init__(self,config=CONFIG):
  self.config=config;self.recent=deque();self.base=deque();self.base_sum=0.;self.compensation=0.;self.last_ms=None;self.features=None
 def _add(self,value):
  y=value-self.compensation;t=self.base_sum+y;self.compensation=(t-self.base_sum)-y;self.base_sum=t
 def update(self,row:Mapping[str,Any]):
  c=self.config
  try:
   t=int(row['open_ms']);end=int(row['close_ms'])
   if end!=t+c['timeframe_ms']-1 or (self.last_ms is not None and t!=self.last_ms+c['timeframe_ms']):raise ValueError('NONCONTIGUOUS')
   vals=[float(row[k]) for k in ['open','high','low','close','volume','quote_volume','taker_buy_quote_volume']]
   o,h,l,cl,v,q,b=vals
   if not all(math.isfinite(x) for x in vals) or not(0<l<=min(o,cl)<=max(o,cl)<=h) or not(0<=b<=q) or v<0:raise ValueError('INVALID_BAR')
   self.last_ms=t;self.recent.append((o,cl,q,b))
   if len(self.recent)>c['flow_bars']:
    old=self.recent.popleft();self.base.append(old[2]);self._add(old[2])
   if len(self.base)>c['baseline_bars']:self._add(-self.base.popleft())
   if len(self.base)<c['baseline_bars'] or len(self.recent)<c['flow_bars']:
    self.features={'valid':False,'reason':'WARMUP','decision_ms':end+1};return self.features
   q=math.fsum(r[2] for r in self.recent);b=math.fsum(r[3] for r in self.recent)
   if q<=0 or self.base_sum<=0:
    self.features={'valid':False,'reason':'ZERO_PARTICIPATION','decision_ms':end+1};return self.features
   self.features={'valid':True,'decision_ms':end+1,'imbalance':2*b/q-1,'volume_ratio':q/(c['flow_bars']*self.base_sum/c['baseline_bars']),'return_bps':(self.recent[-1][1]/self.recent[0][0]-1)*10000,'direction':1,'source':'executed_spot_taker_quote_volume','bar_count':c['flow_bars']+c['baseline_bars'],'strategy_version':STRATEGY_VERSION}
   return self.features
  except (KeyError,TypeError,ValueError,OverflowError,ZeroDivisionError) as e:
   self.__init__(c);self.features={'valid':False,'reason':'INVALID_INPUT:'+str(e)};return self.features
 def decide(self,position=None):return decide(self.features,position,self.config)

def decide(features,position=None,config=CONFIG):
 c=config;f=features or {'valid':False,'reason':'WARMUP'}
 out={'action':'ABSTAIN','reason':f.get('reason','WARMUP'),'stop_bps':c['stop_bps'],'target_bps':c['target_bps'],'max_hold_ms':c['max_hold_ms'],'signal':dict(f)}
 # A completed-bar clock remains usable for the independent time exit even
 # when current executed volume is zero. Missing/untrusted time is not invented.
 if position is not None and str(position.get('side','')).upper()=='LONG' and isinstance(f.get('decision_ms'),int) and f['decision_ms']-int(position['entry_ms'])>=c['max_hold_ms']:
  out.update(action='EXIT',reason='MAX_HOLD');return out
 if not f.get('valid'):return out
 if position is not None:
  if str(position.get('side','')).upper()!='LONG':out['reason']='INVALID_POSITION';return out
  if f['decision_ms']-int(position['entry_ms'])>=c['max_hold_ms']:out.update(action='EXIT',reason='MAX_HOLD')
  elif f['imbalance']<=-c['flow_exit_imbalance']:out.update(action='EXIT',reason='FLOW_REVERSAL')
  else:out['reason']='HOLD'
 elif f['imbalance']<c['min_imbalance']:out['reason']='WEAK_BUY_FLOW'
 elif f['volume_ratio']<c['min_volume_ratio']:out['reason']='LOW_PARTICIPATION'
 elif f['return_bps']<c['min_aligned_return_bps']:out['reason']='PRICE_NOT_CONFIRMED'
 elif f['return_bps']>c['max_aligned_return_bps']:out['reason']='CHASE_FILTER'
 else:out.update(action='LONG',reason='SPOT_FLOW_CONTINUATION')
 return out

def evaluate(closed_bars:Sequence[Mapping[str,Any]],position=None,config=CONFIG):
 w=FlowWindow(config)
 for row in closed_bars[-(config['baseline_bars']+config['flow_bars']):]:w.update(row)
 return w.decide(position)
