"""Exact lab indicator definitions: SMA-seeded recursive smoothing."""
import numpy as np
import pandas as pd
STEP=pd.Timedelta(minutes=15)

def smooth(s,n,alpha):
 """SMA seed then recursive average; every NaN resets state and warm-up."""
 a=np.asarray(s,float);out=np.full(len(a),np.nan);seed=[];state=np.nan
 for j,v in enumerate(a):
  if not np.isfinite(v):seed=[];state=np.nan;continue
  if not np.isfinite(state):
   seed.append(v)
   if len(seed)==n:state=float(np.mean(seed));out[j]=state
  else:state=alpha*v+(1-alpha)*state;out[j]=state
 return pd.Series(out,index=s.index)

def factors(b):
 b=b.sort_values('bar_open').reset_index(drop=True).copy();valid=b.complete.astype(bool)
 h,l,c,v,q=[b[col].where(valid) for col in ['high','low','close','volume','quote_volume']]
 prev=c.shift();tr=pd.concat([h-l,(h-prev).abs(),(l-prev).abs()],axis=1).max(axis=1).where(valid & prev.notna())
 atr=smooth(tr,14,1/14);change=c.diff();gain=smooth(change.clip(lower=0),14,1/14);loss=smooth((-change).clip(lower=0),14,1/14)
 rsi=100*gain/(gain+loss);rsi=rsi.mask((gain+loss)==0,50)
 ema12=smooth(c,12,2/13);ema26=smooth(c,26,2/27);macd=ema12-ema26;hist=macd-smooth(macd,9,2/10)
 up=h.diff();down=-l.diff();dmvalid=up.notna()&down.notna()
 plus=pd.Series(np.where((up>down)&(up>0),up,0.)).where(dmvalid);minus=pd.Series(np.where((down>up)&(down>0),down,0.)).where(dmvalid)
 ps=smooth(plus,14,1/14);ms=smooth(minus,14,1/14)
 dx=100*(ps-ms).abs()/(ps+ms);dx=dx.mask((ps+ms)==0,0);adx=smooth(dx,14,1/14)
 sma=c.rolling(20).mean();sd=c.rolling(20).std(ddof=0)
 locden=h.rolling(20).max()-l.rolling(20).min();loc=(c-l.rolling(20).min())/locden.replace(0,np.nan)
 clv=((2*c-h-l)/(h-l)).mask((h-l)==0,0);cmf=(clv*v).rolling(20).sum()/v.rolling(20).sum().replace(0,np.nan)
 tp=(h+l+c)/3;flow=tp*v;diff=tp.diff();pos=flow.where(diff>0,0).where(diff.notna());neg=flow.where(diff<0,0).where(diff.notna())
 pos=pos.rolling(14).sum();neg=neg.rolling(14).sum();mfi=100*pos/(pos+neg);mfi=mfi.mask((pos+neg)==0,50)
 rv=v/v.shift(1).rolling(20).mean().replace(0,np.nan)
 vw=q.rolling(96).sum()/v.rolling(96).sum().replace(0,np.nan)
 out=pd.DataFrame(dict(ts=b.bar_open+STEP,indicator_asof=b.bar_open+STEP-pd.Timedelta(milliseconds=1),rsi14=rsi,macd_hist_atr=hist/atr.replace(0,np.nan),adx14=adx,atr14_bps=atr/c*10000,bb_percent_b20=(c-(sma-2*sd))/(4*sd.replace(0,np.nan)),donchian_position20=loc,cmf20=cmf,mfi14=mfi,relative_volume20=rv,vwap_distance96_atr=(c-vw)/atr.replace(0,np.nan)))
 out['source_previous_bar_complete']=valid
 return out.replace([np.inf,-np.inf],np.nan)
