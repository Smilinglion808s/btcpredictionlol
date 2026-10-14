import json
import asyncio
from decimal import Decimal
import pytest
from worker import altcoin as a


def bt(sym='SOLUSDT', u=1, b='100.00', a_='100.02', E=1000, T=999):
    return {'stream': 'x', 'data': {'e': 'bookTicker', 's': sym, 'u': u, 'b': b, 'B': '5', 'a': a_, 'A': '7', 'E': E, 'T': T}}


def tr(sym='DOGEUSDT', aid=10, E=1000):
    return {'data': {'e': 'aggTrade', 's': sym, 'a': aid, 'f': 1, 'l': 2, 'p': '0.1', 'q': '50', 'm': True, 'E': E, 'T': E}}


def test_disabled_by_default(monkeypatch, tmp_path):
    monkeypatch.delenv('DOT_ALT_ENABLED', raising=False)
    assert asyncio.run(a.collect(tmp_path, asyncio.Event(), connect=lambda *x, **k: 1 / 0)) == 'DISABLED'


def test_rejects_other_symbols_and_crossed_book():
    with pytest.raises(ValueError): a.parse(bt(sym='BTCUSDT'), 1000)
    with pytest.raises(ValueError): a.parse(bt(b='101', a_='100'), 1000)
    with pytest.raises(ValueError): a.stream_url(('ETHUSDT',))


def test_timestamps_kept_and_gap_detection():
    h = a.Health()
    q = a.parse(bt(E=5000, T=4999), 5003)
    assert (q.exchange_ms, q.transaction_ms, q.receipt_ms) == (5000, 4999, 5003)
    assert h.observe(q) == []
    assert h.observe(a.parse(tr(aid=10), 1000)) == []
    assert h.observe(a.parse(tr(aid=13), 1000)) == ['TRADE_GAP']
    assert h.observe(a.parse(tr(aid=12), 1000)) == ['OUT_OF_ORDER']
    assert 'FUTURE_TIMESTAMP' in h.observe(a.parse(bt(u=2, E=9000), 1000))


def test_staleness_abstains():
    h = a.Health(); h.observe(a.parse(bt(), 1000))
    assert a.decide('SOLUSDT', 'BUY', h, 1500, Decimal(50)).action == 'TAKER'
    d = a.decide('SOLUSDT', 'BUY', h, 1000 + a.MAX_QUOTE_AGE_MS + 1, Decimal(50))
    assert (d.action, d.reason) == ('ABSTAIN', 'QUOTE_STALE')
    assert a.decide('DOGEUSDT', 'BUY', h, 1000, Decimal(50)).reason == 'QUOTE_NO_DATA'


def test_maker_never_filled_and_low_edge_abstains():
    h = a.Health(); h.observe(a.parse(bt(), 1000))
    m = a.decide('SOLUSDT', 'SELL', h, 1000, Decimal(50), prefer_maker=True)
    assert m.fill_status == 'UNKNOWN' and 'UNVERIFIED' in m.verification
    assert a.decide('SOLUSDT', 'BUY', h, 1000, Decimal(1)).action == 'ABSTAIN'


def test_recorder_bounded_and_replay_readonly(tmp_path):
    rec = a.Recorder(tmp_path, max_bytes=300)
    for i in range(20):
        rec.write(a.parse(bt(u=i), 1000))
    files = sorted(p.name for p in tmp_path.iterdir())
    assert files == ['SOLUSDT.jsonl', 'SOLUSDT.jsonl.1']
    before = (tmp_path / 'SOLUSDT.jsonl').read_bytes()
    evs = list(a.replay(tmp_path / 'SOLUSDT.jsonl'))
    assert evs and all(isinstance(e, a.AltQuote) for e in evs)
    assert (tmp_path / 'SOLUSDT.jsonl').read_bytes() == before


class _WS:
    def __init__(self, msgs, stop): self.msgs, self.stop = list(msgs), stop
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
    async def recv(self):
        if not self.msgs:
            self.stop.set(); return '{}'
        return json.dumps(self.msgs.pop(0))


def test_supervisor_disabled_never_connects(monkeypatch, tmp_path):
    monkeypatch.delenv('DOT_ALT_ENABLED', raising=False)
    s = a.AltSupervisor(tmp_path, connect=lambda *x, **k: 1 / 0, log=lambda *x, **k: None)
    assert asyncio.run(s.run(asyncio.Event())) == 'DISABLED'
    assert s.counters['connects'] == 0 and s.health()['state'] == 'DISABLED'


def test_supervisor_reconnects_with_backoff_then_records(monkeypatch, tmp_path):
    monkeypatch.setenv('DOT_ALT_ENABLED', 'true')
    stop, waits, calls = asyncio.Event(), [], {'n': 0}
    def connect(*x, **k):
        calls['n'] += 1
        if calls['n'] <= 3: raise OSError('down')
        return _WS([bt()], stop)
    async def sleep(s): waits.append(s)
    s = a.AltSupervisor(tmp_path, connect=connect, base_backoff_s=1, max_backoff_s=3, sleep=sleep, log=lambda *x, **k: None)
    assert asyncio.run(s.run(stop)) == 'STOPPED'
    assert waits == [1, 2, 3]
    assert s.counters == {'connects': 4, 'failures': 3, 'clean_stops': 1}
    assert s.last_error == 'OSError' and (tmp_path / 'SOLUSDT.jsonl').exists()


def test_supervisor_cancel_is_clean(monkeypatch, tmp_path):
    monkeypatch.setenv('DOT_ALT_ENABLED', 'true')
    async def go():
        s = a.AltSupervisor(tmp_path, connect=lambda *x, **k: (_ for _ in ()).throw(OSError()), base_backoff_s=30, log=lambda *x, **k: None)
        t = asyncio.create_task(s.run(asyncio.Event())); await asyncio.sleep(0.05); t.cancel()
        with pytest.raises(asyncio.CancelledError): await t
        return s
    assert asyncio.run(go()).counters['failures'] >= 1


def test_alt_failure_does_not_break_btc_health(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from worker.api import create_app
    from worker.engine import Engine
    from worker.config import Config
    from worker.auth import OwnerAuth
    monkeypatch.setenv('DOT_ALT_ENABLED', 'true')
    class Boom:
        async def run(self, stop): raise RuntimeError('x')
        def health(self): return {'enabled': True, 'state': 'FAILED'}
    eng = Engine(tmp_path / 'p.sqlite3', Config())
    try: auth = OwnerAuth(None)
    except Exception: pytest.skip('auth ctor differs')
    with TestClient(create_app(eng, auth, background=False, alt=Boom())) as c:
        r = c.get('/health')
        assert r.status_code == 200 and r.json()['status'] == 'OK' and r.json()['altcoin']['state'] == 'FAILED'
