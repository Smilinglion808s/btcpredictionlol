"""Offline daily fitting for Lite A; never run this on the timed score path.

Inputs are a chronological 60-column feature frame plus target timestamps,
input-valid flags, and official labels with their observed availability times.
No raw-feed collection is implemented here. Uses numpy/pandas/scikit-learn.
"""
import hashlib
import warnings
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import RobustScaler

from .engine import wrap_historical_head


def fit_daily(frame, features, start):
    if len(features.columns) != 60 or len(frame) != len(features):
        raise ValueError('Expected aligned complete 60-feature rows')
    if not frame.ts.is_monotonic_increasing or not frame.ts.is_unique:
        raise ValueError('Targets must be unique and chronological')
    cutoff = frame.ts.iloc[start]
    if cutoff != cutoff.normalize():
        raise ValueError('Daily fitting is at an available UTC midnight target')
    ix = np.arange(max(0,start-8640),start)
    known = (frame.input_valid.iloc[ix].to_numpy(bool)
        & frame.settlement_ts.iloc[ix].lt(cutoff).to_numpy()
        & frame.label.iloc[ix].isin([-1,1]).to_numpy())
    ix = ix[known]
    if len(ix)<672 or set(frame.label.iloc[ix]) != {-1,1}:
        return None
    a = features.iloc[ix].to_numpy(float)
    a[~np.isfinite(a)] = np.nan
    with warnings.catch_warnings():
        warnings.simplefilter('ignore',RuntimeWarning)
        imputation = np.nanmedian(a,axis=0)
    imputation[~np.isfinite(imputation)] = 0
    a = np.where(np.isfinite(a),a,imputation)
    scaler = RobustScaler(quantile_range=(10,90))
    z = scaler.fit_transform(a)
    days = frame.ts.iloc[ix].dt.strftime('%Y-%m-%d')
    weights = days.map(1.0/days.value_counts()).to_numpy(float)
    weights /= weights.mean()
    labels = frame.label.iloc[ix].eq(1).to_numpy(float)
    model = LogisticRegression(C=.003,solver='lbfgs',max_iter=5000,random_state=57)
    model.fit(z,labels.astype(np.int8),sample_weight=weights)
    b = {'feature_order':list(features.columns),'imputation':imputation.tolist(),
        'center':scaler.center_.tolist(),'scale':scaler.scale_.tolist(),
        'coefficient':model.coef_[0].tolist(),'intercept':float(model.intercept_[0]),
        'fit_cutoff':cutoff.isoformat(),'train_rows':len(ix),
        'train_start':frame.ts.iloc[ix[0]].isoformat(),'train_end':frame.ts.iloc[ix[-1]].isoformat(),
        'max_train_settlement':frame.settlement_ts.iloc[ix].max().isoformat(),
        'train_data_sha256':hashlib.sha256(ix.tobytes()+a.tobytes()+labels.tobytes()+weights.tobytes()).hexdigest(),
        'parameters':{'window_rows':8640,'minimum_train_rows':672,'C':.003,
            'solver':'lbfgs','max_iter':5000,'random_state':57,'quantile_range':[10,90],
            'weighting':'equal total weight per represented UTC day'},
        'model':'LITE_A_DIRECTION', 'iterations':model.n_iter_.tolist()}
    return wrap_historical_head(b)
