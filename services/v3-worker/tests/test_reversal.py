"""Offline reversal tests: no network, no order or webhook calls."""
from pathlib import Path
import gzip,json,sys,tempfile,copy
import numpy as np
import pytest

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'src'))
import reversal as R
import reversal_features as F
import v3core as V
from reversal_runtime import RiskRuntime

PKG=ROOT/'risk_package'
HEAD=json.loads((PKG/'head.json').read_text())
ORIGINAL=json.loads(gzip.decompress((PKG/'parity_fixture.json.gz').read_bytes()))
FEATURE_FIX=json.loads(gzip.decompress((PKG/'features_fixture.json.gz').read_bytes()))


def rehash(h):
    h['sha256']=R.fingerprint({k:v for k,v in h.items() if k!='sha256'});return h


def example(c):
    f=copy.deepcopy(FEATURE_FIX[0]);delta=(c-f['candle_s'])*1000
    for b in f['bars']:b['open_ms']+=delta;b['close_ms']+=delta
    f['context']['candle_s']=c;f['context']['asof_ms']=c*1000-1
    return f


def runtime(mode='enforce',threshold=None):
    c=HEAD['valid_from_s']+900
    clock=[(c+45)*1000+10]
    e=V.Engine(V.Store(':memory:'),now_ms=lambda:clock[0],risk_mode=mode,delivery_enabled=True)
    rr=RiskRuntime(e,None)
    e._set_decision(c,'SELECTED',None,15,1,.8,(c+15)*1000,'test-fit')
    e.record_markets([{'ticker':V.kalshi_ticker(c),'close_time':V.iso_ms((c+900)*1000)}],V.KALSHI_SERIES)
    f=example(c);rr.context=f['context']
    if threshold is not None:
        h=copy.deepcopy(HEAD);h['threshold']=threshold;rehash(h)
        e.s.q('UPDATE reversal_heads SET body=? WHERE week_s=?',(json.dumps(h),h['valid_from_s']))
    return e,rr,c,clock,f


def test_original_t45_scorer_fixture():
    for row in ORIGINAL:
        p,skip=R.predict(row['head'],row['features'],row['candle_s'],
                         't45-price-flow-q375-r1','reversal50-original-t45-r1')
        assert abs(p-row['p'])<1e-12 and skip==row['skip']


def test_raw_feature_parity():
    for row in FEATURE_FIX:
        got=F.build(row['bars'],row['context'],row['candle_s'],row['side'],row['rank'])
        np.testing.assert_allclose([got[k] for k in R.FEATURES],
                                   [row['expected'][k] for k in R.FEATURES],rtol=1e-7,atol=1e-8)


@pytest.mark.parametrize('issue',['missing','duplicate','nonfinal','future','missing_count','infinite'])
def test_prefix_failure_is_not_imputed(issue):
    row=copy.deepcopy(FEATURE_FIX[0]);b=row['bars']
    if issue=='missing':b.pop()
    elif issue=='duplicate':b[-1]=b[-2]
    elif issue=='nonfinal':b[2]['is_final']=False
    elif issue=='future':b[-1]['open_ms']+=1000;b[-1]['close_ms']+=1000
    elif issue=='missing_count':b[4]['count']=None
    else:b[3]['close']=float('inf')
    with pytest.raises(R.RiskInvalid):F.build(b,row['context'],row['candle_s'],row['side'],row['rank'])


def test_context_other_candle_fails():
    row=copy.deepcopy(FEATURE_FIX[0]);row['context']['asof_ms']+=900000
    with pytest.raises(R.RiskInvalid):F.build(row['bars'],row['context'],row['candle_s'],row['side'],row['rank'])


def test_unknown_or_asap_enforcement_refused():
    with pytest.raises(V.FailClosed):V.Engine(V.Store(':memory:'),risk_mode='typo')
    with pytest.raises(V.FailClosed):V.Engine(V.Store(':memory:'),risk_mode='enforce',delivery_policy='asap-r1')


@pytest.mark.parametrize('problem',['expired','hash','schema','order','cutoff','settlement','scale'])
def test_bad_artifact_rejected(problem):
    h=copy.deepcopy(HEAD);c=h['valid_from_s']
    if problem=='expired':c=h['valid_until_s']
    elif problem=='hash':h['intercept']+=1
    elif problem=='schema':h['feature_schema']='other';rehash(h)
    elif problem=='order':h['feature_order']=list(reversed(h['feature_order']));rehash(h)
    elif problem=='cutoff':h['training_last_s']=h['training_cutoff_s'];rehash(h)
    elif problem=='settlement':h['max_settlement_s']=h['training_cutoff_s'];rehash(h)
    else:h['scale'][0]=0;rehash(h)
    with pytest.raises(R.RiskInvalid):R.validate(h,c)


def test_threshold_ties_skip_and_missing_keys_fail():
    h=copy.deepcopy(HEAD);x=FEATURE_FIX[0]['expected'];c=h['valid_from_s']
    p,_=R.predict(h,x,c);h['threshold']=p;rehash(h)
    assert R.predict(h,x,c)[1]
    with pytest.raises(R.RiskInvalid):R.predict(h,{},c)


def test_skip_suppresses_and_preserves_direction_and_training_row():
    e,rr,c,clock,f=runtime(threshold=0)
    result=rr.score(c,f['bars'],clock[0])
    assert result['status']=='SKIP'
    assert e._decision(c)==('NO_CALL',15,1)
    assert e.s.q('SELECT side FROM reversal_rows WHERE candle_s=?',(c,))==[(1,)]
    clock[0]=(c+48)*1000
    assert e.prepare_due()==[] and e.deliverable()==[]


def test_pass_has_no_early_send_and_exactly_one_immutable_event():
    e,rr,c,clock,f=runtime(threshold=1)
    assert rr.score(c,f['bars'],clock[0])['status']=='PASS'
    assert e.prepare_due()==[]
    clock[0]=(c+48)*1000
    assert len(e.prepare_due())==1
    original=e.deliverable()
    assert len(original)==1
    body=json.loads(original[0][1]);assert body['risk_filter']['status']=='PASS'
    assert body['checkpoint_seconds']==15 and body['prediction']=='YES'
    assert rr.score(c,[],clock[0])['status']=='PASS'
    assert e.prepare_due()==[] and e.deliverable()==original
    clock[0]=(c+49)*1000
    e.prepare_due();assert e.deliverable()==[]


@pytest.mark.parametrize('why',['early','late','feed','clock','context','head'])
def test_runtime_failure_blocks(why):
    e,rr,c,clock,f=runtime(threshold=1)
    if why=='early':clock[0]=(c+45)*1000-1
    if why=='late':clock[0]=(c+46)*1000
    if why=='context':rr.context=None
    if why=='head':e.s.q('DELETE FROM reversal_heads')
    result=rr.score(c,f['bars'],clock[0],feed_ok=why!='feed',clock_ok=why!='clock')
    assert result['status']=='INVALID'
    assert e._decision(c)[0]=='FAIL_CLOSED'
    clock[0]=(c+48)*1000
    assert e.prepare_due()==[]


def test_missing_gate_and_prepatch_outbox_cannot_bypass():
    e,rr,c,clock,f=runtime()
    clock[0]=(c+48)*1000
    assert e.prepare_due()==[]
    e.risk_mode='off';assert len(e.prepare_due())==1
    e.risk_mode='enforce';assert e.deliverable()==[]


def test_shadow_never_changes_original_selection():
    e,rr,c,clock,f=runtime(mode='shadow',threshold=0)
    assert rr.score(c,f['bars'],clock[0])['status']=='SKIP'
    assert e._decision(c)==('SELECTED',15,1)
    clock[0]=(c+48)*1000;assert len(e.prepare_due())==1


def test_training_future_and_unsettled_rows_do_not_affect_fit():
    rows=json.loads(gzip.decompress((PKG/'seed.json.gz').read_bytes()))
    b=HEAD['valid_from_s'];h=R.fit(rows,b)
    extra=dict(rows[0],candle_s=b-900,label=-rows[0]['label'],settlement_s=b+900)
    assert R.fit(rows+[extra],b)==h
    duplicate=dict(rows[0]);duplicate['candle_s']=b-900;duplicate['settlement_s']=None
    assert R.fit(rows+[duplicate],b)==h


def test_head_boundaries_are_fixed_research_anchor():
    assert R.week_start(R.ANCHOR)==R.ANCHOR
    assert R.week_start(R.ANCHOR+R.WEEK-1)==R.ANCHOR
    assert R.week_start(R.ANCHOR+R.WEEK)==R.ANCHOR+R.WEEK
