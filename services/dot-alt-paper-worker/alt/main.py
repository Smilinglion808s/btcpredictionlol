"""Standalone SOL/DOGE PAPER collector. Public Binance USD-M streams only; read-only HTTP.

No credentials, orders, webhooks or BTC ledger imports. Endpoints: GET /health, GET /events/latest.
"""
from __future__ import annotations
import asyncio
import json
import os
import time
from dataclasses import asdict
from decimal import Decimal
from .core import SYMBOLS, AltQuote, Health, Recorder, decide, parse, stream_url

STALE_MS = 10_000


class Collector:
    def __init__(self, directory, connect=None, base_backoff_s=1.0, max_backoff_s=60.0, sleep=None, clock=None):
        self.rec = Recorder(directory)
        self.health = Health()
        self.connect, self.sleep = connect, sleep
        self.base, self.max = base_backoff_s, max_backoff_s
        self.clock = clock or (lambda: int(time.time() * 1000))
        self.state = 'IDLE'
        self.counters = {'connects': 0, 'failures': 0, 'events': 0, 'rejected': 0, 'flagged': 0}
        self.last_error: str | None = None
        self.latest: dict[str, dict] = {s: {} for s in SYMBOLS}
        self.last_event_ms: int | None = None

    def handle(self, raw: str):
        now = self.clock()
        try:
            ev = parse(json.loads(raw), now)
        except (ValueError, KeyError, TypeError, ArithmeticError):
            self.counters['rejected'] += 1
            return
        flags = self.health.observe(ev)
        if flags: self.counters['flagged'] += 1
        self.rec.write(ev, flags)
        self.counters['events'] += 1
        self.last_event_ms = now
        self.latest[ev.symbol]['quote' if isinstance(ev, AltQuote) else 'trade'] = {**asdict(ev), 'flags': flags}

    async def run_once(self, stop):
        connect = self.connect
        if connect is None:
            from websockets.asyncio.client import connect
        async with connect(stream_url(), max_size=1 << 16) as ws:
            self.state = 'RUNNING'
            while not stop.is_set():
                self.handle(await asyncio.wait_for(ws.recv(), timeout=30))

    async def run(self, stop):
        print(f'DOT_ALT_START symbols={",".join(SYMBOLS)} paper_only=true', flush=True)
        delay = self.base
        while not stop.is_set():
            self.state = 'CONNECTING'; self.counters['connects'] += 1
            try:
                await self.run_once(stop); delay = self.base
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.counters['failures'] += 1; self.last_error = type(exc).__name__
                print(f'DOT_ALT_RECONNECT error={self.last_error} backoff_s={delay}', flush=True)
            if stop.is_set(): break
            self.state = 'BACKOFF'
            if self.sleep: await self.sleep(delay)
            else:
                try: await asyncio.wait_for(stop.wait(), timeout=delay)
                except TimeoutError: pass
            delay = min(delay * 2, self.max)
        self.state = 'STOPPED'

    def health_doc(self):
        now = self.clock()
        per = {}
        for s in SYMBOLS:
            q = self.health.quote_state(s, now)
            # Conservative paper statuses: maker queue never known; taker size never checked.
            taker = decide(s, 'BUY', self.health, now, Decimal('1000000'))
            per[s] = {'quote_state': q, 'trade_gaps': self.health.gaps[s],
                      'maker_status': 'UNKNOWN', 'maker_verification': 'MAKER_UNVERIFIED_NO_L2_QUEUE',
                      'taker_status': taker.fill_status, 'taker_verification': taker.verification}
        age = None if self.last_event_ms is None else now - self.last_event_ms
        state = 'STALE' if self.state == 'RUNNING' and (age is None or age > STALE_MS) else self.state
        return {'service': 'dot-alt-paper', 'mode': 'PAPER', 'real_orders_supported': False,
                'state': state, 'last_event_ms': self.last_event_ms, 'last_event_age_ms': age,
                'last_error': self.last_error, **self.counters, 'symbols': per}


async def serve_http(col: Collector, host, port):
    async def handler(reader, writer):
        try:
            line = (await asyncio.wait_for(reader.readline(), 5)).decode('latin-1').split()
            while (await asyncio.wait_for(reader.readline(), 5)) not in (b'\r\n', b'\n', b''): pass
            if len(line) < 2 or line[0] != 'GET':
                code, body = 405, {'code': 'METHOD_NOT_ALLOWED'}
            elif line[1] == '/health':
                code, body = 200, col.health_doc()
            elif line[1] == '/events/latest':
                code, body = 200, {'mode': 'PAPER', 'symbols': col.latest}
            else:
                code, body = 404, {'code': 'NOT_FOUND'}
            data = json.dumps(body, sort_keys=True).encode()
            writer.write(f'HTTP/1.1 {code} X\r\nContent-Type: application/json\r\nContent-Length: {len(data)}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n'.encode() + data)
            await writer.drain()
        except Exception:
            pass
        finally:
            writer.close()
    return await asyncio.start_server(handler, host, port)


async def amain():
    col = Collector(os.getenv('DATA_DIR', './data/dot-alt'))
    stop = asyncio.Event()
    server = await serve_http(col, os.getenv('BIND', '0.0.0.0'), int(os.getenv('PORT', '8080')))
    task = asyncio.create_task(col.run(stop))
    try:
        async with server: await server.serve_forever()
    finally:
        stop.set(); task.cancel()


if __name__ == '__main__':
    asyncio.run(amain())
