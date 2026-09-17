"""Local training history from recorded inputs and official outcomes; no signals."""
import json
import pandas as pd
from capture import get
from refit import RAW_FIELDS

def initialize(db):
    db.execute('create table if not exists training_samples(ticker text,second integer,open_ms integer,frame text,primary key(ticker,second))')
    db.execute('create table if not exists training_outcomes(ticker text primary key,label integer,settlement_ts text,observed_at text)')
    db.execute('create table if not exists training_attempts(ticker text,second integer,status text,primary key(ticker,second))')
    db.commit()

def save_frame(db,frame):
    row=frame.iloc[0];fields=['ts','ticker','feature_valid','quote_valid',*RAW_FIELDS]
    # Pandas encodes missing predictor values as null; the frozen estimators
    # retain their existing imputation. Invalid core frames are never saved.
    if not row.feature_valid or not row.quote_valid:raise ValueError('INVALID_TRAINING_FRAME')
    raw=frame[fields].to_json(orient='records',date_format='iso',date_unit='ns',double_precision=15)
    data=json.loads(raw)[0]
    db.execute('insert or ignore into training_samples values(?,?,?,?)',
      (row.ticker,int(row.second),int(pd.Timestamp(row.ts).timestamp()*1000),json.dumps(data,separators=(',',':'))))
    db.commit()

def record_outcome(db,market,now):
    ticker=market.get('ticker');result=market.get('result');settlement=market.get('settlement_ts')
    if market.get('status') not in ('settled','finalized') or result not in ('yes','no') or not settlement:return False
    settled=pd.Timestamp(settlement);now=pd.Timestamp(now)
    if settled.tzinfo is None or settled>now:return False
    first=db.execute('select min(open_ms) from training_samples where ticker=?',(ticker,)).fetchone()[0]
    if first is None or settled<=pd.Timestamp(first+900000,unit='ms',tz='UTC'):return False
    db.execute('insert or ignore into training_outcomes values(?,?,?,?)',(ticker,1 if result=='yes' else -1,settled.isoformat(),now.isoformat()))
    db.commit();return True

def collect_outcomes(db,now):
    cutoff=int((pd.Timestamp(now)-pd.Timedelta(minutes=20)).timestamp()*1000)
    tickers=db.execute('select distinct s.ticker from training_samples s left join training_outcomes o using(ticker) where s.open_ms<? and o.ticker is null order by s.open_ms desc limit 12',(cutoff,)).fetchall()
    for (ticker,) in tickers:
        market=get('https://api.elections.kalshi.com/trade-api/v2/markets/'+ticker)['market']
        if market.get('ticker')!=ticker:raise ValueError('OUTCOME_MARKET_MISMATCH')
        record_outcome(db,market,now)

def prune_capture(db,now_ms):
    # Training frames/outcomes survive 100 days. Raw capture retains 3 days,
    # sufficient for >24h feature warmup and restart recovery on the 1GB volume.
    db.execute('delete from quotes where observed_ms<?',(now_ms-3*86400000,))
    db.execute('delete from bars where open_ms<?',(now_ms-3*86400000,))
    db.execute('delete from training_samples where open_ms<?',(now_ms-100*86400000,))
    db.execute('delete from training_outcomes where ticker not in (select ticker from training_samples)')
    db.commit()
