"""Frozen V1.2 estimator. No exchange access or live order submission."""
import os
os.environ.setdefault('OMP_NUM_THREADS','2')
os.environ.setdefault('OPENBLAS_NUM_THREADS','2')
import numpy as np
from scipy.optimize import minimize
from scipy.special import expit, logit, ndtri
from sklearn.ensemble import HistGradientBoostingRegressor

MARKET_FIELDS=['market_logit','market_tail','spread','time_fraction','quote_logit_change']
STATE_FIELDS=MARKET_FIELDS+[
 'z_gap','z','log_vol','vol_ratio','vol_vs_pre','index_ret1','index_ret3','index_ret5',
 'spot_flow1','spot_flow3','perp_flow1','perp_flow3','flow_change','flow_gap',
 'spot_index_gap1','perp_spot_gap1','perp_spot_gap3','flow_price_residual',
 'vwap_gap','path_efficiency','range_location','range_scaled','volume_rate_change',
 'absorption','flow_saturation','flow_agreement_signed',
 'feature_t45_quote_flow_45s','feature_t45_quote_flow_15s',
 'early_vwap_scaled','feature_t45_path_efficiency_45s',
 'norm_feature_t45_last15_ret_bps','feature_t45_trade_count_last15_share']

def features(d):
    x=d.copy()
    p=np.clip(x.market_p.to_numpy(float),.02,.98)
    x['market_logit']=logit(p)
    x['market_tail']=(p-.5)*np.abs(p-.5)*4
    previous=(x.previous_bid+x.previous_ask)/2
    previous=previous.where((x.previous_bid>0)&(x.previous_ask<1)&(x.previous_bid<=x.previous_ask))
    x['quote_logit_change']=x.market_logit-logit(previous.clip(.02,.98))
    x['z_gap']=x.z-ndtri(p)
    x['absorption']=x.spot_flow1*(1-np.tanh(np.abs(x.index_ret1)))
    x['flow_saturation']=x.spot_flow1*np.abs(x.spot_flow1)
    x['flow_agreement_signed']=x.spot_flow1*np.abs(x.spot_flow3)*np.sign(x.spot_flow1*x.spot_flow3)
    x['early_vwap_scaled']=x.feature_t45_close_vwap_gap_bps/x.sigma_min_bps.clip(lower=.05)
    return x.replace([np.inf,-np.inf],np.nan)

def clipped_probability(p, estimate):
    return np.clip(p+np.clip(estimate-p,-.12,.12),.02,.98)

class OffsetLogistic:
    def __init__(self, fields): self.fields=list(fields)
    def fit(self,d,y,weights):
        a=d[self.fields].to_numpy(float)
        self.median=np.nanmedian(a,axis=0)
        self.median=np.where(np.isfinite(self.median),self.median,0)
        a=np.where(np.isfinite(a),a,self.median)
        self.lo=np.quantile(a,.005,axis=0);self.hi=np.quantile(a,.995,axis=0)
        a=np.clip(a,self.lo,self.hi)
        self.mean=a.mean(0);self.scale=np.maximum(a.std(0),1e-6)
        z=np.c_[np.ones(len(a)),(a-self.mean)/self.scale]
        offset=logit(np.clip(d.market_p.to_numpy(float),.02,.98))
        penalty=np.r_[1.,np.full(z.shape[1]-1,25.)]
        def fg(b):
            eta=offset+z@b
            loss=np.sum(weights*(np.logaddexp(0,eta)-y*eta))+.5*np.sum(penalty*b*b)
            gradient=z.T@(weights*(expit(eta)-y))+penalty*b
            return loss,gradient
        opt=minimize(fg,np.zeros(z.shape[1]),jac=True,method='L-BFGS-B',options={'maxiter':500,'ftol':1e-12,'gtol':1e-7})
        self.beta=opt.x;self.converged=bool(opt.success);self.fit_message=str(opt.message)
        if not self.converged:raise RuntimeError(self.fit_message)
        return self
    def predict(self,d):
        a=d[self.fields].to_numpy(float);a=np.where(np.isfinite(a),a,self.median)
        z=np.c_[np.ones(len(a)),(np.clip(a,self.lo,self.hi)-self.mean)/self.scale]
        p=np.clip(d.market_p.to_numpy(float),.02,.98)
        return clipped_probability(p,expit(logit(p)+z@self.beta))
    def json_state(self):
        return {k:(v.tolist() if isinstance(v,np.ndarray) else v) for k,v in self.__dict__.items()}

class V12Model:
    def fit(self,d):
        x=features(d)
        y=(x.label.to_numpy()==1).astype(float)
        counts=x.groupby('ticker').ticker.transform('size').to_numpy()
        weights=1/counts
        self.market=OffsetLogistic(MARKET_FIELDS).fit(x,y,weights)
        self.linear=OffsetLogistic(STATE_FIELDS).fit(x,y,weights)
        self.nonlinear=HistGradientBoostingRegressor(loss='squared_error',max_iter=120,
            learning_rate=.04,max_leaf_nodes=7,max_depth=3,min_samples_leaf=200,
            l2_regularization=20,early_stopping=False,random_state=260917)
        self.nonlinear.fit(x[STATE_FIELDS],y-x.market_p.to_numpy(),sample_weight=weights)
        return self
    def predict(self,d):
        x=features(d);p=np.clip(x.market_p.to_numpy(float),.02,.98)
        linear=self.linear.predict(x)
        nonlinear=clipped_probability(p,p+self.nonlinear.predict(x[STATE_FIELDS]))
        return {'MARKET':self.market.predict(x),'LINEAR':linear,'NONLINEAR':nonlinear,
                'V12':(linear+nonlinear)/2}
