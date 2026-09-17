"""Heavy-tailed settlement probability and chronological quote calibration.

Research only. No network, credentials, order placement or deployment.
"""
import os
os.environ.setdefault('OMP_NUM_THREADS', '2')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '2')
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.special import expit, logit, stdtr, gammaln

SCALE_FIELDS = ['log_vol', 'vol_ratio', 'vol_vs_pre', 'abs_return1', 'time_fraction']

class Standardizer:
    def fit(self, a):
        a = np.asarray(a, float)
        self.median = np.nanmedian(a, axis=0)
        self.median = np.nan_to_num(self.median)
        a = np.where(np.isfinite(a), a, self.median)
        self.low, self.high = np.quantile(a, [.005, .995], axis=0)
        a = np.clip(a, self.low, self.high)
        self.mean, self.scale = a.mean(0), np.maximum(a.std(0), 1e-6)
        return self
    def transform(self, a):
        a = np.asarray(a, float)
        a = np.where(np.isfinite(a), a, self.median)
        return (np.clip(a, self.low, self.high) - self.mean) / self.scale

def weights(d):
    return 1 / d.groupby('ticker').ticker.transform('size').to_numpy(float)

def scale_features(d):
    return np.c_[d.log_vol, d.vol_ratio, d.vol_vs_pre, np.abs(d.index_ret1), d.time_fraction]

class Distribution:
    def fit(self, d):
        a = scale_features(d)
        self.standard = Standardizer().fit(a)
        x = np.c_[np.ones(len(a)), self.standard.transform(a)]
        z = d.z.to_numpy(float)
        y = (d.label.to_numpy() == 1).astype(float)
        w = weights(d)
        penalty = np.r_[4., np.full(x.shape[1]-1, 25.), 25.]
        const = gammaln(3.) - gammaln(2.5) - .5*np.log(5*np.pi)
        def fg(b):
            raw = x @ b[:-1]
            inv = np.exp(-np.clip(raw, -1.4, 1.4))
            u = z*inv + b[-1]
            p = np.clip(stdtr(5, u), 1e-10, 1-1e-10)
            loss = -np.sum(w*(y*np.log(p)+(1-y)*np.log1p(-p))) + .5*np.sum(penalty*b*b)
            pdf = np.exp(const - 3*np.log1p(u*u/5))
            g = w*(p-y)/(p*(1-p))*pdf
            active = (raw > -1.4) & (raw < 1.4)
            grad = np.r_[x.T @ (-g*z*inv*active), g.sum()] + penalty*b
            return loss, grad
        opt = minimize(fg, np.zeros(x.shape[1]+1), jac=True, method='L-BFGS-B',
                       options={'maxiter':400, 'ftol':1e-11, 'gtol':1e-6})
        if not opt.success: raise RuntimeError(str(opt.message))
        self.beta, self.fit_message = opt.x, str(opt.message)
        return self
    def predict(self, d, previous=False):
        x = np.c_[np.ones(len(d)), self.standard.transform(scale_features(d))]
        z = d.z.to_numpy(float)
        if previous:
            # Last-minute index return is standardized by current sigma.
            rem = np.maximum((900-d.second.to_numpy(float))/60 - 2/3, .1)
            z = (z*np.sqrt(rem)-d.index_ret1.to_numpy(float))/np.sqrt(rem+1)
        inv = np.exp(-np.clip(x@self.beta[:-1], -1.4, 1.4))
        return np.clip(stdtr(5, z*inv+self.beta[-1]), .005, .995)

def market_features(d, physical, previous_physical):
    p = np.clip(d.market_p.to_numpy(float), .005, .995)
    l = logit(p)
    previous = np.clip((d.previous_bid.to_numpy(float)+d.previous_ask.to_numpy(float))/2, .005, .995)
    good = (d.previous_bid.to_numpy(float)>0)&(d.previous_ask.to_numpy(float)<1)&(d.previous_bid<=d.previous_ask).to_numpy()
    innovation = logit(physical)-logit(previous_physical)-(l-logit(previous))
    innovation[~good] = np.nan
    return np.c_[l, (p-.5)*np.abs(p-.5)*4, d.time_fraction, l*d.time_fraction,
                 d.spread, innovation], good

class QuoteCalibration:
    def fit(self, d, physical, previous_physical):
        a, good = market_features(d, physical, previous_physical)
        d = d.loc[good].copy(); a = a[good]
        if d.ticker.nunique()<200: raise RuntimeError('Insufficient nested calibration history')
        self.standard = Standardizer().fit(a)
        x = np.c_[np.ones(len(a)), self.standard.transform(a)]
        offset = logit(np.clip(d.market_p.to_numpy(float), .005, .995))
        y = (d.label.to_numpy()==1).astype(float); w = weights(d)
        penalty = np.r_[4., np.full(x.shape[1]-1, 25.)]
        def fg(b):
            eta = offset+x@b
            return (np.sum(w*(np.logaddexp(0,eta)-y*eta))+.5*np.sum(penalty*b*b),
                    x.T@(w*(expit(eta)-y))+penalty*b)
        opt=minimize(fg,np.zeros(x.shape[1]),jac=True,method='L-BFGS-B',
                     options={'maxiter':400,'ftol':1e-11,'gtol':1e-6})
        if not opt.success: raise RuntimeError(str(opt.message))
        self.beta=opt.x; self.fit_rows=len(d); self.fit_markets=d.ticker.nunique()
        return self
    def predict(self,d,physical,previous_physical):
        a,good=market_features(d,physical,previous_physical)
        x=np.c_[np.ones(len(a)),self.standard.transform(a)]
        p=np.clip(d.market_p.to_numpy(float),.005,.995)
        q=np.clip(p+np.clip(expit(logit(p)+x@self.beta)-p,-.12,.12),.005,.995)
        q[~good]=np.nan
        return q

class SettlementModel:
    def fit(self,d):
        first=d.ts.min().floor('D'); stop=d.ts.max()+pd.Timedelta(microseconds=1)
        begin=first+pd.Timedelta(days=14)
        edges=[begin+(stop-begin)*i/3 for i in range(4)]
        frames=[]; self.inner_audit=[]
        for a,b in zip(edges[:-1],edges[1:]):
            cut=a-pd.Timedelta(days=1)
            tr=d[d.ts.lt(cut)&d.settlement_ts.lt(cut)]
            val=d[d.ts.ge(a)&d.ts.lt(b)].copy()
            if tr.ticker.nunique()<500 or len(val)==0: continue
            m=Distribution().fit(tr)
            val['inner_physical']=m.predict(val)
            val['inner_previous']=m.predict(val,previous=True)
            frames.append(val)
            self.inner_audit.append({'cutoff':str(cut),'max_training_settlement':str(tr.settlement_ts.max()),
                'validation_first':str(val.ts.min()),'validation_last':str(val.ts.max()),
                'training_markets':tr.ticker.nunique(),'validation_markets':val.ticker.nunique()})
        if not frames: raise RuntimeError('No nested predictions')
        oof=pd.concat(frames)
        self.calibration=QuoteCalibration().fit(oof,oof.inner_physical.to_numpy(),oof.inner_previous.to_numpy())
        self.distribution=Distribution().fit(d)
        return self
    def predict(self,d):
        physical=self.distribution.predict(d)
        quote=self.calibration.predict(d,physical,self.distribution.predict(d,previous=True))
        return {'V12_DISTRIBUTION':physical,'V12_BLEND':.25*physical+.75*d.market_p.to_numpy(float),
                'V12_REPRICING':.5*(physical+quote),'PHYSICAL':physical,'QUOTE':quote}
