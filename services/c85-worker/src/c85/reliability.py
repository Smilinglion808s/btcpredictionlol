"""C85's original daily logistic fitter with portable fitted-state capture."""
from pathlib import Path
import hashlib,json,warnings
import numpy as np
import pandas as pd
from scipy.special import expit
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import RobustScaler
from .original_policy import day_balanced_weights,directional_rank,asymmetric_prediction,confirmed_extension,state_run,rank_stream

WINDOW=8640
MINIMUM=672


def encode(value):
    if isinstance(value,np.generic):return value.item()
    if isinstance(value,pd.Timestamp):return value.isoformat()
    if isinstance(value,np.ndarray):return value.tolist()
    raise TypeError(type(value))


def write(path,obj):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(obj,indent=2,default=encode)+'\n')




def training_indices(f,target,eligible,block_start):
    cutoff=f.ts.iloc[block_start]
    ix=np.arange(max(0,block_start-WINDOW),block_start)
    settlement=f.settlement_ts.astype('int64').to_numpy()
    known=(settlement[ix]!=np.iinfo(np.int64).min)&(settlement[ix]<cutoff.value)
    return ix[np.asarray(eligible)[ix]&np.isfinite(target[ix])&known]


def fit_one(f,matrix,target,eligible,block_start):
    ix=training_indices(f,target,eligible,block_start)
    if len(ix)<MINIMUM:return None
    y=np.asarray(target)[ix].astype(np.int8)
    if set(np.unique(y))!={0,1}:return None
    raw=matrix.to_numpy(float,copy=True);raw[~np.isfinite(raw)]=np.nan
    train=raw[ix].copy()
    with warnings.catch_warnings():
        warnings.simplefilter('ignore',category=RuntimeWarning)
        impute=np.nanmedian(train,axis=0)
    impute[~np.isfinite(impute)]=0.
    train=np.where(np.isfinite(train),train,impute)
    scaler=RobustScaler(quantile_range=(10,90))
    scaled=scaler.fit_transform(train)
    model=LogisticRegression(C=.003,solver='lbfgs',max_iter=5000,random_state=57)
    weights=day_balanced_weights(f.ts.iloc[ix])
    model.fit(scaled,y,sample_weight=weights)
    assert (f.ts.iloc[ix]<f.ts.iloc[block_start]).all()
    assert (f.settlement_ts.iloc[ix]<f.ts.iloc[block_start]).all()
    hash_input=hashlib.sha256(np.asarray(ix,dtype=np.int64).tobytes()+np.asarray(train,dtype=np.float64).tobytes()+y.tobytes()+weights.tobytes()).hexdigest()
    bundle={'feature_order':list(matrix),'imputation':impute,'center':scaler.center_,'scale':scaler.scale_,
            'coefficient':model.coef_[0],'intercept':float(model.intercept_[0]),'classes':model.classes_,
            'fit_cutoff':f.ts.iloc[block_start],'train_start':f.ts.iloc[ix[0]],'train_end':f.ts.iloc[ix[-1]],
            'max_train_settlement':f.settlement_ts.iloc[ix].max(),'train_rows':len(ix),'train_data_sha256':hash_input,
            'iterations':model.n_iter_,'parameters':{'window_rows':WINDOW,'minimum_train_rows':MINIMUM,
            'C':.003,'solver':'lbfgs','max_iter':5000,'random_state':57,'quantile_range':[10,90],
            'weighting':'equal total weight per represented UTC day'}}
    return model,scaler,bundle,ix


def portable_probability(matrix,bundle):
    if isinstance(matrix,pd.DataFrame):x=matrix[bundle['feature_order']].to_numpy(float)
    else:x=np.asarray(matrix,float)
    x=np.where(np.isfinite(x),x,np.asarray(bundle['imputation']))
    scaled=(x-np.asarray(bundle['center']))/np.asarray(bundle['scale'])
    return expit(scaled@np.asarray(bundle['coefficient'])+bundle['intercept'])




def policy(f,probability):
    proposal=f.C85_proposal.to_numpy(np.int8)
    rank,count=directional_rank(probability,proposal)
    core=asymmetric_prediction(rank,proposal,.5,.7)
    assert (core[~f.core_valid.to_numpy(bool)]==0).all()
    base,extension=confirmed_extension(f,core,'last_yes_price',.03)
    sf=f[['ts','settlement_ts','label']].copy();sf['C71']=base;sf['source_valid']=f.structure_valid
    state=state_run(sf,'DUAL_SPEED')
    confidence=np.where(base==proposal,probability,1-probability)
    filter_rank,filter_count=rank_stream(confidence,base,f.structure_valid.to_numpy(bool))
    keep=f.structure_valid.to_numpy(bool)&~(state.risk_blocked.to_numpy()&(filter_rank<.4))
    p=np.where(keep,base,0).astype(np.int8)
    out=f[['ts','ticker','label','settlement_ts']].copy()
    for name,value in {'probability_correct':probability,'proposal':proposal,'rank':rank,'rank_count':count,
                       'core':core,'extension':extension,'base_prediction':base,'prediction':p,'filter_rank':filter_rank,
                       'filter_count':filter_count,'weak':state.risk_blocked,'latest_state_ns':state.latest_available_ns}.items():out[name]=value
    assert (state.latest_available_ns.to_numpy()<f.ts.astype('int64').to_numpy()+5_000_000_000).all()
    return out,state
