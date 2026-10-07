"""Calibration math and live integration. All data/network/sending are simulated."""
import copy
import json
import math
import sys
from pathlib import Path
from unittest import mock

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT/'src'))
import calibration as C
import reversal as R
import v3core as V
from calibration_runtime import CalibrationRuntime
from test_reversal import runtime, HEAD


def rehash(h):
    h['sha256'] = C.fingerprint({k:v for k,v in h.items() if k!='sha256'})
    return h


def test_tracking_uses_official_settlements_and_excludes_warmup():
    from datetime import datetime
    from zoneinfo import ZoneInfo
    e, rr, cr, c, clock, f = integrated(mode='shadow', p=None)
    now = int(datetime(2026, 10, 7, 12, tzinfo=ZoneInfo('America/Boise')).timestamp())
    rows = [(now-86400, 'PASS', 'KEEP_BASELINE', 1, 1),
            (now-4500, 'PASS', 'ADD_LOWER60', -1, 1),
            (now-3600, 'PASS', 'KEEP_BASELINE', 1, None),
            (now-2700, 'SKIP', 'SKIP_BASELINE', 0, 1),
            (now-1800, 'INVALID', 'CALIBRATION_HEAD_MISSING', 0, 1),
            (now-900, 'NO_CANDIDATE', 'NO_RISK_PASSED_CANDIDATE', 0, None)]
    for at, status, reason, direction, label in rows:
        body = json.dumps({'result':dict(status=status,reason=reason,direction=direction)})
        e.s.q('INSERT INTO calibration_observations VALUES(?,?,?,?,?,?)',
              (at,body,1,label,at+900 if label else None,C.LIVE_LINEAGE))
    cr.refresh_tracking(now)
    t = cr.health(now)['calibration_tracking']
    assert t['total'] == dict(observations=6,scored=4,calls=3,kept=2,added=1,skipped=1,
                             wins=1,losses=1,pending=1,net=0,win_rate=.5)
    assert t['today']['wins'] == 0 and t['today']['losses'] == 1
    assert t['boise_day'] == '2026-10-07'
    assert t['latest']['status'] == 'NO_CANDIDATE'
    e.s.q('UPDATE calibration_observations SET label=1,settlement_s=? WHERE candle_s=?', (now,now-3600))
    cr.refresh_tracking(now)
    assert cr.tracking['total']['wins'] == 2 and cr.tracking['total']['pending'] == 0


def training(b, lineage=C.LIVE_LINEAGE):
    cs = np.linspace(b-26*C.WEEK+900, b-C.DAY-1800, 800).astype(int)//900*900
    return [dict(candle_s=int(c), side=1, label=1 if i%3 else -1,
                 settlement_s=int(c)+900, loss_probability=.1+.7*(i%100)/100,
                 evaluated_at_ms=(int(c)+45)*1000+10, lineage=lineage,
                 risk_valid_from_s=R.week_start(int(c)), risk_valid_until_s=R.week_start(int(c))+C.WEEK,
                 risk_max_settlement_s=R.week_start(int(c))-C.DAY-900,
                 risk_head_sha256='a'*64) for i,c in enumerate(cs)]


def fitted(b, p=None, lineage=C.LIVE_LINEAGE):
    h=C.fit(training(b,lineage),b,b-26*C.WEEK,lineage)
    if p is not None:
        h['coef']=[0.];h['intercept']=math.log(p/(1-p));rehash(h)
    return h


def integrated(mode='enforce', p=.7, baseline=True, threshold=1):
    e,rr,c,clock,f=runtime(threshold=threshold)
    e.calibration_mode=mode
    if baseline:
        assert rr.score(c,f['bars'],clock[0])['status'] in ('PASS','SKIP')
    else:
        audit={f't{cp}':{'reason':None,'at_ms':(c+cp)*1000+10,'probability':.7,'rank':.65}
               for cp in (15,30)}
        e._set_decision(c,'NO_CALL',audit=audit)
        for cp in (15,30):
            h={'valid_from_s':c-c%C.DAY,'checkpoint':cp}
            e.s.q('INSERT INTO heads VALUES(?,?,?,?)',(cp,c-c%C.DAY,json.dumps(h),'test'))
    cr=CalibrationRuntime(e,rr,None)
    if p is not None:
        b=C.week_start(c);h=fitted(b,p)
        e.s.q('INSERT INTO calibration_heads VALUES(?,?,?)',(b,C.LIVE_LINEAGE,json.dumps(h)))
    return e,rr,cr,c,clock,f


@pytest.mark.parametrize('base,candidate,p,want',[(1,1,.55,(1,'KEEP_BASELINE')),
    (1,1,np.nextafter(.55,0),(0,'SKIP_BASELINE')),(0,-1,.64,(-1,'ADD_LOWER60')),
    (0,-1,np.nextafter(.64,0),(0,'DECLINE_LOWER60')),(0,0,None,(0,'NO_CANDIDATE'))])
def test_thresholds(base,candidate,p,want):
    assert C.route(base,candidate,p)==want


def test_side_and_nonfinite_rejected():
    with pytest.raises(C.CalibrationInvalid):C.route(1,-1,.9)
    with pytest.raises(C.CalibrationInvalid):C.route(0,1,float('nan'))
    for p in [-.1,1.1,float('nan'),float('inf')]:
        with pytest.raises(C.CalibrationInvalid):C.feature(p)
    assert np.isfinite(C.feature(0)) and np.isfinite(C.feature(1))


def test_fit_excludes_future_and_unsettled_and_requires_full_history():
    b=C.week_start(HEAD['valid_from_s']);rows=training(b)
    expected=C.fit(rows,b,b-26*C.WEEK)
    future=dict(rows[0],candle_s=b-900,settlement_s=b+900,label=-rows[0]['label'])
    unsettled=dict(rows[0],candle_s=b-1800,settlement_s=None)
    assert C.fit(rows+[future,unsettled],b,b-26*C.WEEK)==expected
    with pytest.raises(C.CalibrationInvalid,match='26_WEEK'):C.fit(rows,b,b-8*C.WEEK)
    with pytest.raises(C.CalibrationInvalid,match='DUPLICATE'):C.fit(rows+[rows[0]],b,b-26*C.WEEK)
    corrupted=copy.deepcopy(rows);corrupted[0]['lineage']=C.PROXY_LINEAGE
    with pytest.raises(C.CalibrationInvalid,match='PROVENANCE'):C.fit(corrupted,b,b-26*C.WEEK)
    corrupted=copy.deepcopy(rows);corrupted[0]['risk_max_settlement_s']=corrupted[0]['candle_s']
    with pytest.raises(C.CalibrationInvalid,match='PROVENANCE'):C.fit(corrupted,b,b-26*C.WEEK)


@pytest.mark.parametrize('issue',['expired','hash','lineage','recipe','cutoff','scale','future','shape'])
def test_invalid_heads(issue):
    b=C.week_start(HEAD['valid_from_s']);h=fitted(b);c=b
    if issue=='expired':c=h['valid_until_s']
    elif issue=='hash':h['intercept']+=.1
    elif issue=='lineage':h['lineage']=C.PROXY_LINEAGE;rehash(h)
    elif issue=='recipe':h['recipe']['add_min']=.60;rehash(h)
    elif issue=='cutoff':h['max_settlement_s']=b;rehash(h)
    elif issue=='scale':h['scale']=[0];rehash(h)
    elif issue=='future':h['valid_from_s']+=C.WEEK;rehash(h)
    else:del h['mean'];rehash(h)
    with pytest.raises(C.CalibrationInvalid):C.predict(h,.3,c)


def test_keep_timing_and_one_frozen_outbox():
    e,rr,cr,c,clock,f=integrated()
    out=cr.score(c,f['bars'],clock[0]);assert out['reason']=='KEEP_BASELINE'
    assert e.prepare_due()==[]
    clock[0]=(c+48)*1000;assert len(e.prepare_due())==1
    sent=e.deliverable();assert len(sent)==1
    assert json.loads(sent[0][1])['calibration_filter']['version']==C.VERSION
    cr2=CalibrationRuntime(e,rr,None)
    assert cr2.score(c,[],clock[0])==out
    assert e.prepare_due()==[] and e.deliverable()==sent
    clock[0]=(c+49)*1000;e.prepare_due();assert e.deliverable()==[]


def test_skip_keeps_virtual_population_and_original_risk_row():
    e,rr,cr,c,clock,f=integrated(p=.54)
    assert cr.score(c,f['bars'],clock[0])['reason']=='SKIP_BASELINE'
    assert e._decision(c)==('NO_CALL',15,1)
    assert e.s.q('SELECT side FROM calibration_observations WHERE candle_s=?',(c,))==[(1,)]
    assert e.s.q('SELECT side FROM reversal_rows WHERE candle_s=?',(c,))==[(1,)]
    clock[0]=(c+48)*1000;assert e.prepare_due()==[]


def test_lower_candidate_recomputed_and_does_not_pollute_reversal_training():
    e,rr,cr,c,clock,f=integrated(baseline=False)
    before=e.s.q('SELECT COUNT(*) FROM reversal_rows')[0][0]
    with mock.patch('calibration_runtime.F.build',wraps=__import__('reversal_features').build) as build:
        out=cr.score(c,f['bars'],clock[0])
        assert build.call_args.args[-2:]==(1,.65)
    assert out['reason']=='ADD_LOWER60' and e._decision(c)==('SELECTED',15,1)
    assert e.s.q('SELECT COUNT(*) FROM reversal_rows')[0][0]==before
    clock[0]=(c+48)*1000;assert len(e.prepare_due())==1
    assert json.loads(e.deliverable()[0][1])['confidence_rank']==.65


def test_lower_candidate_declined_and_risk_skip_cannot_be_overridden():
    e,rr,cr,c,clock,f=integrated(baseline=False,p=.63)
    assert cr.score(c,f['bars'],clock[0])['reason']=='DECLINE_LOWER60'
    assert e._decision(c)[0]=='NO_CALL'


def test_original_passed_t30_side_wins_over_opposite_lower_t15():
    e,rr,c,clock,f=runtime(threshold=1)
    e.calibration_mode='enforce'
    audits={'t15':{'reason':None,'at_ms':(c+15)*1000+10,'probability':.7,'rank':.65},
            't30':{'reason':None,'at_ms':(c+30)*1000+10,'probability':.2,'rank':.8}}
    e._set_decision(c,'SELECTED',None,30,-1,.8,(c+30)*1000+10,'original-t30',audits)
    assert rr.score(c,f['bars'],clock[0])['status']=='PASS'
    cr=CalibrationRuntime(e,rr,None);b=C.week_start(c);h=fitted(b,.7)
    e.s.q('INSERT INTO calibration_heads VALUES(?,?,?)',(b,C.LIVE_LINEAGE,json.dumps(h)))
    assert cr.score(c,f['bars'],clock[0])['reason']=='KEEP_BASELINE'
    assert e._decision(c)==('SELECTED',30,-1)
    assert e.s.q('SELECT side FROM calibration_observations WHERE candle_s=?',(c,))==[(-1,)]


def test_lower_t30_and_invalid_t15_timing():
    e,rr,cr,c,clock,f=integrated(baseline=False)
    e._audit(c,{'t15':{'reason':None,'at_ms':(c+15)*1000+10,'probability':.7,'rank':.59}})
    assert cr.score(c,f['bars'],clock[0])['reason']=='ADD_LOWER60'
    assert e._decision(c)==('SELECTED',30,1)
    e,rr,cr,c,clock,f=integrated(baseline=False)
    e._audit(c,{'t15':{'reason':'CHECKPOINT_LATE','at_ms':(c+16)*1000}})
    assert cr.score(c,f['bars'],clock[0])['status']=='INVALID'
    assert e._decision(c)[0]=='FAIL_CLOSED'
    e,rr,cr,c,clock,f=integrated(baseline=False,p=.99,threshold=0)
    assert cr.score(c,f['bars'],clock[0])['status']=='NO_CANDIDATE'
    assert e._decision(c)[0]=='NO_CALL'


def test_shadow_matches_baseline_body_even_without_head():
    e,rr,cr,c,clock,f=integrated(mode='shadow',p=None)
    before=e.body_for(c,(c+48)*1000,V.kalshi_ticker(c))
    result=cr.score(c,f['bars'],clock[0])
    assert result['status']=='INVALID' and result['reason']=='CALIBRATION_HEAD_MISSING'
    assert e._decision(c)==('SELECTED',15,1)
    assert e.body_for(c,(c+48)*1000,V.kalshi_ticker(c))==before
    assert e.s.q('SELECT side FROM calibration_observations WHERE candle_s=?',(c,))==[(1,)]


@pytest.mark.parametrize('issue',['head','early','late','feed','clock','prefix','operational'])
def test_invalid_candidate_cannot_send(issue):
    e,rr,cr,c,clock,f=integrated(p=None if issue=='head' else .7)
    if issue=='early':clock[0]=(c+45)*1000-1
    if issue=='late':clock[0]=(c+46)*1000
    if issue=='prefix':f['bars'].pop()
    if issue=='operational':e._set_decision(c,'FAIL_CLOSED','CHECKPOINT_LATE')
    out=cr.score(c,f['bars'],clock[0],feed_ok=issue!='feed',clock_ok=issue!='clock')
    assert out['status']=='INVALID'
    clock[0]=(c+48)*1000;assert e.prepare_due()==[] and e.deliverable()==[]


def test_old_outbox_and_shadow_audit_cannot_bypass_enforcement():
    e,rr,cr,c,clock,f=integrated(mode='shadow')
    cr.score(c,f['bars'],clock[0]);clock[0]=(c+48)*1000
    assert len(e.prepare_due())==1 and len(e.deliverable())==1
    e.calibration_mode='enforce';assert e.deliverable()==[]
    e,rr,cr,c,clock,f=integrated(mode='shadow')
    cr.score(c,f['bars'],clock[0]);e.calibration_mode='enforce';clock[0]=(c+48)*1000
    assert e.prepare_due()==[]


def test_official_settlement_and_cold_start_are_explicit():
    e,rr,cr,c,clock,f=integrated(mode='shadow',p=None)
    cr.score(c,f['bars'],clock[0])
    cr.market=mock.Mock();cr.market.settled_market.return_value={
        'ticker':V.kalshi_ticker(c),'status':'finalized','result':'yes','settlement_ts':V.iso_ms((c+901)*1000)}
    cr.settle_and_refit(c+1000)
    assert e.s.q('SELECT label,settlement_s FROM calibration_observations')==[(1,float(c+901))]
    assert e.faults['calibration_warmup']=='CALIBRATION_26_WEEK_HISTORY_REQUIRED'
    assert e.s.q('SELECT COUNT(*) FROM calibration_heads')[0][0]==0
    assert cr.health(c)['calibration_ready'] is False


def test_modes_and_week_boundaries():
    for kw in [dict(calibration_mode='typo'),dict(calibration_mode='enforce'),
               dict(calibration_mode='shadow',risk_mode='shadow')]:
        with pytest.raises(V.FailClosed):V.Engine(V.Store(':memory:'),**kw)
    assert C.week_start(C.ANCHOR)==C.ANCHOR
    assert C.week_start(C.ANCHOR+C.WEEK-1)==C.ANCHOR
    assert C.week_start(HEAD['valid_from_s'])==HEAD['valid_from_s']-6*3600
