"""Causal feature builder. Feed: Binance spot BTCUSDT, same definitions as the lab."""
import numpy as np
import pandas as pd
from .indicators import factors

PRE=['return_1_vol','return_4_vol','return_16_vol','return_96_vol','log_vol96','vol8_to96','previous_body_vol','previous_range_vol','previous_close_location','utc_day_sin','utc_day_cos','week_sin','week_cos','quarter_hour_sin','quarter_hour_cos']
OPEN=['opening_log_move_vol','opening_log_range_vol','opening_recent_log_move_vol','opening_log_path_vol','opening_close_location','opening_path_efficiency','opening_taker_flow','opening_log_volume_activity','opening_log_trade_activity','opening_log_relative_trade_size']
TECH=['rsi14','macd_hist_atr','adx14','bb_percent_b20','donchian_position20','mfi14','cmf20','taker_imbalance4','vwap_distance96_atr','variance_ratio4_96']
FEED='binance-spot-btcusdt'
def safe(x,y):return np.divide(x,y,out=np.zeros(np.broadcast_shapes(np.shape(x),np.shape(y))),where=np.asarray(y)!=0)

def preopen_frame(bars):
    """Run before the boundary; persist full-history or identically seeded state.

    Each output ts is the next bar's open. No current target bar is an input.
    Return common features and three opening-window normalizers.
    """
    b=bars.sort_values('bar_open').reset_index(drop=True).copy()
    if not b.bar_open.is_unique or not b.complete.all():raise ValueError('Incomplete or duplicate closed bars')
    if not np.all(np.diff(b.bar_open.astype('int64'))==900_000_000_000):raise ValueError('Closed-bar time gap')
    if not np.isfinite(b[['open','high','low','close','volume','quote_volume','trade_count','taker_buy_volume']]).all().all():raise ValueError('Nonfinite market input')
    f=factors(b).set_index('ts');s=b.set_index('bar_open');lr=np.log(s.close/s.close.shift(1));vol=lr.rolling(96).std(ddof=0).clip(lower=1e-8)
    pre=pd.DataFrame(index=s.index+pd.Timedelta(minutes=15))
    for lag in [1,4,16,96]:pre[f'return_{lag}_vol']=(np.log(s.close/s.close.shift(lag))/(vol*np.sqrt(lag))).to_numpy()
    pre['log_vol96']=np.log(vol).to_numpy();pre['vol8_to96']=(lr.rolling(8).std(ddof=0)/vol).to_numpy()
    pre['previous_body_vol']=(np.log(s.close/s.open)/vol).to_numpy();pre['previous_range_vol']=(np.log(s.high/s.low)/vol).to_numpy()
    pre['previous_close_location']=((2*s.close-s.high-s.low)/(s.high-s.low).replace(0,np.nan)).fillna(0).to_numpy()
    minute=pre.index.hour*60+pre.index.minute
    pre['utc_day_sin']=np.sin(2*np.pi*minute/1440);pre['utc_day_cos']=np.cos(2*np.pi*minute/1440)
    pre['week_sin']=np.sin(2*np.pi*pre.index.dayofweek/7);pre['week_cos']=np.cos(2*np.pi*pre.index.dayofweek/7)
    pre['quarter_hour_sin']=np.sin(2*np.pi*pre.index.minute/60);pre['quarter_hour_cos']=np.cos(2*np.pi*pre.index.minute/60)
    # Match the original lab's indicator calculation and float32 pre-open storage.
    for k in TECH:
        if k not in ['taker_imbalance4','variance_ratio4_96']:pre[k]=f[k]
    pre['rsi14']=(pre.rsi14-50)/50;pre['mfi14']=(pre.mfi14-50)/50;pre['adx14']/=100
    pre['bb_percent_b20']-=.5;pre['donchian_position20']-=.5
    pre['taker_imbalance4']=((2*s.taker_buy_volume.rolling(4).sum()-s.volume.rolling(4).sum())/s.volume.rolling(4).sum().replace(0,np.nan)).to_numpy()
    variance_ratio=lr.rolling(4).sum().rolling(93).var(ddof=0)/(4*lr.rolling(96).var(ddof=0).replace(0,np.nan))
    pre['variance_ratio4_96']=np.log(np.maximum(variance_ratio.to_numpy(),1e-12))
    pre=pre[PRE+TECH].astype('float32');pre.index.name='ts'
    sc=pd.DataFrame(dict(vol=vol.to_numpy(),meanvol=s.volume.rolling(96).mean().to_numpy(),meancount=s.trade_count.rolling(96).mean().to_numpy()),index=pre.index)
    return pre.reset_index(),sc.reset_index()

def opening(a,n):
    c=a['close'][:,:n];op=a['open'][:,0];h=a['high'][:,:n].max(1);lo=a['low'][:,:n].min(1);end=c[:,-1]
    volume=a['volume'][:,:n].sum(1);count=a['count'][:,:n].sum(1);path=np.abs(np.diff(np.column_stack([op,c]),axis=1)).sum(1)
    return dict(log_move=np.log(end/op),log_range=np.log(h/lo),recent_log_move=np.log(end/(op if n<=5 else c[:,-6])),log_path=path/op,close_location=safe(2*end-h-lo,h-lo),path_efficiency=safe(end-op,path),taker_flow=safe(2*a['taker_buy_volume'][:,:n].sum(1)-volume,volume),volume=volume,trade_count=count)

def feature_frames(common,scale,tape,second):
    if second not in [8,45]:raise ValueError('Checkpoint must be 8 or 45')
    n=second-1;o=opening(tape,n);vol=scale.vol.to_numpy();g=np.sign(tape['close'][:,6]-tape['open'][:,0])
    op={}
    for k in ['log_move','log_range','recent_log_move','log_path']:op['opening_'+k+'_vol']=o[k]/vol
    for k in ['close_location','path_efficiency','taker_flow']:op['opening_'+k]=o[k]
    op['opening_log_volume_activity']=np.log1p(o['volume']/(scale.meanvol.to_numpy()*n/900))
    op['opening_log_trade_activity']=np.log1p(o['trade_count']/(scale.meancount.to_numpy()*n/900))
    op['opening_log_relative_trade_size']=np.log1p(safe(o['volume'],o['trade_count'])/(scale.meanvol.to_numpy()/scale.meancount.to_numpy()))
    direction=pd.concat([common[PRE].reset_index(drop=True),pd.DataFrame(op)],axis=1)
    if second==45:return direction,None
    fade=dict(opening_abs_move_vol=np.abs(op['opening_log_move_vol']),opening_range_vol=op['opening_log_range_vol'],recent_against=-g*op['opening_recent_log_move_vol'],rejection=(1-g*op['opening_close_location'])/2,opening_efficiency=np.abs(op['opening_path_efficiency']),flow_against=-g*op['opening_taker_flow'],volume_activity=op['opening_log_volume_activity'],trade_activity=op['opening_log_trade_activity'],relative_trade_size=op['opening_log_relative_trade_size'])
    for lag in [1,4,16,96]:fade[f'prior{lag}_stretch']=g*common[f'return_{lag}_vol'].to_numpy()
    fade['previous_body_stretch']=g*common.previous_body_vol.to_numpy();fade['previous_close_stretch']=g*common.previous_close_location.to_numpy()
    for k in ['vol8_to96','log_vol96']+PRE[9:]:fade[k]=common[k].to_numpy()
    for k in TECH:fade[k]=common[k].to_numpy() if k in ['adx14','variance_ratio4_96'] else g*common[k].to_numpy()
    return direction,pd.DataFrame(fade)

def features_for_checkpoint(preopen,scale,tape,second):
    """Single-candle route. tape contains timestamp-validated closed one-second bars."""
    arrays={k:np.asarray(tape[k],float)[None,:] for k in ['open','high','low','close','volume','count','taker_buy_volume']}
    c=pd.DataFrame([preopen]);sc=pd.DataFrame([scale]);direction,fade=feature_frames(c,sc,arrays,second)
    return direction.iloc[0].to_dict(),None if fade is None else fade.iloc[0].to_dict()
