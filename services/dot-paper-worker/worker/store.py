from __future__ import annotations
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import sqlite3
import threading
import uuid
from .config import canonical

class LeaseLost(RuntimeError): pass
class AlreadyRunning(RuntimeError): pass

class Store:
    """One physical volume, one writer process, WAL/FULL atomic transactions.

    OS exclusive lock survives no process crash; fencing token is checked inside
    every write transaction. Neither SQLite nor this design is a distributed DB.
    Do not mount separate copies on multiple replicas or put WAL on a network FS.
    """
    def __init__(self, path, now_ms, lease_ms, identity):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.lock_file = open(str(self.path)+'.lock', 'a+')
        try: fcntl.flock(self.lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.lock_file.close()
            raise AlreadyRunning('This ledger already has a writer')
        self.db = sqlite3.connect(self.path, isolation_level=None, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.execute('PRAGMA busy_timeout=5000')
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS lease(singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner TEXT NOT NULL, epoch INTEGER NOT NULL, expires_ms INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS calls(id INTEGER PRIMARY KEY AUTOINCREMENT, unique_id TEXT UNIQUE NOT NULL, document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS trades(id INTEGER PRIMARY KEY AUTOINCREMENT, unique_id TEXT UNIQUE NOT NULL, document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS equity(id INTEGER PRIMARY KEY AUTOINCREMENT, document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS observed_quotes(observation_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, exchange_ms INTEGER NOT NULL, receipt_ms INTEGER NOT NULL, accepted INTEGER NOT NULL, document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS observed_trades(trade_id INTEGER PRIMARY KEY, exchange_ms INTEGER NOT NULL, receipt_ms INTEGER NOT NULL, document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS bars(close_ms INTEGER PRIMARY KEY, document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS funding(time_ms INTEGER PRIMARY KEY, document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS controls(request_id TEXT PRIMARY KEY, action TEXT NOT NULL, document TEXT NOT NULL);
        ''')
        self.owner = str(uuid.uuid4())
        self.lease_ms = lease_ms
        self.closed = False
        try:
            self.db.execute('BEGIN IMMEDIATE')
            old_identity = self.get('identity')
            if old_identity is not None and old_identity != identity:
                raise ValueError('Immutable ledger identity mismatch: create reviewed new ledger; never reuse live history')
            self.put('identity', identity)
            row = self.db.execute('SELECT epoch FROM lease WHERE singleton=1').fetchone()
            self.epoch = (row['epoch'] if row else 0) + 1
            self.db.execute('INSERT OR REPLACE INTO lease VALUES(1,?,?,?)',(self.owner,self.epoch,now_ms+lease_ms))
            self.db.execute('COMMIT')
        except Exception:
            if self.db.in_transaction: self.db.execute('ROLLBACK')
            self.close()
            raise

    def get(self, key, default=None):
        row = self.db.execute('SELECT value FROM meta WHERE key=?',(key,)).fetchone()
        return json.loads(row['value']) if row else default

    def put(self, key, value):
        self.db.execute('INSERT OR REPLACE INTO meta VALUES(?,?)',(key,canonical(value)))

    @contextmanager
    def transaction(self, now_ms):
        with self.lock:
            self.db.execute('BEGIN IMMEDIATE')
            try:
                row=self.db.execute('SELECT * FROM lease WHERE singleton=1').fetchone()
                if row['owner'] != self.owner or row['epoch'] != self.epoch or row['expires_ms'] < now_ms:
                    raise LeaseLost('Writer lease expired or fenced')
                self.db.execute('UPDATE lease SET expires_ms=? WHERE singleton=1 AND owner=? AND epoch=?',
                                (now_ms+self.lease_ms,self.owner,self.epoch))
                yield
                self.db.execute('COMMIT')
            except Exception:
                self.db.execute('ROLLBACK')
                raise

    def insert(self, table, document, unique_id=None):
        if table not in {'calls','trades','audit','equity'}: raise ValueError('Table not allowed')
        if unique_id is None:
            cur=self.db.execute(f'INSERT INTO {table}(document) VALUES(?)',(canonical(document),))
        else:
            cur=self.db.execute(f'INSERT INTO {table}(unique_id,document) VALUES(?,?)',(unique_id,canonical(document)))
        return cur.lastrowid

    def page(self, table, limit=50, before=None):
        if table not in {'calls','trades','audit','equity'}: raise ValueError('Table not allowed')
        limit=max(1,min(int(limit),200))
        sql=f'SELECT id,document FROM {table}'
        args=[]
        if before is not None: sql+=' WHERE id < ?';args.append(int(before))
        sql+=' ORDER BY id DESC LIMIT ?';args.append(limit+1)
        rows=self.db.execute(sql,args).fetchall()
        items=[dict(json.loads(r['document']),id=r['id']) for r in rows[:limit]]
        return {'items':items,'next_cursor':items[-1]['id'] if len(rows)>limit else None}

    def all_trades(self):
        return [dict(json.loads(r['document']),id=r['id']) for r in self.db.execute('SELECT id,document FROM trades ORDER BY id')]

    def close(self):
        if not getattr(self,'closed',False):
            self.closed=True
            self.db.close()
            fcntl.flock(self.lock_file,fcntl.LOCK_UN)
            self.lock_file.close()
