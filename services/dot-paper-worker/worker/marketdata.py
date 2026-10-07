"""Public keyless Kraken observer. No order/private endpoint exists in this module.

Forward execution remains disabled: Binance-calibrated signal is not validated on
Kraken, fees differ, and ticker BBO does not guarantee size-only updates. No raw
provider observations are served from public API. No other provider fallback.
"""
from __future__ import annotations
import asyncio
from datetime import datetime,timezone
from decimal import Decimal
import json
import uuid
import hashlib
from pathlib import Path
import time
from .engine import Quote
from .config import canonical
from .money import price, quantity
from websockets.asyncio.client import connect as WebsocketConnect

WS_URL='wss://ws.kraken.com/v2'
SUBSCRIPTIONS=(
    {'method':'subscribe','params':{'channel':'ticker','symbol':['BTC/USD'],'event_trigger':'bbo','snapshot':True},'req_id':1},
    {'method':'subscribe','params':{'channel':'trade','symbol':['BTC/USD'],'snapshot':False},'req_id':2},
)
class ObservationLimit(Exception):pass
class AccessDenied(Exception):pass
class StrictKrakenConnect(WebsocketConnect):
    def process_redirect(self,exc):
        status=getattr(getattr(exc,'response',None),'status_code',None)
        return AccessDenied('SOURCE_REDIRECT_REFUSED') if status in {300,301,302,303,307,308} else exc



def timestamp_ms(value):
    dt=datetime.fromisoformat(value.replace('Z','+00:00'))
    if dt.tzinfo is None:raise ValueError('Missing timestamp timezone')
    dt=dt.astimezone(timezone.utc)
    epoch=datetime(1970,1,1,tzinfo=timezone.utc)
    delta=dt-epoch
    return delta.days*86_400_000+delta.seconds*1000+delta.microseconds//1000


def parse_message(raw):
    # Preserve decimal precision from provider JSON, not binary float conversion.
    result=json.loads(raw,parse_float=Decimal)
    if not isinstance(result,dict):raise ValueError('Invalid market message')
    return result


def aggregate_completed_seconds(rows):
    """Strict closed 1s→15s adapter port for future eligible replay/provider parity.

    Missing seconds are rejected. Kraken raw trades are not silently fabricated
    into source klines, so this helper is not activated by the observer.
    """
    if len(rows)!=15:raise ValueError('Exactly15 observed completed seconds required')
    start=rows[0]['open_ms']
    if start%15000:raise ValueError('Unaligned15s bucket')
    for i,r in enumerate(rows):
        if r['open_ms']!=start+i*1000 or r['close_ms']!=start+i*1000+999:raise ValueError('Missing or out-of-order second')
    d=lambda k:sum(Decimal(r[k]) for r in rows)
    return {'open_ms':start,'close_ms':start+14999,'open':rows[0]['open'],
        'high':str(max(Decimal(r['high']) for r in rows)),'low':str(min(Decimal(r['low']) for r in rows)),
        'close':rows[-1]['close'],'volume':str(d('volume')),'quote_volume':str(d('quote_volume')),
        'taker_buy_quote_volume':str(d('taker_buy_quote_volume'))}

class KrakenObserver:
    def __init__(self,engine,*,max_seconds=86400,max_trades=250_000,max_quotes=500_000,max_storage_bytes=512*1024*1024):
        if engine.cfg.feed_source!='KRAKEN_SPOT' or engine.cfg.symbol!='BTCUSD':raise ValueError('Kraken BTC/USD only')
        if engine.cfg.execution_enabled:raise ValueError('Observer cannot execute simulations')
        if not 1<=max_seconds<=86400:raise ValueError('Observer limit must be1–86400seconds')
        self.engine=engine;self.max_seconds=max_seconds;self.max_trades=max_trades;self.max_quotes=max_quotes;self.max_storage_bytes=max_storage_bytes
        self.last_trade_ms=0;self.online=False;self.session_id=str(uuid.uuid4());self.monotonic_stop=None;self.last_wall_ms=None
    def start(self):
        e=self.engine;now=e.clock()
        if not e.cfg.feed_enabled or not e.cfg.feed_rights_approved:raise ValueError('Observer not enabled/approved')
        prior=e.store.get('observer_last_ms')
        if prior is not None and now<prior:raise ObservationLimit('OBSERVER_CLOCK_REGRESSION')
        with e.store.transaction(now):
            if e.store.get('observer_stop_ms') is None:e.store.put('observer_stop_ms',now+self.max_seconds*1000)
            e.store.put('observer_last_ms',now)
        self.last_wall_ms=now
        self.monotonic_stop=time.monotonic()+max(0,(e.store.get('observer_stop_ms')-now)/1000)
        self.check_limits()
    def remaining(self):
        if self.monotonic_stop is None:return 0
        return max(0,min((self.engine.store.get('observer_stop_ms',0)-self.engine.clock())/1000,
                         self.monotonic_stop-time.monotonic()))
    def check_limits(self):
        e=self.engine;now=e.clock()
        prior=max(x for x in [self.last_wall_ms,e.store.get('observer_last_ms'),0] if x is not None)
        if now<prior or e._s()['circuit_reason']=='CLOCK_REGRESSION':raise ObservationLimit('OBSERVER_CLOCK_REGRESSION')
        self.last_wall_ms=now
        sizes=sum(p.stat().st_size for p in e.store.path.parent.glob(e.store.path.name+'*') if p.is_file())
        if self.remaining()<=0 or sizes>=self.max_storage_bytes or e.store.get('observed_trade_count',0)>=self.max_trades or e.store.get('observed_quote_count',0)>=self.max_quotes:
            raise ObservationLimit('OBSERVATION_LIMIT_REACHED')
        # Durable high-water also advances during quiet/disconnected checks.
        if e.store.db.in_transaction:e.store.put('observer_last_ms',now)
        else:
            with e.store.transaction(now):e.store.put('observer_last_ms',now)
    def consume(self,raw):
        self.check_limits()
        e=self.engine;now=e.clock();m=parse_message(raw)
        with e.store.transaction(now):e.store.put('observer_last_ms',now)
        if m.get('method')=='subscribe' and m.get('success') is False:raise AccessDenied('SUBSCRIPTION_REJECTED')
        if m.get('channel') in {'ticker','trade'} and not self.online:return
        if m.get('channel')=='ticker':
            for d in m.get('data',[]):
                self.check_limits()
                if d['symbol']!='BTC/USD':raise ValueError('WRONG_SYMBOL')
                # Ticker lacks exchange sequence: monotonically persisted LOCAL receipt ID.
                # It is never represented as an exchange sequence or restored from snapshot.
                with e.store.lock:seq=max(e._s()['quote_sequence'],e.store.get('observer_quote_sequence',-1))+1
                t=timestamp_ms(d['timestamp'])
                q=Quote(sequence=seq,exchange_ms=t,event_ms=t,receipt_ms=now,
                    bid_micros=price(d['bid']),ask_micros=price(d['ask']),bid_sats=quantity(d['bid_qty']),
                    ask_sats=quantity(d['ask_qty']),symbol='BTCUSD')
                source_fields={k:str(d[k]) for k in ['symbol','timestamp','bid','ask','bid_qty','ask_qty']}
                observation_id=hashlib.sha256(canonical({'session':self.session_id,'source':source_fields}).encode()).hexdigest()
                e.on_quote(q,observation={'session_id':self.session_id,'observation_id':observation_id,'receipt_monotonic_ns':time.monotonic_ns(),'deadline_ms':e.store.get('observer_stop_ms'),'monotonic_deadline':self.monotonic_stop})
        elif m.get('channel')=='trade':
            if m.get('type')!='update':return # last50 snapshot is not complete history
            with e.store.transaction(now):
                for d in m.get('data',[]):
                    self.check_limits()
                    if d['symbol']!='BTC/USD' or d['side'] not in {'buy','sell'}:raise ValueError('INVALID_TRADE')
                    tid=d['trade_id'];t=timestamp_ms(d['timestamp']);p=price(d['price']);q=quantity(d['qty'])
                    if type(tid) is not int or tid<0 or min(p,q)<=0 or t>now+e.cfg.future_tolerance_ms or now-t>10_000:raise ValueError('STALE_OR_INVALID_TRADE')
                    doc={'symbol':'BTCUSD','venue':'KRAKEN_SPOT','trade_id':tid,'exchange_ms':t,'receipt_ms':now,
                        'price_micros':str(p),'quantity_sats':str(q),'taker_side':d['side'],'taker_order_type':d['ord_type']}
                    existing=e.store.db.execute('SELECT document FROM observed_trades WHERE trade_id=?',(tid,)).fetchone()
                    if existing:
                        prior=json.loads(existing['document']);prior.pop('receipt_ms');new=dict(doc);new.pop('receipt_ms')
                        if prior!=new:raise ValueError('CONFLICTING_TRADE')
                        continue
                    last=e.store.get('last_market_trade_id',-1)
                    if tid<=last:raise ValueError('OUT_OF_ORDER_TRADE')
                    if last>=0 and tid!=last+1:e._audit('OBSERVER','TRADE_SEQUENCE_GAP_NO_SIGNAL',{'prior':last,'next':tid})
                    e.store.db.execute('INSERT INTO observed_trades VALUES(?,?,?,?)',(tid,t,now,canonical(doc)))
                    e.store.put('last_market_trade_id',tid)
                    e.store.put('observed_trade_count',e.store.get('observed_trade_count',0)+1)
        elif m.get('channel')=='status':
            self.online=bool(m.get('data')) and all(d.get('system')=='online' for d in m['data'])
            if not self.online:e.disconnected('EXCHANGE_NOT_ONLINE')
        # Heartbeat is liveness only: never refresh quote timestamps or permit fills.

    async def run(self,stop_event):
        try:self.start()
        except ObservationLimit as exc:
            self.engine.disconnected(str(exc));return str(exc)
        backoff=1
        while not stop_event.is_set():
            try:
                self.check_limits()
                self.online=False;self.session_id=str(uuid.uuid4())
                async with StrictKrakenConnect(WS_URL,open_timeout=min(10,self.remaining()),ping_interval=20,ping_timeout=10,close_timeout=0.1,proxy=None,
                                               max_size=1_048_576,max_queue=128) as ws:
                    for sub in SUBSCRIPTIONS:
                        self.check_limits()
                        await asyncio.wait_for(ws.send(json.dumps(sub)),timeout=min(5,self.remaining()))
                    backoff=1
                    while not stop_event.is_set():
                        self.check_limits()
                        raw=await asyncio.wait_for(ws.recv(),timeout=min(10,self.remaining()))
                        self.consume(raw)
            except ObservationLimit as exc:
                self.engine.disconnected(str(exc));return str(exc)
            except AccessDenied:
                self.engine.disconnected('SOURCE_ACCESS_DENIED_NO_RETRY');return 'SOURCE_ACCESS_DENIED_NO_RETRY'
            except asyncio.CancelledError:raise
            except Exception as exc:
                status=getattr(getattr(exc,'response',None),'status_code',None)
                if status in {401,403,451}:
                    self.engine.disconnected('SOURCE_ACCESS_DENIED_NO_RETRY');return 'SOURCE_ACCESS_DENIED_NO_RETRY'
                self.engine.disconnected('OBSERVER_DISCONNECTED_OR_INVALID_DATA')
                if self.remaining()<=0:return 'OBSERVATION_LIMIT_REACHED'
                try:await asyncio.wait_for(stop_event.wait(),timeout=min(backoff,self.remaining()))
                except TimeoutError:pass
                backoff=min(backoff*2,60)
        return 'STOPPED'
