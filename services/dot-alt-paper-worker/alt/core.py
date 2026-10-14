"""DOT-Zero altcoin PAPER-ONLY observer: SOLUSDT/DOGEUSDT Binance USD-M public streams.

Keyless public websocket only. No order endpoint, credentials, webhooks or DB writes.
Standalone service; independent of the BTC dot-paper worker and its ledger.

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


ALT_FILES = {f'{s}.jsonl{x}' for s in SYMBOLS for x in ('', '.1')}


class Recorder:
    """Append-only JSONL event log with bounded size (one rotation). Fails closed on a
    symlinked directory/file, or any file outside the per-symbol allowlist."""
    def __init__(self, directory, max_bytes=MAX_LOG_BYTES):
        self.dir = Path(directory)
        if self.dir.is_symlink():
            raise ValueError('ALT_DIR_SYMLINK')
        self.dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.dir.is_symlink() or not self.dir.is_dir():
            raise ValueError('ALT_DIR_UNSAFE')
        for p in self.dir.iterdir():
            if p.name not in ALT_FILES or p.is_symlink() or not p.is_file():
                raise ValueError('ALT_UNEXPECTED_FILE')
        self.max_bytes = max_bytes

    def _path(self, symbol):
        if symbol not in SYMBOLS:
            raise ValueError('SYMBOL_NOT_ALLOWED')
        return self.dir / f'{symbol}.jsonl'

    def write(self, ev, flags=()):
        p = self._path(ev.symbol)
        if p.is_symlink() or p.with_suffix('.jsonl.1').is_symlink():
            raise ValueError('ALT_FILE_SYMLINK')
        if p.exists() and p.stat().st_size >= self.max_bytes:
            p.replace(p.with_suffix('.jsonl.1'))  # older rotation is discarded
        kind = 'quote' if isinstance(ev, AltQuote) else 'trade'
        fd = os.open(p, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'a') as f:
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

