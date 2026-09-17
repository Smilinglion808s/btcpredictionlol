"""Independent U input capture. Reads public market data only; never orders.

Retains original taker-buy QUOTE volume (not base-volume approximations),
COIN-M BTCUSD index, complete spot/perpetual minutes, and point-in-time quotes.
Persist through a volume or uploader supplied by the deployment.
"""
import json,sqlite3,time,urllib.request,urllib.parse
import pandas as pd

STREAMS={
 'index':('https://dapi.binance.com/dapi/v1/indexPriceKlines',{'pair':'BTCUSD','interval':'1m'}),
 'spot':('https://api.binance.com/api/v3/klines',{'symbol':'BTCUSDT','interval':'1m'}),
 'perp':('https://fapi.binance.com/fapi/v1/klines',{'symbol':'BTCUSDT','interval':'1m'}),
}
COLUMNS=['open_ms','open','high','low','close','volume','close_ms','quote_volume','count','taker_buy_volume','taker_buy_quote_volume','ignore']

def get(url,params=None):
    if params:url+='?'+urllib.parse.urlencode(params)
    with urllib.request.urlopen(url,timeout=8) as r:return json.load(r)

class Capture:
    def __init__(self,path):
        self.db=sqlite3.connect(path)
        self.db.execute('pragma journal_mode=WAL')
        self.db.execute('create table if not exists bars(stream text,open_ms integer,close_ms integer,received_ms integer,raw text,primary key(stream,open_ms))')
        self.db.execute('create table if not exists quotes(ticker text,observed_ms integer,bid real,ask real,primary key(ticker,observed_ms))')
        self.db.execute('create table if not exists attempts(ticker text,checkpoint integer,status text,details text,primary key(ticker,checkpoint))')
    def fetch_bars(self,stream,start_ms,end_ms):
        if stream=='spot1s':url,params=STREAMS['spot'];params={**params,'interval':'1s'};step=1000
        else:url,params=STREAMS[stream];step=60000
        cursor=start_ms
        while cursor<end_ms:
            raw=get(url,{**params,'startTime':cursor,'endTime':end_ms-1,'limit':1000})
            received=int(time.time()*1000)
            if not isinstance(raw,list):raise ValueError('INVALID_BAR_RESPONSE')
            if not raw:raise ValueError('EMPTY_BAR_RESPONSE')
            for bar in raw:
                # Never ingest a still-open bar or silently replace first receipt.
                if int(bar[6])>=received or int(bar[6])>=end_ms:continue
                self.db.execute('insert or ignore into bars values(?,?,?,?,?)',(stream,int(bar[0]),int(bar[6]),received,json.dumps(bar)))
            self.db.commit()
            nxt=int(raw[-1][0])+step
            if nxt<=cursor:raise ValueError('NON_ADVANCING_BAR_PAGE')
            cursor=nxt
    def frame(self,stream,start_ms,end_ms,received_by_ms):
        rows=self.db.execute('select raw from bars where stream=? and open_ms>=? and close_ms<? and received_ms<=? order by open_ms',(stream,start_ms,end_ms,received_by_ms)).fetchall()
        d=pd.DataFrame([json.loads(r[0]) for r in rows],columns=COLUMNS)
        for c in COLUMNS:d[c]=pd.to_numeric(d[c],errors='coerce')
        d['ts']=pd.to_datetime(d.open_ms,unit='ms',utc=True)
        return d.set_index('ts')
    def sample_quote(self,ticker,base='https://api.elections.kalshi.com/trade-api/v2'):
        start=int(time.time()*1000);obj=get(base+'/markets/'+urllib.parse.quote(ticker,safe='')+'/orderbook')
        received=int(time.time()*1000)
        if received-start>1000:raise ValueError('SLOW_QUOTE')
        book=obj.get('orderbook_fp') or {}
        def best(key):
            levels=[(float(p),float(q)) for p,q in book.get(key,[]) if float(q)>0]
            if not levels:raise ValueError('EMPTY_BOOK')
            return max(p for p,q in levels)
        bid,ask=best('yes_dollars'),1-best('no_dollars')
        if not 0<bid<=ask<1:raise ValueError('INVALID_BOOK')
        self.db.execute('insert or ignore into quotes values(?,?,?,?)',(ticker,received,bid,ask));self.db.commit()
        return {'yes_bid':bid,'yes_ask':ask,'received_ms':received,'requested_ms':start}
    def boundary_quote(self,ticker,boundary_ms,max_age_ms=2000):
        # No quote observed after the event-time cutoff may impersonate history.
        r=self.db.execute('select observed_ms,bid,ask from quotes where ticker=? and observed_ms<=? order by observed_ms desc limit 1',(ticker,boundary_ms)).fetchone()
        if not r or boundary_ms-r[0]>max_age_ms:raise ValueError('MISSING_POINT_IN_TIME_QUOTE')
        return r

def early_features(seconds,normalization_context):
    """Exact first-45-second definitions and recorded-opportunity normalization."""
    import numpy as np
    if len(seconds)!=45 or not seconds.index.equals(pd.date_range(seconds.index[0],periods=45,freq='s')):raise ValueError('INCOMPLETE_FIRST45')
    if len(normalization_context)<24 or len(normalization_context)>96:raise ValueError('CONTEXT_HISTORY_UNAVAILABLE')
    a=seconds;close=a.close.to_numpy(float);first=a.open.iloc[0]
    quote=a.quote_volume.sum();base=a.volume.sum();count=a['count'].sum()
    if min(quote,base,count,a.iloc[:15].quote_volume.sum())<=0:raise ValueError('EMPTY_FIRST45')
    context=pd.Series(normalization_context,dtype=float).clip(-200,200)
    if context.notna().sum()<24:raise ValueError('CONTEXT_HISTORY_UNAVAILABLE')
    normalizer=max(float(np.sqrt(context.pow(2).mean())),5)
    path=np.diff(np.log(np.r_[first,close]))*1e4
    return {'feature_t45_quote_flow_45s':2*a.taker_buy_quote_volume.sum()/quote-1,
      'feature_t45_quote_flow_15s':2*a.iloc[:15].taker_buy_quote_volume.sum()/a.iloc[:15].quote_volume.sum()-1,
      'feature_t45_close_vwap_gap_bps':np.log(close[-1]/(quote/base))*1e4,
      'feature_t45_path_efficiency_45s':abs(np.log(close[-1]/first)*1e4)/(abs(path).sum()+1e-12),
      'norm_feature_t45_last15_ret_bps':float(np.clip(np.log(close[-1]/close[29])*1e4/normalizer,-10,10)),
      'feature_t45_trade_count_last15_share':a.iloc[-15:]['count'].sum()/count}
