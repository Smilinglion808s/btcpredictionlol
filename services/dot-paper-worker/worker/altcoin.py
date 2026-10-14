"""DOT-Zero altcoin PAPER-ONLY observer: SOLUSDT/DOGEUSDT Binance USD-M public streams.

Keyless public websocket only. No order endpoint, credentials, webhooks or DB writes.
Disabled by default (DOT_ALT_ENABLED must equal 'true'). Not wired into the BTC engine.

Fidelity limits (explicit): bookTicker gives top-of-book only, so maker queue position
is never known. Maker outcomes are recorded as UNKNOWN / UNVERIFIED until L2 depth and
aggressive-trade sequencing are available. Nothing here claims a maker fill.
"""
from __future__ import annotations
import asyncio
import json
import os
import time
from collections import deque
from dataclasses import dataclass, asdict
from decimal import Decimal
from pathlib import Path

SYMBOLS = ('SOLUSDT', 'DOGEUSDT')
WS_BASE = 'wss://fstream.binance.com/stream?streams='
MAX_QUOTE_AGE_MS = 2_000
MAX_FUTURE_SKEW_MS = 1_000
MAX_LOG_BYTES = 5_000_000      # per file; rotated once, so at most 2 files per symbol
TAKER_FEE_BPS = Decimal('5')   # conservative USD-M taker
MAKER_FEE_BPS = Decimal('2')


def enabled() -> bool:
    return os.getenv('DOT_ALT_ENABLED') == 'true'


def stream_url(symbols=SYMBOLS) -> str:
    for s in symbols:
        if s not in SYMBOLS:
            raise ValueError('SYMBOL_NOT_ALLOWED')
    return WS_BASE + '/'.join(f'{s.lower()}@bookTicker/{s.lower()}@aggTrade' for s in symbols)


@dataclass(frozen=True)
class AltQuote:
    symbol: str
    update_id: int
    bid: str
    bid_qty: str
    ask: str
    ask_qty: str
    exchange_ms: int     # E (event time)
    transaction_ms: int  # T (matching-engine time)
    receipt_ms: int      # local wall clock at receipt


@dataclass(frozen=True)
class AltTrade:
    symbol: str
    agg_id: int
    first_id: int
    last_id: int
    price: str
    qty: str
    buyer_is_maker: bool
    exchange_ms: int
    trade_ms: int
    receipt_ms: int


def parse(msg: dict, receipt_ms: int):
    """Strictly parse one combined-stream message. Raises ValueError on anything odd."""
    data = msg.get('data') if isinstance(msg, dict) else None
    if not isinstance(data, dict):
        raise ValueError('MALFORMED')
    sym = data.get('s')
    if sym not in SYMBOLS:
        raise ValueError('SYMBOL_NOT_ALLOWED')
    ev = data.get('e')
    if ev == 'bookTicker':
        bid, ask = Decimal(data['b']), Decimal(data['a'])
        if bid <= 0 or ask <= 0 or bid >= ask:
            raise ValueError('CROSSED_OR_INVALID_BOOK')
        return AltQuote(sym, int(data['u']), data['b'], data['B'], data['a'], data['A'],
                        int(data['E']), int(data['T']), receipt_ms)
    if ev == 'aggTrade':
        if Decimal(data['p']) <= 0 or Decimal(data['q']) <= 0:
            raise ValueError('INVALID_TRADE')
        return AltTrade(sym, int(data['a']), int(data['f']), int(data['l']), data['p'], data['q'],
                        bool(data['m']), int(data['E']), int(data['T']), receipt_ms)
    raise ValueError('UNKNOWN_EVENT')


class Health:
    """Per-symbol sequence gap and staleness tracking."""
    def __init__(self):
        self.last_update: dict[str, int] = {}
        self.last_agg: dict[str, int] = {}
        self.last_quote: dict[str, AltQuote] = {}
        self.gaps: dict[str, int] = {s: 0 for s in SYMBOLS}

    def observe(self, ev) -> list[str]:
        flags = []
        if ev.exchange_ms - ev.receipt_ms > MAX_FUTURE_SKEW_MS:
            flags.append('FUTURE_TIMESTAMP')
        if isinstance(ev, AltQuote):
            prev = self.last_update.get(ev.symbol)
            if prev is not None and ev.update_id <= prev:
                flags.append('OUT_OF_ORDER')
            else:
                self.last_update[ev.symbol] = ev.update_id
                self.last_quote[ev.symbol] = ev
        else:
            prev = self.last_agg.get(ev.symbol)
            if prev is not None:
                if ev.agg_id <= prev:
                    flags.append('OUT_OF_ORDER')
                elif ev.agg_id != prev + 1:
                    flags.append('TRADE_GAP')
                    self.gaps[ev.symbol] += 1
            if 'OUT_OF_ORDER' not in flags:
                self.last_agg[ev.symbol] = ev.agg_id
        return flags

    def quote_state(self, symbol: str, now_ms: int) -> str:
        q = self.last_quote.get(symbol)
        if q is None:
            return 'NO_DATA'
        return 'STALE' if now_ms - q.receipt_ms > MAX_QUOTE_AGE_MS else 'FRESH'


class Recorder:
    """Append-only JSONL event log with bounded size (one rotation)."""
    def __init__(self, directory, max_bytes=MAX_LOG_BYTES):
        self.dir = Path(directory)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.max_bytes = max_bytes

    def _path(self, symbol):
        return self.dir / f'{symbol}.jsonl'

    def write(self, ev, flags=()):
        p = self._path(ev.symbol)
        if p.exists() and p.stat().st_size >= self.max_bytes:
            p.replace(p.with_suffix('.jsonl.1'))  # older rotation is discarded
        kind = 'quote' if isinstance(ev, AltQuote) else 'trade'
        with p.open('a') as f:
            f.write(json.dumps({'kind': kind, 'flags': list(flags), **asdict(ev)}, sort_keys=True) + '\n')


def replay(path):
    """Read-only offline replay: yields parsed events in file order. Never writes."""
    for line in Path(path).read_text().splitlines():
        if not line.strip():
            continue
        d = json.loads(line)
        kind = d.pop('kind')
        d.pop('flags', None)
        yield AltQuote(**d) if kind == 'quote' else AltTrade(**d)


@dataclass(frozen=True)
class Decision:
    symbol: str
    side: str            # BUY / SELL
    action: str          # TAKER / MAKER / ABSTAIN
    reason: str
    quote_update_id: int | None
    price: str | None
    est_cost_bps: str | None
    fill_status: str     # TAKER_SIMULATED / UNKNOWN / NONE
    verification: str    # e.g. MAKER_UNVERIFIED_NO_L2
    decision_ms: int


def decide(symbol, side, health: Health, now_ms, edge_bps: Decimal, prefer_maker=False) -> Decision:
    """Conservative paper decision record. Never asserts a maker fill."""
    if side not in ('BUY', 'SELL'):
        raise ValueError('BAD_SIDE')
    state = health.quote_state(symbol, now_ms)
    if state != 'FRESH':
        return Decision(symbol, side, 'ABSTAIN', f'QUOTE_{state}', None, None, None, 'NONE', 'N/A', now_ms)
    q = health.last_quote[symbol]
    bid, ask = Decimal(q.bid), Decimal(q.ask)
    mid = (bid + ask) / 2
    half_spread_bps = (ask - bid) / 2 / mid * Decimal(10_000)
    taker_cost = half_spread_bps + TAKER_FEE_BPS
    if prefer_maker:
        px = q.bid if side == 'BUY' else q.ask
        return Decision(symbol, side, 'MAKER', 'PASSIVE_AT_TOUCH', q.update_id, px,
                        str(MAKER_FEE_BPS), 'UNKNOWN', 'MAKER_UNVERIFIED_NO_L2_QUEUE', now_ms)
    if edge_bps <= taker_cost:
        return Decision(symbol, side, 'ABSTAIN', 'EDGE_BELOW_TAKER_COST', q.update_id, None,
                        str(taker_cost), 'NONE', 'N/A', now_ms)
    px = q.ask if side == 'BUY' else q.bid
    return Decision(symbol, side, 'TAKER', 'EDGE_EXCEEDS_COST', q.update_id, px, str(taker_cost),
                    'TAKER_SIMULATED', 'TOP_OF_BOOK_ONLY_SIZE_UNCHECKED', now_ms)


async def collect(directory, stop: asyncio.Event, connect=None):
    """Public stream observer. Refuses to run unless explicitly enabled."""
    if not enabled():
        return 'DISABLED'
    if connect is None:
        from websockets.asyncio.client import connect as connect
    health, rec = Health(), Recorder(directory)
    async with connect(stream_url(), max_size=1 << 16) as ws:
        while not stop.is_set():
            raw = await asyncio.wait_for(ws.recv(), timeout=30)
            now = int(time.time() * 1000)
            try:
                ev = parse(json.loads(raw), now)
            except (ValueError, KeyError, TypeError, ArithmeticError):
                continue
            rec.write(ev, health.observe(ev))
    return 'STOPPED'


class AltSupervisor:
    """Separate reconnecting task for the altcoin collector. Never touches the BTC engine.

    Failures are isolated: a crash here only increments counters and backs off; it
    never marks the BTC service failed. Disabled unless DOT_ALT_ENABLED=true.
    """
    def __init__(self, directory, connect=None, base_backoff_s=1.0, max_backoff_s=60.0, sleep=None, log=print):
        self.directory, self.connect = directory, connect
        self.base, self.max = base_backoff_s, max_backoff_s
        self.sleep = sleep
        self.log = log
        self.counters = {'connects': 0, 'failures': 0, 'clean_stops': 0}
        self.state = 'DISABLED' if not enabled() else 'IDLE'
        self.last_error: str | None = None
        self.backoff_s = 0.0

    def health(self) -> dict:
        return {'enabled': enabled(), 'state': self.state, 'symbols': list(SYMBOLS),
                'last_error': self.last_error, 'backoff_s': self.backoff_s, **self.counters}

    async def _wait(self, stop, seconds):
        if self.sleep:
            await self.sleep(seconds); return
        try: await asyncio.wait_for(stop.wait(), timeout=seconds)
        except TimeoutError: pass

    async def run(self, stop: asyncio.Event):
        if not enabled():
            self.log('DOT_ALT_DISABLED (set DOT_ALT_ENABLED=true to observe SOL/DOGE paper feed)', flush=True)
            self.state = 'DISABLED'
            return 'DISABLED'
        self.log(f'DOT_ALT_START symbols={",".join(SYMBOLS)} dir={self.directory} paper_only=true', flush=True)
        delay = self.base
        while not stop.is_set():
            self.state = 'CONNECTING'; self.counters['connects'] += 1
            try:
                result = await collect(self.directory, stop, connect=self.connect)
                if result == 'STOPPED':
                    self.counters['clean_stops'] += 1
                delay = self.base
            except asyncio.CancelledError:
                self.state = 'STOPPED'; raise
            except Exception as exc:  # isolated: never propagates to BTC observer
                self.counters['failures'] += 1
                self.last_error = type(exc).__name__
                self.log(f'DOT_ALT_RECONNECT error={self.last_error} backoff_s={delay}', flush=True)
            if stop.is_set():
                break
            self.state = 'BACKOFF'; self.backoff_s = delay
            await self._wait(stop, delay)
            delay = min(delay * 2, self.max)
        self.state = 'STOPPED'
        self.log('DOT_ALT_STOP', flush=True)
        return 'STOPPED'
