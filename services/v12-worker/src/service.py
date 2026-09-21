"""Original U shadow service. Public data + signed recording adapter; no orders.

One process per SQLite volume. Restart may recover completed bars, but never
recreates missing historical quote snapshots or sends expired checkpoints.
"""
import hashlib,hmac,http.client,json,os,threading,time,uuid,urllib.request,urllib.error,subprocess,sys
from urllib.parse import urlsplit

from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import numpy as np
import pandas as pd
from capture import Capture,get
from features import build_state
from policy import CHECKPOINTS,arrival_admissible
from scorer import Scorer
from refit import period_start,PERIOD
import training_capture

VERSION='v12-original-u-4-5-10-r1'
ROUTES={'V1':('v12-v1-r1',.04,'maker_then_taker'),'T45R2':('v12-t45r2-r1',.05,'taker_only'),'U':('v12-original-u-r1',.10,'maker_then_taker')}
def iso(ms):return pd.Timestamp(ms,unit='ms',tz='UTC').isoformat(timespec='milliseconds').replace('+00:00','Z')
def millis():return int(time.time()*1000)
HEARTBEAT_SECONDS=15
BLOCKED_STATUSES={403,418,429,451}
BLOCKED_BACKOFF_SECONDS=30
BACKEND_ADAPTER='https://alevdzyisibxcvwoyrqb.supabase.co/functions/v1/v12-shadow-adapter'
WEBSITE_ADAPTER='https://btcpredictionlol.lovable.app/api/public/hooks/v12-shadow'
def http_status(error):return error.code if isinstance(error,urllib.error.HTTPError) else None
def error_label(error):
    # Type name plus numeric status only; never the remote response body.
    code=http_status(error)
    return type(error).__name__+(':'+str(code) if code is not None else '')
def blocked_backoff(error):
    code=http_status(error)
    return BLOCKED_BACKOFF_SECONDS if code in BLOCKED_STATUSES else 0
def adapter_backoff(error):
    # Signed adapter rejections surface as ADAPTER_HTTP_<code>; throttle blocked statuses.
    text=str(error)
    if isinstance(error,ValueError) and text.startswith('ADAPTER_HTTP_'):
        suffix=text[len('ADAPTER_HTTP_'):]
        if suffix.isdigit() and int(suffix) in BLOCKED_STATUSES:return BLOCKED_BACKOFF_SECONDS
    return blocked_backoff(error)

KEEPALIVE_IDLE_SECONDS=25

class _Clients(threading.local):
    """One persistent TLS client per calling thread. Threads never share one."""
    def __init__(self):self.conn=None;self.used=0.0

class Adapter:
    def __init__(self):
        self.url=os.environ.get('V12_SHADOW_ADAPTER_URL','')
        self.secret=os.environ.get('C85_GATEWAY_SECRET','')
        if self.url and self.url not in (BACKEND_ADAPTER,WEBSITE_ADAPTER):
            raise ValueError('INVALID_RECORDING_ADAPTER_URL')
        parts=urlsplit(self.url) if self.url else None
        self.host=parts.hostname if parts else None
        self.port=parts.port if parts else None
        self.path=((parts.path or '/')+(('?'+parts.query) if parts and parts.query else '')) if parts else '/'
        self._clients=_Clients()
    def _client(self):
        # Reuse the warm TLS session; drop it well before a server idle close so
        # a reused socket does not fail after a non-idempotent request was sent.
        store=self._clients
        if store.conn is not None and time.time()-store.used>KEEPALIVE_IDLE_SECONDS:self._drop()
        if store.conn is None:store.conn=http.client.HTTPSConnection(self.host,self.port,timeout=4)
        return store.conn
    def _drop(self):
        store=self._clients
        if store.conn is not None:
            try:store.conn.close()
            except Exception:pass
        store.conn=None
    def call(self,op,open_ms,**data):
        if not self.url or not self.secret:raise ValueError('SHADOW_ADAPTER_NOT_CONFIGURED')
        body=json.dumps({'op':op,'open':iso(open_ms),'nonce':uuid.uuid4().hex,**data},separators=(',',':'),allow_nan=False).encode()
        ts=str(millis());sig=hmac.new(self.secret.encode(),ts.encode()+b'.'+body,hashlib.sha256).hexdigest()
        conn=self._client()
        try:
            conn.request('POST',self.path,body=body,headers={'content-type':'application/json','connection':'keep-alive',
              'content-length':str(len(body)),**({'x-region':'us-west-2'} if self.url==BACKEND_ADAPTER else {}),'x-c85-timestamp':ts,'x-c85-signature':sig})
            response=conn.getresponse();raw=response.read();status=response.status
        except Exception:
            # A publish or early dispatch is never retried automatically: the
            # request may already have reached the adapter.
            self._drop();raise
        self._clients.used=time.time()
        # Status code only; the remote body is never logged or re-raised.
        if status!=200:
            if status>=500 or status==429:self._drop()
            raise ValueError('ADAPTER_HTTP_'+str(status))
        result=json.loads(raw)
        if result.get('ok') is not True:raise ValueError('ADAPTER_REJECTED')
        return result


def payload(route,context,decision_ms,**extra):
    model,fraction,execution=ROUTES[route];open_ms=int(pd.Timestamp(context['open']).timestamp()*1000)
    return {'mode':'shadow','model_version':model,'combined_model_version':VERSION,'leg':route,
      'execution_policy':execution,'stake_fraction_of_boise_day_opening_principal':fraction,
      'market':context['ticker'],'candle_starts_at':iso(open_ms),'decision_at':iso(decision_ms),'sent_at':iso(millis()),
      'interval_key':f"v12:{context['ticker']}:{iso(open_ms)}",**extra}

def checkpoint_frame(capture,context,market,second,received_by_ms):
    open_ms=int(pd.Timestamp(context['open']).timestamp()*1000);boundary=open_ms+second*1000
    if received_by_ms<boundary or not context.get('early'):raise ValueError('U_INPUTS_NOT_READY')
    if market.get('ticker')!=context['ticker'] or int(pd.Timestamp(market['close_time']).timestamp()*1000)!=open_ms+900000:
        raise ValueError('MARKET_INTERVAL_MISMATCH')
    strike=market.get('floor_strike')
    if not isinstance(strike,(int,float)) or not np.isfinite(strike) or strike<=0:raise ValueError('OFFICIAL_STRIKE_UNAVAILABLE')
    # One extra preceding minute supplies the first return of the 1440m window.
    frames=[capture.frame(k,open_ms-1441*60000,boundary,received_by_ms) for k in ('index','spot','perp')]
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
    return f

def score_checkpoint(capture,scorer,context,market,second,now_ms):
    boundary=int(pd.Timestamp(context['open']).timestamp()*1000)+second*1000
    if not boundary<=now_ms<=boundary+5000:raise ValueError('CHECKPOINT_EXPIRED')
    if not context.get('u_eligible') or not context.get('early'):raise ValueError('U_CONTEXT_NOT_READY')
    f=checkpoint_frame(capture,context,market,second,now_ms)
    chosen,rows=scorer.score(f,pd.Timestamp(now_ms,unit='ms',tz='UTC'))
    return chosen,rows

def context_refresh_due(context, open_ms, last_context, now):
    """Warm context before checkpoints; publishing always revalidates eligibility.

    Cache is interval-bound and at most 10 seconds old near a checkpoint. No
    historical quote or model feature is fabricated and no deadline is widened.
    """
    if not context or context.get('open') is None or int(pd.Timestamp(context['open']).timestamp()*1000)!=open_ms:
        return True
    if not context.get('ready') or context.get('early') is None:return True
    age=now-last_context
    if age<0 or age>=10000:return True
    near=any(-2500<=now-(open_ms+sec*1000)<=5000 for sec in CHECKPOINTS)
    return not near and age>=2000


def u_block_reason(context):
    e=context.get('eligibility') or {};v=e.get('v1') or {};t=e.get('t45') or {}
    if context.get('u_eligible'):return 'ELIGIBLE'
    if v.get('inputValid') is not True:return 'INVALID_V1_INPUTS'
    if v.get('ordinaryFloorAllows') is not True:return 'DAILY_FLOOR_CLOSED'
    if v.get('finalSide') in (-1,1):return 'V1_SELECTED'
    if v.get('reason')!='CONFIDENCE_ABSTAIN':return 'V1_NOT_CONFIDENCE_ABSTENTION'
    if t.get('finalized') is not True:return 'AWAITING_T45_DECISION'
    if t.get('finalSide')!=0:return 'T45_SELECTED'
    if e.get('anyPriorClaim') is not False:return 'PRIOR_CLAIM'
    return 'INELIGIBLE'

class Service:
    def __init__(self):
        if os.environ.get('V12_MODE','shadow')!='shadow':raise ValueError('SHADOW_ONLY_BINARY')
        self.path=os.environ.get('V12_CAPTURE_DB','/data/v12/capture.sqlite')
        Path(self.path).parent.mkdir(parents=True,exist_ok=True)
        self.adapter=Adapter();self.scorer=Scorer();self.ticker=None;self.context=None
        self.status={'mode':'shadow','execution_enabled':False,'stage':'STARTING','fit_expires_at':self.scorer.manifest['expires_at'],
          'fit_version':self.scorer.manifest['version'],'refresh_status':'STARTING'}
    def bars_loop(self,stream):
        cap=Capture(self.path);cursor=millis()//900000*900000-1441*60000
        while True:
            backoff=0
            try:
                end=millis()//60000*60000
                cap.fetch_bars(stream,cursor,end)
                count=cap.db.execute('select count(*) from bars where stream=? and open_ms>=? and open_ms<?',(stream,cursor,end)).fetchone()[0]
                if count!=(end-cursor)//60000:raise ValueError('MISSING_MINUTE_HISTORY')
                cursor=max(cursor,end-2*60000)
                self.status[stream+'_complete_through']=iso(end)
                self.status.pop(stream+'_error',None)
            except Exception as e:
                self.status[stream+'_error']=error_label(e);backoff=blocked_backoff(e)
            time.sleep(backoff or (.5 if millis()%60000<5000 else 3))
    def quotes_loop(self):
        cap=Capture(self.path)
        while True:
            backoff=0
            try:
                if self.ticker:
                    q=cap.sample_quote(self.ticker);self.status['quote_received_at']=iso(q['received_ms'])
                    self.status.pop('quote_error',None)
            except Exception as e:
                self.status['quote_error']=error_label(e);backoff=blocked_backoff(e)
            time.sleep(backoff or .45)
    def heartbeat_loop(self):
        # Safe status snapshot only: no secrets, headers, payloads or response bodies.
        while True:
            try:print(json.dumps({**dict(self.status),'type':'v12_health','observed_at':iso(millis())},default=str),flush=True)
            except Exception:pass
            time.sleep(HEARTBEAT_SECONDS)
    def status_loop(self):
        while True:
            try:
                self.adapter.call('heartbeat',millis()//900000*900000,status=dict(self.status))
                self.status.pop('status_error',None)
            except Exception as e:self.status['status_error']=error_label(e)
            time.sleep(30)
    def training_loop(self):
        cap=Capture(self.path);training_capture.initialize(cap.db)
        market=None;last_outcomes=0;last_prune=0
        while True:
            now=millis();context=self.context
            try:
                if context and context.get('ready') and context.get('early') and int(pd.Timestamp(context['open']).timestamp()*1000)==now//900000*900000:
                    if not market or market.get('ticker')!=context['ticker']:
                        market=get('https://api.elections.kalshi.com/trade-api/v2/markets/'+context['ticker'])['market']
                    opening=int(pd.Timestamp(context['open']).timestamp()*1000)
                    for sec in CHECKPOINTS:
                        if now<opening+sec*1000+10000:continue
                        if cap.db.execute('select 1 from training_attempts where ticker=? and second=?',(context['ticker'],sec)).fetchone():continue
                        try:
                            # All model opportunities, regardless of betting eligibility.
                            # Only inputs actually received within the 5s scoring window.
                            frame=checkpoint_frame(cap,context,market,sec,opening+sec*1000+5000)
                            training_capture.save_frame(cap.db,frame);status='CAPTURED'
                        except ValueError as e:status=str(e)
                        cap.db.execute('insert or ignore into training_attempts values(?,?,?)',(context['ticker'],sec,status));cap.db.commit()
                if now-last_outcomes>60000:
                    training_capture.collect_outcomes(cap.db,pd.Timestamp(now,unit='ms',tz='UTC'));last_outcomes=now
                if now-last_prune>3600000:
                    training_capture.prune_capture(cap.db,now);last_prune=now
                count,latest=cap.db.execute('select count(*),max(open_ms) from training_samples').fetchone()
                self.status.update(training_rows=count,training_latest_at=iso(latest) if latest else None)
            except Exception as e:self.status['training_error']=error_label(e)
            time.sleep(3)
    def refresh_loop(self):
        cache=Path(self.path).parent/'fits';seed=Path(__file__).resolve().parents[1]/'artifacts';last_failure=0
        while True:
            now=pd.Timestamp.now(tz='UTC');current=period_start(now)
            try:
                active=cache/current.strftime('%Y%m%d')
                if (active/'manifest.json').exists() and pd.Timestamp(self.scorer.manifest['valid_from'])!=current:
                    candidate=Scorer(active)
                    if pd.Timestamp(candidate.manifest['valid_from'])!=current or pd.Timestamp(candidate.manifest['expires_at'])!=current+PERIOD:
                        raise ValueError('REFIT_MANIFEST_SCHEDULE_MISMATCH')
                    self.scorer=candidate
                    self.status.update(fit_version=candidate.manifest['version'],fit_expires_at=candidate.manifest['expires_at'])
                needed=current if pd.Timestamp(self.scorer.manifest['expires_at'])<=now else current+PERIOD
                destination=cache/needed.strftime('%Y%m%d');due=needed-pd.Timedelta(days=1)+pd.Timedelta(minutes=10)
                if not (destination/'manifest.json').exists() and now>=due and millis()-last_failure>3600000:
                    self.status['refresh_status']='FITTING_'+needed.strftime('%Y%m%d')
                    result=subprocess.run([sys.executable,str(Path(__file__).with_name('refit.py')),'--seed',str(seed),'--db',self.path,
                      '--fit',needed.isoformat(),'--output',str(destination)],capture_output=True,text=True,timeout=900,
                      env={**os.environ,'OMP_NUM_THREADS':'1','OPENBLAS_NUM_THREADS':'1'})
                    if result.returncode:raise ValueError('REFIT_FAILED')
                    Scorer(destination)  # Verify file hashes before declaring prepared.
                self.status['refresh_status']=('PREPARED_' if (destination/'manifest.json').exists() else 'SCHEDULED_')+needed.strftime('%Y%m%d')
                self.status.pop('refresh_error',None)
            except Exception as e:
                last_failure=millis();self.status['refresh_error']=error_label(e)
                self.status['refresh_status']='RETRY_PENDING'
            time.sleep(30)
    def probe_once(self):
        # This sends authenticated, deliberately invalid signals to the three
        # recording receivers. It creates no signal rows and never places orders.
        try:
            result=self.adapter.call('probe',millis()//900000*900000)
            self.status['receiver_probe']={k:result[k] for k in ('all_authenticated','receivers','records_created')}
        except Exception as e:
            self.status['receiver_probe']={'all_authenticated':False,'error':str(e) if isinstance(e,ValueError) else type(e).__name__}
    def run(self):
        for stream in ('index','spot','perp'):threading.Thread(target=self.bars_loop,args=(stream,),daemon=True).start()
        threading.Thread(target=self.quotes_loop,daemon=True).start()
        threading.Thread(target=self.heartbeat_loop,daemon=True).start()
        threading.Thread(target=self.training_loop,daemon=True).start()
        threading.Thread(target=self.refresh_loop,daemon=True).start()
        if self.adapter.url==BACKEND_ADAPTER:threading.Thread(target=self.probe_once,daemon=True).start()
        if self.adapter.url==BACKEND_ADAPTER:threading.Thread(target=self.status_loop,daemon=True).start()
        cap=Capture(self.path);last_open=None;market=None;early={};last_context=0
        while True:
            now=millis();open_ms=now//900000*900000;wait=0
            try:
                if last_open!=open_ms:
                    self.ticker=None;self.context=None;market=None;last_open=open_ms;early={};last_context=0
                age=now-open_ms
                # Critical path. One signed round trip performs the minimal
                # authoritative read, the durable sender claim and the dispatch,
                # so V1 leaves as soon as its decision is committed.
                pending=[r for r in ('V1','T45R2') if r not in early]
                if pending and age<60000:
                    self.early_dispatch(cap,open_ms,pending,early)
                    if [r for r in ('V1','T45R2') if r not in early]:
                        # U's first checkpoint is at 120s. Do not put its full
                        # context/history round trip back on the early path.
                        self.status.update(stage='EARLY_DISPATCH',last_error=None)
                        time.sleep(.25);continue
                if context_refresh_due(self.context,open_ms,last_context,millis()):
                    self.context=self.adapter.call('context',open_ms)['context']
                    last_context=millis()
                context=self.context
                if not context.get('ready'):raise ValueError(context.get('reason','CONTEXT_NOT_READY'))
                self.context=context
                self.ticker=context['ticker'];age=millis()-open_ms
                self.status.update(stage='RECORDING',ticker=self.ticker,last_context_at=iso(last_context),last_error=None,worker_revision='v12-u-latency-r1',
                  u_eligible=context.get('u_eligible') is True,early_features_ready=context.get('early') is not None,
                  u_block_reason=u_block_reason(context))
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
                wait=adapter_backoff(e)
            time.sleep(wait or .5)
    SLOTS={'V1':-1,'T45R2':-45}
    def early_dispatch(self,cap,open_ms,pending,early):
        """Signed minimal read + durable claim + dispatch in one round trip.

        The adapter's interval/leg journal is the authoritative exactly-once
        guard, so a restart mid-interval cannot resend. Any outcome other than
        NOT_COMMITTED retires the leg for this interval: nothing is retried.
        """
        legs=list(pending)
        if self.ticker:
            legs=[r for r in legs if not cap.db.execute('select 1 from attempts where ticker=? and checkpoint=?',
              (self.ticker,self.SLOTS[r])).fetchone()]
            for r in pending:
                if r not in legs:early[r]=early.get(r,'ALREADY_RECORDED')
        if not legs:return
        started=millis()
        try:
            result=self.adapter.call('early_dispatch',open_ms,legs=legs)
            self.status.pop('early_dispatch_error',None)
        except Exception as e:
            self.status['early_dispatch_error']=error_label(e);raise
        self.status.update(early_dispatch_at=iso(millis()),early_dispatch_ms=millis()-started)
        if not result.get('context_ready'):return
        ticker=result.get('ticker')
        if ticker:self.ticker=ticker
        for item in result.get('dispatched') or []:
            leg=item.get('leg');status=item.get('status')
            if leg not in self.SLOTS or status=='NOT_COMMITTED':continue
            early[leg]=status
            if self.ticker:
                self.record(cap,self.SLOTS[leg],'EARLY_'+str(status),{k:item.get(k) for k in
                  ('receiver_status','receiver_mode','decision_at','sent_at','error',
                   'decision_to_dispatch_ms','decision_to_receipt_ms','timings')})
            if status=='DISPATCHED':
                self.status.update(last_dispatch_leg=leg,last_dispatch_at=item.get('sent_at'),
                  last_dispatch_decision_to_dispatch_ms=item.get('decision_to_dispatch_ms'),
                  last_dispatch_decision_to_receipt_ms=item.get('decision_to_receipt_ms'))
    def record(self,cap,checkpoint,status,details):

        cap.db.execute('insert or replace into attempts values(?,?,?,?)',(self.ticker,checkpoint,status,json.dumps(details,allow_nan=False)))
        cap.db.commit();self.status['last_attempt']={'ticker':self.ticker,'checkpoint':checkpoint,'status':status}
        self.status.update(last_attempt_at=iso(millis()),last_attempt_status=status,last_attempt_checkpoint=checkpoint)

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
