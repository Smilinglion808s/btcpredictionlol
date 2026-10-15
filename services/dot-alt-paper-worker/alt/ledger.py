"""VIRTUAL $1,000 paper ledger + engine for SOLUSDT/DOGEUSDT. SIMULATION ONLY.

No orders, keys, webhooks or network. Fills are simulated as taker at top of book plus
slippage and fees; size is NOT checked against displayed quantity. Isolated margin per
position, one position per symbol, max 8x leverage, liquidation at maintenance margin,
time exits at the configured horizon (5/15/30 min). SQLite lives in DATA_DIR/ledger and
is never reset; identity/config mismatch fails closed.

The optional 'EXPLORATORY_MOMENTUM_V0' rule is an untested placeholder for exercising the
plumbing. It makes no profitability claim and is disabled by default.
"""
from __future__ import annotations
import json, os, sqlite3, stat
from collections import deque
from decimal import Decimal as D
from pathlib import Path

LEDGER_SUBDIR = 'ledger'
DB_NAME = 'paper.sqlite3'
LEDGER_FILES = {DB_NAME, DB_NAME + '-wal', DB_NAME + '-shm', DB_NAME + '-journal'}
START_BALANCE = D('1000')
MAX_LEVERAGE = D('8')
ALLOWED_HOLD_MIN = (5, 15, 30)
MAINT_RATE = D('0.005')
RULE = 'EXPLORATORY_MOMENTUM_V0'
IDENTITY = 'dot-alt-virtual-ledger/1'


class Config:
    def __init__(self, env=None):
        e = os.environ if env is None else env
        self.enabled = e.get('ALT_PAPER_STRATEGY_ENABLED', 'false') == 'true'
        self.leverage = D(e.get('ALT_PAPER_LEVERAGE', '2'))
        self.hold_min = int(e.get('ALT_PAPER_HOLD_MIN', '15'))
        self.margin_frac = D(e.get('ALT_PAPER_MARGIN_FRACTION', '0.10'))
        self.fee_bps = D(e.get('ALT_PAPER_FEE_BPS', '5'))
        self.slip_bps = D(e.get('ALT_PAPER_SLIPPAGE_BPS', '2'))
        self.signal_bps = D(e.get('ALT_PAPER_SIGNAL_BPS', '10'))
        if not (D('1') <= self.leverage <= MAX_LEVERAGE): raise ValueError('ALT_PAPER_LEVERAGE_INVALID')
        if self.hold_min not in ALLOWED_HOLD_MIN: raise ValueError('ALT_PAPER_HOLD_INVALID')
        if not (D('0') < self.margin_frac <= D('0.5')): raise ValueError('ALT_PAPER_MARGIN_INVALID')
        if self.fee_bps < 0 or self.slip_bps < 0 or self.signal_bps <= 0: raise ValueError('ALT_PAPER_COST_INVALID')

    def doc(self):
        return {'strategy_enabled': self.enabled, 'rule': RULE, 'leverage': str(self.leverage),
                'hold_min': self.hold_min, 'margin_fraction': str(self.margin_frac),
                'fee_bps': str(self.fee_bps), 'slippage_bps': str(self.slip_bps), 'signal_bps': str(self.signal_bps)}


def ledger_dir(root):
    root = Path(root)
    if root.is_symlink() or not root.is_dir(): raise ValueError('ALT_LEDGER_ROOT_UNSAFE')
    d = root / LEDGER_SUBDIR
    if d.is_symlink(): raise ValueError('ALT_LEDGER_SYMLINK')
    d.mkdir(mode=0o700, exist_ok=True)
    st = d.lstat()
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.geteuid(): raise ValueError('ALT_LEDGER_UNSAFE')
    for p in d.iterdir():
        s = p.lstat()
        if p.name not in LEDGER_FILES or not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or s.st_uid != os.geteuid():
            raise ValueError('ALT_LEDGER_UNEXPECTED_FILE')
    return d


class Ledger:
    def __init__(self, root, cfg: Config, now_ms):
        self.cfg = cfg
        self.db = sqlite3.connect(ledger_dir(root) / DB_NAME, isolation_level=None, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        for p in ('journal_mode=WAL', 'synchronous=FULL'): self.db.execute(f'PRAGMA {p}')
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS positions(symbol TEXT PRIMARY KEY, trade_id TEXT UNIQUE NOT NULL, side TEXT NOT NULL,
          qty TEXT NOT NULL, entry_price TEXT NOT NULL, margin TEXT NOT NULL, entry_fee TEXT NOT NULL, leverage TEXT NOT NULL,
          entry_ms INTEGER NOT NULL, exit_due_ms INTEGER NOT NULL, mark TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS trades(trade_id TEXT PRIMARY KEY, document TEXT NOT NULL);
        ''')
        self.db.execute('BEGIN IMMEDIATE')
        try:
            ident = self._get('identity')
            if ident is None:
                self._put('identity', IDENTITY); self._put('cash', str(START_BALANCE)); self._put('created_ms', str(now_ms))
            elif ident != IDENTITY or self._get('cash') is None:
                raise ValueError('ALT_LEDGER_IDENTITY_MISMATCH')
            self.db.execute('COMMIT')
        except Exception:
            self.db.execute('ROLLBACK'); self.db.close(); raise
        self.mids = {}

    def _get(self, k):
        r = self.db.execute('SELECT value FROM meta WHERE key=?', (k,)).fetchone()
        return r['value'] if r else None

    def _put(self, k, v): self.db.execute('INSERT OR REPLACE INTO meta VALUES(?,?)', (k, v))

    def cash(self): return D(self._get('cash'))

    def position(self, sym):
        r = self.db.execute('SELECT * FROM positions WHERE symbol=?', (sym,)).fetchone()
        return dict(r) if r else None

    @staticmethod
    def upnl(p, mark):
        diff = (D(mark) - D(p['entry_price'])) * D(p['qty'])
        return diff if p['side'] == 'LONG' else -diff

    def open(self, sym, side, bid, ask, now_ms, reason=RULE):
        """Simulated taker entry. Idempotent per (symbol, entry_ms); refuses a second position."""
        tid = f'{sym}-{now_ms}'
        c, bid, ask = self.cfg, D(bid), D(ask)
        if self.db.execute('SELECT 1 FROM trades WHERE trade_id=?', (tid,)).fetchone(): return None
        if self.position(sym): return None
        slip = c.slip_bps / D(10000)
        px = ask * (1 + slip) if side == 'LONG' else bid * (1 - slip)
        cash = self.cash()
        margin = (cash * c.margin_frac).quantize(D('0.000001'))
        notional = margin * c.leverage
        fee = notional * c.fee_bps / D(10000)
        if margin <= 0 or margin + fee > cash: return None
        qty = notional / px
        self.db.execute('BEGIN IMMEDIATE')
        try:
            self._put('cash', str(cash - margin - fee))
            self.db.execute('INSERT INTO positions VALUES(?,?,?,?,?,?,?,?,?,?,?)', (sym, tid, side, str(qty), str(px), str(margin),
                            str(fee), str(c.leverage), now_ms, now_ms + c.hold_min * 60_000, str((bid + ask) / 2)))
            self.db.execute('COMMIT')
        except Exception:
            self.db.execute('ROLLBACK'); raise
        return tid

    def close(self, sym, bid, ask, now_ms, reason):
        p = self.position(sym)
        if not p: return None
        c, bid, ask = self.cfg, D(bid), D(ask)
        slip = c.slip_bps / D(10000)
        px = bid * (1 - slip) if p['side'] == 'LONG' else ask * (1 + slip)
        qty, margin = D(p['qty']), D(p['margin'])
        fee = qty * px * c.fee_bps / D(10000)
        gross = self.upnl(p, px)
        ret = margin + gross - fee
        if reason == 'LIQUIDATION' or ret < 0:
            ret = D('0')  # isolated margin: loss capped at posted margin
        net = ret - margin - D(p['entry_fee'])
        doc = {'trade_id': p['trade_id'], 'symbol': sym, 'side': p['side'], 'qty': str(qty), 'leverage': p['leverage'],
               'entry_price': p['entry_price'], 'exit_price': str(px), 'entry_ms': p['entry_ms'], 'exit_ms': now_ms,
               'margin': p['margin'], 'entry_fee': p['entry_fee'], 'exit_fee': str(fee), 'gross_pnl': str(gross),
               'net_pnl': str(net), 'exit_reason': reason, 'rule': RULE, 'virtual': True}
        self.db.execute('BEGIN IMMEDIATE')
        try:
            self.db.execute('INSERT INTO trades VALUES(?,?)', (p['trade_id'], json.dumps(doc, sort_keys=True)))
            self.db.execute('DELETE FROM positions WHERE symbol=?', (sym,))
            self._put('cash', str(self.cash() + ret))
            self.db.execute('COMMIT')
        except sqlite3.IntegrityError:
            self.db.execute('ROLLBACK'); return None
        except Exception:
            self.db.execute('ROLLBACK'); raise
        return doc

    def on_quote(self, sym, bid, ask, now_ms, fresh):
        """Mark-to-market, liquidation and time exit; optional exploratory entry only on fresh data."""
        mid = (D(bid) + D(ask)) / 2
        p = self.position(sym)
        if p:
            self.db.execute('UPDATE positions SET mark=? WHERE symbol=?', (str(mid), sym))
            if D(p['margin']) + self.upnl(p, mid) <= D(p['qty']) * mid * MAINT_RATE:
                return self.close(sym, bid, ask, now_ms, 'LIQUIDATION')
            if now_ms >= p['exit_due_ms'] and fresh:
                return self.close(sym, bid, ask, now_ms, f'TIME_{self.cfg.hold_min}M')
            return None
        hist = self.mids.setdefault(sym, deque())
        hist.append((now_ms, mid))
        while hist and now_ms - hist[0][0] > 60_000: hist.popleft()
        if not (self.cfg.enabled and fresh) or now_ms - hist[0][0] < 55_000: return None
        move = (mid - hist[0][1]) / hist[0][1] * D(10000)
        if abs(move) >= self.cfg.signal_bps:
            hist.clear()
            return self.open(sym, 'LONG' if move > 0 else 'SHORT', bid, ask, now_ms)
        return None

    def status(self):
        pos = [dict(r) for r in self.db.execute('SELECT * FROM positions ORDER BY symbol')]
        eq = self.cash()
        for p in pos:
            p['unrealized_pnl'] = str(self.upnl(p, p['mark']))
            eq += max(D('0'), D(p['margin']) + D(p['unrealized_pnl']))
        trades = [json.loads(r['document']) for r in self.db.execute('SELECT document FROM trades ORDER BY rowid DESC LIMIT 20')]
        n = self.db.execute('SELECT COUNT(*) FROM trades').fetchone()[0]
        return {'mode': 'VIRTUAL_PAPER', 'real_orders_supported': False, 'starting_balance': str(START_BALANCE),
                'cash': str(self.cash()), 'equity': str(eq), 'used_margin': str(sum((D(p['margin']) for p in pos), D('0'))),
                'positions': pos, 'trade_count': n, 'recent_trades': trades, 'config': self.cfg.doc(),
                'disclaimer': 'Exploratory simulation; no profitability claim; fills/size unverified.'}
