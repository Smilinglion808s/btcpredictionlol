"""Dispatch regressions: production model/gates, mocked clock and transport."""
import json
from test_reversal import runtime
from test_calibration import integrated
import v3core as V


def test_no_dispatch_before_t45_even_with_a_pass_record():
    e, rr, c, clock, f = runtime(threshold=1)
    rr.score(c, f['bars'], clock[0])
    clock[0] = (c+45)*1000-1
    assert e.prepare_due() == []
    clock[0] += 1
    assert len(e.prepare_due()) == 1


def test_early_dispatch_still_requires_verified_market():
    e, rr, c, clock, f = runtime(threshold=1)
    rr.score(c, f['bars'], clock[0])
    e.s.q('DELETE FROM markets')
    assert e.prepare_due() == []
    e.record_markets([{'ticker': V.kalshi_ticker(c),
                      'close_time': V.iso_ms((c+900)*1000)}], V.KALSHI_SERIES)
    assert len(e.prepare_due()) == 1


def test_retry_and_restart_preserve_early_body_and_t49_expiry():
    e, rr, c, clock, f = runtime(threshold=1)
    rr.score(c, f['bars'], clock[0])
    [eid] = e.prepare_due()
    original = e.deliverable()
    e.record_attempt(eid, 503, 'simulated retry')
    restarted = V.Engine(e.s, now_ms=lambda: clock[0], risk_mode='enforce', delivery_enabled=True)
    clock[0] = (c+47)*1000
    assert restarted.prepare_due() == []
    assert restarted.deliverable() == original
    clock[0] = (c+49)*1000
    restarted.prepare_due()
    assert restarted.deliverable() == []


def test_disabled_sender_only_captures():
    e, rr, c, clock, f = runtime(threshold=1)
    e.delivery_enabled = False
    rr.score(c, f['bars'], clock[0])
    assert len(e.prepare_due()) == 1
    assert e.deliverable() == []


def test_shadow_calibration_does_not_delay_or_gate_risk_pass():
    e, rr, cr, c, clock, f = integrated(mode='shadow', p=None)
    assert len(e.prepare_due()) == 1
    body = json.loads(e.deliverable()[0][1])
    assert body['risk_filter']['status'] == 'PASS'
    assert 'calibration_filter' not in body


def test_enforced_calibration_veto_cannot_race_sender():
    e, rr, cr, c, clock, f = integrated(p=.54)
    assert e.prepare_due() == []
    assert cr.score(c, f['bars'], clock[0])['reason'] == 'SKIP_BASELINE'
    assert e.prepare_due() == [] and e.deliverable() == []


def test_risk_off_keeps_t48_dispatch():
    e, rr, c, clock, f = runtime(mode='off', threshold=1)
    assert e.prepare_due() == []
    clock[0] = (c+48)*1000
    assert len(e.prepare_due()) == 1
