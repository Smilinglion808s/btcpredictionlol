import asyncio, json
import pytest
from alt import core, main as m


def bt(sym='SOLUSDT', u=1, E=1000):
    return {'data': {'e': 'bookTicker', 's': sym, 'u': u, 'b': '100.00', 'B': '5', 'a': '100.02', 'A': '7', 'E': E, 'T': E - 1}}


class WS:
    def __init__(self, msgs, stop): self.msgs, self.stop = list(msgs), stop
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
    async def recv(self):
        if not self.msgs: self.stop.set(); return '{}'
        return json.dumps(self.msgs.pop(0))


def test_rejects_disallowed_symbol_and_crossed_book():
    with pytest.raises(ValueError): core.parse(bt(sym='BTCUSDT'), 1)
    with pytest.raises(ValueError): core.stream_url(('ETHUSDT',))


def test_handle_records_timestamps_and_latest(tmp_path):
    c = m.Collector(tmp_path, clock=lambda: 1003)
    c.handle(json.dumps(bt())); c.handle('not json')
    q = c.latest['SOLUSDT']['quote']
    assert (q['exchange_ms'], q['transaction_ms'], q['receipt_ms']) == (1000, 999, 1003)
    assert c.counters['events'] == 1 and c.counters['rejected'] == 1
    assert (tmp_path / 'events' / 'SOLUSDT.jsonl').exists()


def test_health_conservative_statuses_and_staleness(tmp_path):
    t = {'now': 1000}
    c = m.Collector(tmp_path, clock=lambda: t['now'])
    c.handle(json.dumps(bt())); c.state = 'RUNNING'
    h = c.health_doc()
    assert h['state'] == 'RUNNING' and h['real_orders_supported'] is False
    s = h['symbols']['SOLUSDT']
    assert s['maker_status'] == 'UNKNOWN' and s['taker_verification'] == 'TOP_OF_BOOK_ONLY_SIZE_UNCHECKED'
    assert h['symbols']['DOGEUSDT']['quote_state'] == 'NO_DATA'
    t['now'] = 1000 + m.STALE_MS + 1
    assert c.health_doc()['state'] == 'STALE'


def test_reconnect_backoff(tmp_path):
    stop, waits, n = asyncio.Event(), [], {'n': 0}
    def connect(*a, **k):
        n['n'] += 1
        if n['n'] <= 3: raise OSError()
        return WS([bt()], stop)
    async def sleep(s): waits.append(s)
    c = m.Collector(tmp_path, connect=connect, base_backoff_s=1, max_backoff_s=3, sleep=sleep)
    asyncio.run(c.run(stop))
    assert waits == [1, 2, 3] and c.counters['failures'] == 3 and c.state == 'STOPPED'


def test_rotation_bounded(tmp_path):
    r = core.Recorder(tmp_path, max_bytes=300)
    for i in range(20): r.write(core.parse(bt(u=i), 1000))
    assert sorted(p.name for p in (tmp_path / 'events').iterdir()) == ['SOLUSDT.jsonl', 'SOLUSDT.jsonl.1']


def test_http_endpoints_read_only(tmp_path):
    async def go():
        c = m.Collector(tmp_path, clock=lambda: 1000); c.handle(json.dumps(bt()))
        srv = await m.serve_http(c, '127.0.0.1', 0); port = srv.sockets[0].getsockname()[1]
        async def req(line):
            r, w = await asyncio.open_connection('127.0.0.1', port)
            w.write(line.encode() + b'\r\n\r\n'); await w.drain()
            data = await r.read(); w.close()
            head, body = data.split(b'\r\n\r\n', 1); return head.split()[1], json.loads(body)
        out = [await req('GET /health HTTP/1.1'), await req('GET /events/latest HTTP/1.1'), await req('POST /health HTTP/1.1')]
        srv.close(); return out
    (h, hb), (e, eb), (p, _) = asyncio.run(go())
    assert (h, e, p) == (b'200', b'200', b'405')
    assert hb['mode'] == 'PAPER' and eb['symbols']['SOLUSDT']['quote']['update_id'] == 1


def test_mount_root_metadata_ignored_but_events_dir_strict(tmp_path):
    (tmp_path / 'lost+found').mkdir(); (tmp_path / '.railway-meta').write_text('x')
    r = core.Recorder(tmp_path); r.write(core.parse(bt(), 1000))
    assert (tmp_path / 'lost+found').is_dir() and (tmp_path / '.railway-meta').read_text() == 'x'
    (tmp_path / 'events' / 'junk.txt').write_text('x')
    with pytest.raises(ValueError, match='ALT_UNEXPECTED_FILE'): core.Recorder(tmp_path)


def test_events_dir_symlink_and_hardlink_rejected(tmp_path):
    import os
    a = tmp_path / 'a'; a.mkdir(); (a / 'events').symlink_to(tmp_path)
    with pytest.raises(ValueError, match='ALT_DIR_SYMLINK'): core.Recorder(a)
    b = tmp_path / 'b'; (b / 'events').mkdir(parents=True)
    (tmp_path / 'other').write_text(''); os.link(tmp_path / 'other', b / 'events' / 'SOLUSDT.jsonl')
    with pytest.raises(ValueError, match='ALT_UNEXPECTED_FILE'): core.Recorder(b)
