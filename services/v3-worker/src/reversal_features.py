"""The 50-feature research recipe, aligned to a supplied side and rank.

Only finalized seconds 0..44 and fully closed pre-open Binance spot bars.
Source failures raise; mathematically undefined features remain explicit null.
"""
from __future__ import annotations

import math
import numpy as np
import pandas as pd
from reversal import FEATURES, RiskInvalid


def safe(a, b):
    return float(a / b) if b != 0 and np.isfinite(a) and np.isfinite(b) else np.nan


def smooth(s, n, alpha):
    out = np.full(len(s), np.nan)
    seed, state = [], np.nan
    for j, value in enumerate(np.asarray(s, float)):
        if not np.isfinite(value):
            seed, state = [], np.nan
        elif not np.isfinite(state):
            seed.append(value)
            if len(seed) == n:
                state = float(np.mean(seed))
                out[j] = state
        else:
            state = alpha * value + (1-alpha) * state
            out[j] = state
    return pd.Series(out, index=s.index)


def validate_bars(bars, candle_s, interval_ms, count, prefix=False):
    if len(bars) != count:
        raise RiskInvalid("RISK_INCOMPLETE_BARS")
    bars = sorted(bars, key=lambda b: b["open_ms"])
    start = candle_s * 1000 if prefix else candle_s * 1000 - interval_ms * count
    required = ("open", "high", "low", "close", "volume", "quote_volume",
                "taker_buy_volume", "taker_buy_quote_volume", "count")
    for i, b in enumerate(bars):
        if (b["open_ms"] != start + i * interval_ms
                or b["close_ms"] != b["open_ms"] + interval_ms - 1
                or b.get("is_final") is not True):
            raise RiskInvalid("RISK_BAR_TIMING")
        if any(b.get(k) is None or not math.isfinite(b[k]) for k in required):
            raise RiskInvalid("RISK_BAR_FIELDS")
        if (b["low"] <= 0 or not b["low"] <= min(b["open"], b["close"])
                <= max(b["open"], b["close"]) <= b["high"]
                or not 0 <= b["taker_buy_volume"] <= b["volume"] + 1e-9
                or not 0 <= b["taker_buy_quote_volume"] <= b["quote_volume"] + 1e-6
                or b["count"] < 0):
            raise RiskInvalid("RISK_BAR_VALUE")
    return bars


def preopen_context(quarters, minutes, candle_s):
    """1000 closed 15m bars ensure recursive indicators have ample warmup."""
    b = pd.DataFrame(validate_bars(quarters, candle_s, 900000, 1000))
    m = pd.DataFrame(validate_bars(minutes, candle_s, 60000, 241))
    h, l, c, v, q = [b[k] for k in ("high", "low", "close", "volume", "quote_volume")]
    prev = c.shift()
    tr = pd.concat([h-l, (h-prev).abs(), (l-prev).abs()], axis=1).max(axis=1).where(prev.notna())
    atr = smooth(tr, 14, 1/14)
    change = c.diff()
    gain, loss = smooth(change.clip(lower=0), 14, 1/14), smooth((-change).clip(lower=0), 14, 1/14)
    rsi = (100*gain/(gain+loss)).mask((gain+loss) == 0, 50)
    up, down = h.diff(), -l.diff()
    valid = up.notna() & down.notna()
    plus = pd.Series(np.where((up>down)&(up>0), up, 0.)).where(valid)
    minus = pd.Series(np.where((down>up)&(down>0), down, 0.)).where(valid)
    ps, ms = smooth(plus,14,1/14), smooth(minus,14,1/14)
    dx = (100*(ps-ms).abs()/(ps+ms)).mask((ps+ms) == 0, 0)
    adx = smooth(dx,14,1/14)
    sma, sd = c.rolling(20).mean(), c.rolling(20).std(ddof=0)
    tp = (h+l+c)/3
    flow, diff = tp*v, tp.diff()
    pos = flow.where(diff>0,0).where(diff.notna()).rolling(14).sum()
    neg = flow.where(diff<0,0).where(diff.notna()).rolling(14).sum()
    mfi = (100*pos/(pos+neg)).mask((pos+neg) == 0, 50)
    vw = q.rolling(96).sum()/v.rolling(96).sum().replace(0,np.nan)
    ret = np.log(c/c.shift())
    vr = ret.rolling(4).sum().rolling(93).var(ddof=0)/(4*ret.rolling(96).var(ddof=0).replace(0,np.nan))
    entropy = pd.Series(0.,index=b.index)
    for flag in (ret.gt(0),ret.eq(0),ret.lt(0)):
        p = flag.astype(float).where(ret.notna()).rolling(96).mean()
        entropy += -(p*np.log(p.where(p.gt(0),1)))/np.log(3)
    out = {"candle_s":candle_s, "asof_ms":candle_s*1000-1,
           "atr14_bps":float((atr/c*10000).iloc[-1]),
           "rsi14":float(rsi.iloc[-1]), "mfi14":float(mfi.iloc[-1]),
           "adx14":float(adx.iloc[-1]),
           "bb_percent_b20":float(((c-(sma-2*sd))/(4*sd.replace(0,np.nan))).iloc[-1]),
           "relative_volume20":float((v/v.shift().rolling(20).mean().replace(0,np.nan)).iloc[-1]),
           "vwap_distance96_atr":float(((c-vw)/atr.replace(0,np.nan)).iloc[-1]),
           "taker_imbalance4":float(((2*b.taker_buy_volume.rolling(4).sum()-v.rolling(4).sum())/v.rolling(4).sum().replace(0,np.nan)).iloc[-1]),
           "variance_ratio4_96":float(vr.iloc[-1]), "sign_entropy96":float(entropy.iloc[-1]),
           "amihud96":float((10000*ret.abs()/(q/1e6).replace(0,np.nan)).rolling(96).mean().iloc[-1])}
    for n in (1,3,5,15,60):
        out[f"prior_ret_{n}m"] = 10000*np.log(m.close.iloc[-1]/m.close.iloc[-n-1])
        out[f"prior_flow_{n}m"] = safe(2*m.taker_buy_quote_volume.iloc[-n:].sum(),m.quote_volume.iloc[-n:].sum())-1
    out["prior_vol_60m"] = float((10000*np.log(m.close/m.close.shift())).iloc[-60:].std(ddof=0))
    for n in (15,60,240):
        out[f"high_distance_{n}m"] = 10000*np.log(m.high.iloc[-n:].max()/m.close.iloc[-1])
        out[f"low_distance_{n}m"] = 10000*np.log(m.close.iloc[-1]/m.low.iloc[-n:].min())
    last = m.iloc[-1]
    out["prior_wick_upper"] = safe(last.high-max(last.open,last.close),last.high-last.low)
    out["prior_wick_lower"] = safe(min(last.open,last.close)-last.low,last.high-last.low)
    median = m.quote_volume.iloc[-60:].median()
    out["prior_1m_volume_relative"] = safe(last.quote_volume,median)
    out["prior_5m_volume_relative"] = safe(m.quote_volume.iloc[-5:].sum(),5*median)
    return out


def build(bars, context, candle_s, side, rank):
    if side not in (-1,1) or rank is None or not math.isfinite(rank) or not 0<=rank<=1:
        raise RiskInvalid("RISK_SIDE_OR_RANK")
    if context.get("candle_s") != candle_s or context.get("asof_ms") != candle_s*1000-1:
        raise RiskInvalid("RISK_CONTEXT_TIMING")
    b = validate_bars(bars,candle_s,1000,45,prefix=True)
    o=b[0]["open"]
    c,h,l,q,v,bq,bv,n=[np.array([r[k] for r in b],float) for k in
        ("close","high","low","quote_volume","volume","taker_buy_quote_volume","taker_buy_volume","count")]
    r=np.diff(np.r_[np.log(o),np.log(c)])
    ret=10000*np.log(c[-1]/o)
    nonzero=np.sign(r);nonzero=nonzero[nonzero!=0]
    loc=safe(c[-1]-l.min(),h.max()-l.min())
    qflow=lambda k: safe(2*bq[:k].sum(),q[:k].sum())-1
    x={"ret_45s_bps":side*ret,"last15_ret_bps":side*10000*np.log(c[44]/c[29]),
       "return_accel_15_45_bps":side*(ret-10000*np.log(c[14]/o)),
       "close_location_45s":side*(loc-.5),
       "path_efficiency_45s":abs(np.log(c[-1]/o))/np.abs(r).sum() if np.abs(r).sum()>0 else 0.,
       "realized_vol_45s_bps":10000*np.sqrt((r*r).sum()),
       "return_sign_changes":float((nonzero[1:]!=nonzero[:-1]).sum()),
       "quote_flow_45s":side*qflow(45),"quote_flow_15s":side*qflow(15),
       "quote_volume_last15_share":safe(q[-15:].sum(),q.sum()),
       "trade_count_last15_share":safe(n[-15:].sum(),n.sum()),"confidence_rank":float(rank)}
    x["aligned_snr"]=safe(x["ret_45s_bps"],x["realized_vol_45s_bps"])
    for k in ("adx14","atr14_bps","relative_volume20","variance_ratio4_96","sign_entropy96","amihud96",
              "prior_vol_60m","prior_1m_volume_relative","prior_5m_volume_relative"):
        x[k]=context[k]
    for k,center,scale in (("rsi14",50,50),("mfi14",50,50),("bb_percent_b20",.5,1),
                           ("vwap_distance96_atr",0,1),("taker_imbalance4",0,1)):
        x[k]=side*(context[k]-center)/scale
    f=2*bv[:20]-v[:20];f=f-f.mean();rr=r[:20]-r[:20].mean()
    den=np.sqrt((f*f).sum()*(rr*rr).sum())
    corr=float((f*rr).sum()/den) if den>0 else 0.
    x["flow_price_decoupling20"]=1-np.clip(corr,-1,1)
    signs=np.sign(c[:20]-o);signs=signs[signs!=0]
    x["anchor_recross_rate20"]=float((signs[1:]!=signs[:-1]).sum())/19
    x["late_move_fraction"]=safe(x["last15_ret_bps"],x["ret_45s_bps"])
    x["late_flow_change"]=side*(qflow(45)-qflow(30))
    x["impulse_over_atr"]=safe(x["ret_45s_bps"],x["atr14_bps"])
    x["wick_fraction"]=.5-x["close_location_45s"]
    for n in (1,3,5,15,60):
        for kind in ("ret","flow"):
            k=f"prior_{kind}_{n}m";x[k]=side*context[k]
    for n in (15,60,240):
        x[f"resistance_distance_{n}m_atr"]=safe(context[f'{"high" if side==1 else "low"}_distance_{n}m'],x["atr14_bps"])
    x["prior_rejection_wick"]=context["prior_wick_upper" if side==1 else "prior_wick_lower"]
    x["opening_snr_priorvol"]=safe(x["ret_45s_bps"],x["prior_vol_60m"]*np.sqrt(.75))
    x["extension_5m_atr"]=safe(x["prior_ret_5m"]+x["ret_45s_bps"],x["atr14_bps"])
    x["prior_deceleration"]=x["prior_ret_1m"]-x["prior_ret_5m"]/5
    assert set(x)==set(FEATURES)
    return {k:float(x[k]) if np.isfinite(x[k]) else None for k in FEATURES}
