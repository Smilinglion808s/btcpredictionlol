"""V3-only reversal integration. Public data reads; no account/order endpoints."""
from __future__ import annotations

import gzip, json, hashlib, threading
from pathlib import Path

import reversal as R
import reversal_features as F
from settlement_retry import SettlementQueue

SCHEMA = """
CREATE TABLE IF NOT EXISTS reversal_rows(
 candle_s INTEGER PRIMARY KEY, side INTEGER NOT NULL, features TEXT NOT NULL,
 label INTEGER, settlement_s REAL, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reversal_heads(
 week_s INTEGER PRIMARY KEY, body TEXT NOT NULL);
"""
PACKAGE = Path(__file__).resolve().parent.parent/'risk_package'


class RiskRuntime:
    def __init__(self, engine, market, package=PACKAGE):
        self.engine, self.s, self.market = engine, engine.s, market
        self.context = None
        self.lock = threading.RLock()
        self.s.db.executescript(SCHEMA)
        self.settlements = SettlementQueue(self.s, "reversal")
        manifest = json.loads((package/'SHA256.json').read_text())
        for name in ('seed.json.gz','head.json'):
            if hashlib.sha256((package/name).read_bytes()).hexdigest()!=manifest.get(name):
                raise R.RiskInvalid('RISK_PACKAGE_HASH')
        seed = json.loads(gzip.decompress((package/'seed.json.gz').read_bytes()))
        h = json.loads((package/'head.json').read_text())
        R.validate(h,h['valid_from_s'])
        with self.s.tx() as db:
            for r in seed:
                db.execute('INSERT OR IGNORE INTO reversal_rows VALUES(?,?,?,?,?,?)',
                           (r['candle_s'],r['side'],json.dumps(r['features'],allow_nan=False),r['label'],r['settlement_s'],'research_seed'))
            db.execute('INSERT OR IGNORE INTO reversal_heads VALUES(?,?)',(h['valid_from_s'],json.dumps(h,allow_nan=False)))

    def head(self,c):
        rows=self.s.q('SELECT body FROM reversal_heads WHERE week_s=?',(R.week_start(c),))
        if not rows:raise R.RiskInvalid('RISK_HEAD_MISSING')
        h=json.loads(rows[0][0]);R.validate(h,c);return h

    def prepare_context(self,c):
        with self.lock:
            if self.context is not None and self.context['candle_s']==c:return
        quarters=self.market.closed_bars(c,'15m',1000)
        minutes=self.market.closed_bars(c,'1m',241)
        context=F.preopen_context(quarters,minutes,c)
        with self.lock:self.context=context

    def score(self,c,bars,now_ms,feed_ok=True,clock_ok=True):
        with self.s.tx():
            row=self.s.q('SELECT status,direction,rank,audit FROM decisions WHERE candle_s=?',(c,))
            if not row or row[0][0]!='SELECTED':return {'status':'NOT_SELECTED'}
            prior=json.loads(row[0][3]).get('reversal_risk')
            if prior is not None:return prior
            side,rank=row[0][1:3]
            audit={'version':R.VERSION,'feature_schema':R.FEATURE_SCHEMA,'evaluated_at_ms':now_ms}
            try:
                if not (c+45)*1000<=now_ms<(c+46)*1000:raise R.RiskInvalid('RISK_CHECKPOINT_TIMING')
                if not feed_ok or not clock_ok:raise R.RiskInvalid('RISK_FEED_OR_CLOCK')
                with self.lock:context=self.context
                if context is None:raise R.RiskInvalid('RISK_CONTEXT_MISSING')
                values=F.build(bars,context,c,side,rank)
                # Retain every original V3 selection, including future skips, for unbiased refits.
                self.s.q('INSERT OR IGNORE INTO reversal_rows VALUES(?,?,?,NULL,NULL,?)',
                         (c,side,json.dumps([values[k] for k in R.FEATURES],allow_nan=False),'live'))
                h=self.head(c)
                prob,skip=R.predict(h,values,c)
                audit.update(status='SKIP' if skip else 'PASS',loss_probability=prob,
                             threshold=h['threshold'],head_sha256=h['sha256'],feature_asof_ms=(c+45)*1000-1)
            except Exception as exc:
                audit.update(status='INVALID',reason=str(exc)[:160] if isinstance(exc,R.RiskInvalid) else type(exc).__name__)
            self.engine._audit(c,{'reversal_risk':audit})
            if self.engine.risk_mode=='enforce' and audit['status']!='PASS':
                # Keep original direction/checkpoint/rank in the audit record; never fade or reselect.
                self.s.q('UPDATE decisions SET status=?,reason=?,updated_ms=? WHERE candle_s=?',
                         ('NO_CALL' if audit['status']=='SKIP' else 'FAIL_CLOSED',
                          'REVERSAL_RISK_SKIP' if audit['status']=='SKIP' else 'REVERSAL_RISK_UNAVAILABLE',now_ms,c))
            return audit

    def settle_and_refit(self,now_s):
        self.settlements.poll(self.market, now_s)
        b=R.week_start(now_s)
        for boundary in (b,b+R.WEEK):
            if now_s<boundary-R.DAY or self.s.q('SELECT 1 FROM reversal_heads WHERE week_s=?',(boundary,)):continue
            got=self.s.q('SELECT candle_s,side,features,label,settlement_s FROM reversal_rows WHERE candle_s>=? AND candle_s<? AND settlement_s<? AND label IN (-1,1) ORDER BY candle_s',
                         (boundary-8*R.WEEK,boundary-R.DAY,boundary-R.DAY))
            records=[dict(candle_s=c,side=s,features=json.loads(f),label=y,settlement_s=st) for c,s,f,y,st in got]
            if not records or records[-1]['candle_s']<boundary-R.DAY-2*R.DAY:
                raise R.RiskInvalid('RISK_TRAINING_STALE')
            h=R.fit(records,boundary)
            self.s.q('INSERT OR IGNORE INTO reversal_heads VALUES(?,?)',(boundary,json.dumps(h,allow_nan=False)))
