"""Real-package reconstruction parity and safe bootstrap boundaries."""
import copy
import json
import shutil
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT/'src'))
import calibration as C
import calibration_backfill as B
from calibration_runtime import CalibrationRuntime
from v3core import Engine, Store


@pytest.fixture(scope='module')
def package():
    return B.read_package()


def runtime(tmp_path):
    e = Engine(Store(tmp_path/'v3.sqlite'), calibration_mode='shadow', risk_mode='enforce')
    return e, CalibrationRuntime(e, None, None)


def test_real_backfill_parity_idempotence_and_forward_separation(tmp_path, package):
    seed, head, audit, _ = package
    now = seed['reconstructed_at_s'] + 1
    e, cr = runtime(tmp_path)
    proof = B.install(e.s, now)
    assert proof['inserted_rows'] == audit['reconstructed_intervals'] == 17296
    assert proof['settled_candidates'] == 5828
    assert cr.head(now) == head
    assert head['training_rows'] == 5811
    assert B.install(e.s, now+1) == proof
    assert e.s.q('SELECT COUNT(*) FROM decisions')[0][0] == 0
    assert e.s.q('SELECT COUNT(*) FROM outbox')[0][0] == 0
    # Even an incorrectly labeled historical result must never become a forward win.
    c = seed['observations'][0]['candle_s']
    e.s.q("UPDATE calibration_observations SET body=json_set(body,'$.result.status','PASS','$.result.direction',1),label=1 WHERE candle_s=?", (c,))
    cr.refresh_tracking(now)
    h = cr.health(now)
    assert h['calibration_ready']
    assert h['calibration_backfilled_observations'] == 17296
    assert h['calibration_forward_observations'] == 0
    assert cr.tracking['total']['observations'] == 0
    assert cr.tracking['total']['wins'] == 0 and cr.tracking['latest'] is None
    future = C.week_start(now)+2*C.WEEK
    assert not cr.health(future)['calibration_ready']


def test_existing_live_observation_and_head_preserved(tmp_path, package):
    seed, head, _, _ = package
    e, cr = runtime(tmp_path)
    c = seed['observations'][0]['candle_s']
    body = json.dumps({'result':{'status':'NO_CANDIDATE','direction':0,'reason':'OBSERVED'}})
    e.s.q('INSERT INTO calibration_observations VALUES(?,?,0,NULL,NULL,?)', (c,body,C.LIVE_LINEAGE))
    B.install(e.s, seed['reconstructed_at_s']+1)
    assert e.s.q('SELECT body FROM calibration_observations WHERE candle_s=?',(c,))[0][0] == body
    assert e.s.meta('calibration_backfill')['preserved_rows'] == 1
    # The packaged fit is not installed over a changed underlying population.
    assert not e.s.q('SELECT * FROM calibration_heads')
    cr.refresh_tracking(seed['reconstructed_at_s']+1)
    assert cr.tracking['total']['observations'] == 1


def test_atomic_rollback_on_database_error(tmp_path, package):
    e, cr = runtime(tmp_path)
    seed = package[0]
    bad = seed['observations'][10]['candle_s']
    e.s.q(f"CREATE TRIGGER fail_import BEFORE INSERT ON calibration_observations WHEN NEW.candle_s={bad} BEGIN SELECT RAISE(ABORT,'test'); END")
    with pytest.raises(sqlite3.IntegrityError):B.install(e.s, seed['reconstructed_at_s']+1)
    assert e.s.q('SELECT COUNT(*) FROM calibration_observations')[0][0] == 0
    assert not e.s.q('SELECT * FROM calibration_heads')
    assert e.s.meta('calibration_backfill') is None


def test_corrupt_archive_rejected(tmp_path):
    target = tmp_path/'package';shutil.copytree(B.PACKAGE,target)
    with (target/'seed.json.gz').open('ab') as f:f.write(b'corrupt')
    e, cr = runtime(tmp_path)
    with pytest.raises(C.CalibrationInvalid,match='HASH'):B.install(e.s,10**10,target)
    assert not e.s.q('SELECT * FROM calibration_observations')


@pytest.mark.parametrize('issue',['duplicate','proxy','fake_live_time','future_settlement','risk_hash','score','rank','feature_cutoff'])
def test_semantic_corruption_rejected(package, issue):
    seed, head, audit, _ = copy.deepcopy(package)
    obs = next(o for o in seed['observations'] if o['candidate'])
    candidate = obs['candidate']
    if issue == 'duplicate':seed['observations'].insert(1,seed['observations'][0])
    elif issue == 'proxy':candidate['lineage']=C.PROXY_LINEAGE
    elif issue == 'fake_live_time':candidate['evaluated_at_ms']=candidate['replay_at_ms']
    elif issue == 'future_settlement':obs['settlement_s']=seed['reconstructed_at_s']+1
    elif issue == 'risk_hash':candidate['risk_head_sha256']='a'*64
    elif issue == 'score':candidate['loss_probability']+=.01
    elif issue == 'rank':candidate['rank']=.59
    elif issue == 'feature_cutoff':candidate['feature_asof_ms']+=1
    with pytest.raises(C.CalibrationInvalid):B.validate(seed,head,audit,seed['reconstructed_at_s']+1)


def test_expired_package_imports_history_without_reviving_old_head(tmp_path, package):
    e, cr = runtime(tmp_path)
    head = package[1]
    B.install(e.s,head['valid_until_s']+1)
    assert not e.s.q('SELECT * FROM calibration_heads')
    assert e.s.q('SELECT COUNT(*) FROM calibration_observations')[0][0] == 17296
