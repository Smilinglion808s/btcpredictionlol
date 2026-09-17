"""Original minute-feature math extracted unchanged from the verified research reconstruction.

Inputs must be completed, event-time aligned minute bars. Receipt-time checks
belong to the live collector. No Kalshi future/arrival quotes or outcomes enter
this function.
"""
import numpy as np
import pandas as pd
from scipy.special import ndtr

def build_state(ix, s, per, ref, checkpoints=(120,180,300,480,600,720)):
    CHECKPOINTS=checkpoints
    clock=ix.index
    if not clock.equals(s.index) or not clock.equals(per.index):raise ValueError('MISALIGNED_FEEDS')
    if len(clock)<1441 or not clock.is_unique or not clock.is_monotonic_increasing:raise ValueError('INSUFFICIENT_MINUTE_HISTORY')
    if not clock.equals(pd.date_range(clock[0],clock[-1],freq='min')):raise ValueError('MISSING_MINUTE')
    pos=clock.get_indexer(ref.ts);assert (pos>=0).all()
    indexclose=ix.close.to_numpy(float);spotclose=s.close.to_numpy(float);perpclose=per.close.to_numpy(float)
    ir=pd.Series(np.log(indexclose)).diff()*1e4;sr=pd.Series(np.log(spotclose)).diff()*1e4
    sigma=np.sqrt(.5*ir.pow(2).rolling(30,min_periods=30).mean()+.5*ir.pow(2).rolling(240,min_periods=120).mean()).to_numpy()
    slow=np.sqrt(ir.pow(2).rolling(1440,min_periods=240).mean()).to_numpy()
    sq=s.quote_volume.to_numpy(float);stq=s.taker_buy_quote_volume.to_numpy(float);svl=s.volume.to_numpy(float);sn=s['count'].to_numpy(float)
    pq=per.quote_volume.to_numpy(float);ptq=per.taker_buy_quote_volume.to_numpy(float)
    def prev(arr,p,k):return arr[np.maximum(p-k,0)]
    def roll(arr,k):return pd.Series(arr).rolling(k,min_periods=k).sum().to_numpy()
    def flow(q,t,k,p):return np.divide(2*roll(t,k)[p],roll(q,k)[p],out=np.full(len(p),np.nan),where=roll(q,k)[p]>0)-1
    strike=ref.floor_strike.to_numpy(float);frames=[]
    for sec in CHECKPOINTS:
        m=sec//60;p=pos+m-1;vol=np.maximum(sigma[p],.05);prevol=np.maximum(sigma[np.maximum(pos-1,0)],.05)
        rem=(900-sec)/60-2/3;dis=np.log(indexclose[p]/strike)*1e4;z=np.clip(dis/(vol*np.sqrt(rem)),-8,8)
        f=ref.copy();f['second']=sec;f['row_id']=np.arange(len(ref));f['current_index']=indexclose[p]
        f['strike_distance_bps']=dis;f['sigma_min_bps']=vol;f['z']=z;f['z_abs']=z*np.abs(z);f['z_cube']=z**3
        f['time_fraction']=sec/900;f['z_time']=z*sec/900;f['log_vol']=np.log(vol)
        f['vol_ratio']=np.log(vol/np.maximum(slow[p],.05));f['vol_vs_pre']=np.log(vol/prevol);f['diffusion_p']=ndtr(z)
        for k in [1,3,5,15]:f[f'index_ret{k}']=np.log(indexclose[p]/prev(indexclose,p,k))*1e4/(vol*np.sqrt(k))
        f['spot_index_gap1']=(np.log(spotclose[p]/prev(spotclose,p,1))-np.log(indexclose[p]/prev(indexclose,p,1)))*1e4/vol
        f['perp_spot_gap1']=(np.log(perpclose[p]/prev(perpclose,p,1))-np.log(spotclose[p]/prev(spotclose,p,1)))*1e4/vol
        f['perp_spot_gap3']=(np.log(perpclose[p]/prev(perpclose,p,3))-np.log(spotclose[p]/prev(spotclose,p,3)))*1e4/(vol*np.sqrt(3))
        for k in [1,3]:f[f'spot_flow{k}']=flow(sq,stq,k,p);f[f'perp_flow{k}']=flow(pq,ptq,k,p)
        f['flow_change']=f.spot_flow1-f.spot_flow3;f['flow_gap']=f.perp_flow3-f.spot_flow3
        f['flow_price_residual']=f.spot_flow3-f.index_ret3.clip(-2,2)/2
        f['volume_rate_change']=np.log1p(sq[p])-np.log1p(roll(sq,15)[np.maximum(pos-1,0)]/15)
        f['trade_rate_change']=np.log1p(sn[p])-np.log1p(roll(sn,15)[np.maximum(pos-1,0)]/15)
        ci=pos[:,None]+np.arange(m)[None,:];qsum=sq[ci].sum(1);vsum=svl[ci].sum(1);vwap=qsum/np.maximum(vsum,1e-10)
        high=s.high.to_numpy(float)[ci].max(1);low=s.low.to_numpy(float)[ci].min(1)
        f['vwap_gap']=np.log(spotclose[p]/vwap)*1e4/vol;f['range_location']=(2*spotclose[p]-high-low)/np.maximum(high-low,.01)
        f['range_scaled']=np.log(high/low)*1e4/(vol*np.sqrt(m));f['candle_flow']=2*stq[ci].sum(1)/np.maximum(qsum,1e-10)-1
        f['path_efficiency']=np.log(spotclose[p]/spotclose[np.maximum(pos-1,0)])*1e4/(np.abs(sr.to_numpy()[ci]).sum(1)+.01)
        for k in [15,60]:f[f'pre_ret{k}']=np.log(indexclose[np.maximum(pos-1,0)]/indexclose[np.maximum(pos-k-1,0)])*1e4/(prevol*np.sqrt(k))
        f['pre_flow15']=flow(sq,stq,15,np.maximum(pos-1,0));f['current_side']=np.sign(dis)
        f['valid']=(pos>=1440)&np.isfinite(strike)&(strike>0)&np.isfinite(z)&(np.abs(dis)<np.log(1.05)*1e4)
        frames.append(f)
    state=pd.concat(frames,ignore_index=True)
    return state
