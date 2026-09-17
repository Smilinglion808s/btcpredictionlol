"""Original U shadow service. Public data + signed recording adapter; no orders.

One process per SQLite volume. Restart may recover completed bars, but never
recreates missing historical quote snapshots or sends expired checkpoints.
"""
import hashlib,hmac,json,os,threading,time,uuid,urllib.request
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import numpy as np
import pandas as pd
from capture import Capture,get
from features import build_state
from policy import CHECKPOINTS,arrival_admissible
from scorer import Scorer

VERSION='v12-original-u-4-5-10-r1'
ROUTES={'V1':('v12-v1-r1',.04,'maker_only'),'T45R2':('v12-t45r2-r1',.05,'taker_only'),'U':('v12-original-u-r1',.10,'maker_only')}
def iso(ms):return pd.Timestamp(ms,unit='ms',tz='UTC').isoformat(timespec='milliseconds').replace('+00:00','Z')
def millis():return int(time.time()*1000)

class Adapter:
    def __init__(self):
        self.url=os.environ.get('V12_SHADOW_ADAPTER_URL','')
        self.secret=os.environ.get('C85_GATEWAY_SECRET','')
        if self.url and (not self.url.startswith('https://') or not self.url.endswith('/api/public/hooks/v12-shadow')):
            raise ValueError('INVALID_RECORDING_ADAPTER_URL')
    def call(self,op,open_ms,**data):
        if not self.url or not self.secret:raise ValueError('SHADOW_ADAPTER_NOT_CONFIGURED')
        body=json.dumps({'op':op,'open':iso(open_ms),'nonce':uuid.uuid4().hex,**data},separators=(',',':'),allow_nan=False).encode()
        ts=str(millis());sig=hmac.new(self.secret.encode(),ts.encode()+b'.'+body,hashlib.sha256).hexdigest()
        req=urllib.request.Request(self.url,data=body,headers={'content-type':'application/json','x-c85-timestamp':ts,'x-c85-signature':sig},method='POST')
        with urllib.request.urlopen(req,timeout=4) as r:result=json.load(r)
        if result.get('ok') is not True:raise ValueError('ADAPTER_REJECTED')
        return result

def payload(route,context,decision_ms,**extra):
    model,fraction,execution=ROUTES[route];open_ms=int(pd.Timestamp(context['open']).timestamp()*1000)
    return {'mode':'shadow','model_version':model,'combined_model_version':VERSION,'leg':route,
      'execution_policy':execution,'stake_fraction_of_boise_day_opening_principal':fraction,
      'market':context['ticker'],'candle_starts_at':iso(open_ms),'decision_at':iso(decision_ms),'sent_at':iso(millis()),
      'interval_key':f"v12:{context['ticker']}:{iso(open_ms)}",**extra}

def score_checkpoint(capture,scorer,context,market,second,now_ms):
    open_ms=int(pd.Timestamp(context['open']).timestamp()*1000);boundary=open_ms+second*1000
    if not boundary<=now_ms<=boundary+5000:raise ValueError('CHECKPOINT_EXPIRED')
    if not context.get('u_eligible') or not context.get('early'):raise ValueError('U_CONTEXT_NOT_READY')
    if market.get('ticker')!=context['ticker'] or int(pd.Timestamp(market['close_time']).timestamp()*1000)!=open_ms+900000:
        raise ValueError('MARKET_INTERVAL_MISMATCH')
    strike=market.get('floor_strike')
    if not isinstance(strike,(int,float)) or not np.isfinite(strike) or strike<=0:raise ValueError('OFFICIAL_STRIKE_UNAVAILABLE')
    # One extra preceding minute supplies the first return of the 1440m window.
    frames=[capture.frame(k,open_ms-1441*60000,boundary,now_ms) for k in ('index','spot','perp')]
    expected=pd.date_range(pd.Timestamp(open_ms-1441*60000,unit='ms',tz='UTC'),pd.Timestamp(boundary,unit='ms',tz='UTC'),freq='min',inclusive='left')
    if any(not f.index.equals(expected) for f in frames):raise ValueError('COMPLETED_MINUTES_NOT_READY')
    ref=pd.DataFrame([{'ts':pd.Timestamp(open_ms,unit='ms',tz='UTC'),'ticker':context['ticker'],'floor_strike':strike}])
    f=build_state(*frames,ref,checkpoints=(second,))
    _,bid,ask=capture.boundary_quote(context['ticker'],boundary)
    _,previous_bid,previous_ask=capture.boundary_quote(context['ticker'],boundary-60000)
    additions={**context['early'],'yes_bid':bid,'yes_ask':ask,'no_ask':1-bid,'previous_bid':previous_bid,
      'previous_ask':previous_ask,'market_p':(bid+ask)/2,'spread':ask-bid,'quote_valid':True,'decision_ts':pd.Timestamp(boundary,unit='ms',tz='UTC')}
    for k,v in additions.items():f[k]=v
    f['feature_valid']=f.valid & np.isfinite(f[['z','spot_flow1','perp_flow1','vwap_gap','sigma_min_bps']]).all(axis=1)
    chosen,rows=scorer.score(f,pd.Timestamp(now_ms,unit='ms',tz='UTC'))
    return chosen,rows

class Service:
    def __init__(self):
        if os.environ.get('V12_MODE','shadow')!='shadow':raise ValueError('SHADOW_ONLY_BINARY')
        self.path=os.environ.get('V12_CAPTURE_DB','/data/v12/capture.sqlite')
        Path(self.path).parent.mkdir(parents=True,exist_ok=True)
        self.adapter=Adapter();self.scorer=Scorer();self.ticker=None
        self.status={'mode':'shadow','execution_enabled':False,'stage':'STARTING','fit_expires_at':self.scorer.manifest['expires_at']}
    def bars_loop(self,stream):
        cap=Capture(self.path);cursor=millis()//900000*900000-1441*60000
        while True:
            try:
                end=millis()//60000*60000
                cap.fetch_bars(stream,cursor,end)
                count=cap.db.execute('select count(*) from bars where stream=? and open_ms>=? and open_ms<?',(stream,cursor,end)).fetchone()[0]
                if count!=(end-cursor)//60000:raise ValueError('MISSING_MINUTE_HISTORY')
                cursor=max(cursor,end-2*60000)
                self.status[stream+'_complete_through']=iso(end)
            except Exception as e:self.status[stream+'_error']=type(e).__name__
            time.sleep(.5 if millis()%60000<5000 else 3)
    def quotes_loop(self):
        cap=Capture(self.path)
        while True:
            try:
                if self.ticker:
                    q=cap.sample_quote(self.ticker);self.status['quote_received_at']=iso(q['received_ms'])
            except Exception as e:self.status['quote_error']=type(e).__name__
            time.sleep(.45)
    def run(self):
        for stream in ('index','spot','perp'):threading.Thread(target=self.bars_loop,args=(stream,),daemon=True).start()
        threading.Thread(target=self.quotes_loop,daemon=True).start()
        cap=Capture(self.path);last_open=None;market=None
        while True:
            now=millis();open_ms=now//900000*900000
            try:
                if last_open!=open_ms:
                    self.ticker=None;market=None;last_open=open_ms
                context=self.adapter.call('context',open_ms)['context']
                if not context.get('ready'):raise ValueError(context.get('reason','CONTEXT_NOT_READY'))
                self.ticker=context['ticker'];age=now-open_ms
                self.status.update(stage='RECORDING',ticker=self.ticker,last_context_at=iso(millis()))
                # Poll committed early decisions outside their critical dispatch path.
                for route,key,side_key,offset_key,slot in [('V1','v1','final_side','publication_offset_ms',-1),('T45R2','t45','side','decision_offset_ms',-45)]:
                    r=context.get(key) or {};side=r.get(side_key);offset=r.get(offset_key)
                    if side not in (1,-1) or not isinstance(offset,(int,float)) or age>60000:continue
                    if route=='T45R2' and (r.get('leg')!='T45R2' or r.get('run_mode')!='LIVE_SHADOW'):continue
                    decision=open_ms+int(offset)
                    if millis()-decision>8000:continue
                    if cap.db.execute('select 1 from attempts where ticker=? and checkpoint=?',(self.ticker,slot)).fetchone():continue
                    p=payload(route,context,decision,prediction='YES' if side==1 else 'NO')
                    # Persist before network. Ambiguous requests are not retried after restart.
                    self.record(cap,slot,'SUBMITTING',{})
                    result=self.adapter.call('publish',open_ms,signal=p)
                    self.record(cap,slot,'RECORDED',result)
                if not context.get('u_eligible'):time.sleep(.7);continue
                if market is None:market=get('https://api.elections.kalshi.com/trade-api/v2/markets/'+self.ticker)['market']
                for sec in CHECKPOINTS:
                    age=millis()-open_ms
                    if age<sec*1000 or cap.db.execute('select 1 from attempts where ticker=? and checkpoint=?',(self.ticker,sec)).fetchone():continue
                    if cap.db.execute("select 1 from attempts where ticker=? and status in ('U_SUBMITTING','U_RECORDED')",(self.ticker,)).fetchone():break
                    if age>sec*1000+5000:self.record(cap,sec,'MISSED_CHECKPOINT',{});continue
                    chosen,rows=score_checkpoint(cap,self.scorer,context,market,sec,millis())
                    if chosen is None:self.record(cap,sec,'ABSTAIN',{});continue
                    arrival=cap.sample_quote(self.ticker)
                    ask=arrival['yes_ask'] if chosen.side==1 else 1-arrival['yes_bid']
                    if not arrival_admissible(chosen,ask,True):self.record(cap,sec,'PRICE_REJECTED',chosen.payload());continue
                    decision=millis()
                    if decision>open_ms+sec*1000+5000:self.record(cap,sec,'EXPIRED_AFTER_SCORE',{});continue
                    p=payload('U',context,decision,prediction='YES' if chosen.side==1 else 'NO',checkpoint_seconds=sec,
                      v11_eligibility=context['eligibility'],limit_all_in=chosen.limit_all_in,u_source=chosen.source,
                      probability=chosen.probability,known_ask=chosen.known_ask,arrival_ask=ask,fit_version=self.scorer.manifest['version'])
                    self.record(cap,sec,'U_SUBMITTING',p)
                    result=self.adapter.call('publish',open_ms,signal=p)
                    self.record(cap,sec,'U_RECORDED',result)
            except Exception as e:
                # Do not log credentials, request bodies or remote error pages.
                self.status.update(stage='WAITING',last_error=str(e) if isinstance(e,ValueError) else type(e).__name__)
            time.sleep(.5)
    def record(self,cap,checkpoint,status,details):
        cap.db.execute('insert or replace into attempts values(?,?,?,?)',(self.ticker,checkpoint,status,json.dumps(details,allow_nan=False)))
        cap.db.commit();self.status['last_attempt']={'ticker':self.ticker,'checkpoint':checkpoint,'status':status}

def main():
    service=Service()
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path!='/healthz':self.send_error(404);return
            data=json.dumps(service.status).encode();self.send_response(200)
            self.send_header('content-type','application/json');self.end_headers();self.wfile.write(data)
        def log_message(self,*args):pass
    threading.Thread(target=service.run,daemon=True).start()
    ThreadingHTTPServer(('0.0.0.0',int(os.environ.get('PORT','8080'))),Handler).serve_forever()

if __name__=='__main__':main()
