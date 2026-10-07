"""All market data and ledger entries here are SYNTHETIC TEST-ONLY fixtures."""
import dataclasses
import json
from pathlib import Path
import tempfile
import time
import unittest
import uuid
from unittest.mock import patch
from worker.config import Config,canonical
from worker.engine import Engine,Quote
from worker.money import price,quantity,fee,gross_pnl,cost
from worker.store import AlreadyRunning,LeaseLost
from worker.api import create_app
from worker.auth import AuthConfig,OwnerAuth
from fastapi.testclient import TestClient

T0=1_800_000_015_000

def long_signal(*args):return {'action':'LONG','reason':'TEST_ONLY_LONG','stop_bps':30,'target_bps':60,'max_hold_ms':300000,'signal':{'fixture':True}}
def bar(close):return {'open_ms':close-14999,'close_ms':close,'open':'100000','high':'100000','low':'100000','close':'100000','volume':'1','quote_volume':'100000','taker_buy_quote_volume':'80000'}

class Clock:
    def __init__(self):self.now=T0
    def __call__(self):return self.now

class EngineTest(unittest.TestCase):
    def setUp(self):
        self.dir=tempfile.TemporaryDirectory(prefix='dot-paper-TEST-')
        self.path=Path(self.dir.name)/'synthetic-test-only.sqlite3';self.clock=Clock();self.seq=0
        self.cfg=Config(ledger_kind='TEST',feed_source='TEST_FIXTURE',feed_enabled=True,feed_rights_approved=True,execution_enabled=True,taker_fee_bps=10)
        self.e=Engine(self.path,self.cfg,self.clock,evaluator=long_signal)
    def tearDown(self):self.e.close();self.dir.cleanup()
    def advance(self,ms):
        while ms:
            step=min(ms,1000);self.clock.now+=step;ms-=step;self.e.tick()
    def quote(self,bid='100000',ask='100001',**kw):
        self.seq+=1
        q=Quote(self.seq,self.clock(),self.clock(),self.clock(),price(bid),price(ask),quantity('10'),quantity('10'),test_only=True)
        return dataclasses.replace(q,**kw)
    def ready(self):
        self.e.on_quote(self.quote());self.e.control('start',str(uuid.uuid4()))
    def call(self):return self.e.on_bar(bar(self.clock()-1),self.clock(),test_only=True)
    def opened(self):
        self.ready();self.call();self.advance(1000);self.e.on_quote(self.quote())
        self.assertIsNotNone(self.e.snapshot()['position'])
    def close_win(self):
        self.opened();self.e.on_quote(self.quote('101000','101001'));self.advance(250);self.e.on_quote(self.quote('101000','101001'))

    def test_safe_empty_default(self):
        other=Engine(Path(self.dir.name)/'empty.sqlite3',Config(),self.clock)
        s=other.snapshot();self.assertEqual(s['state'],'EMPTY');self.assertEqual(s['trades']['items'],[]);self.assertEqual(s['account']['closed_trades'],0)
        self.assertIsNone(s['account']['equity_micros']);self.assertIsNone(s['account']['win_rate_pct']);other.close()
    def test_real_and_non_btc_and_live_execution_refused(self):
        for kw in [{'mode':'REAL'},{'symbol':'ETHUSD'},{'execution_enabled':True},{'feed_source':'BINANCE_SPOT'}]:
            with self.assertRaises(ValueError):Config(**kw)
    def test_synthetic_cannot_enter_forward(self):
        other=Engine(Path(self.dir.name)/'f.sqlite3',Config(),self.clock)
        with self.assertRaises(ValueError):other.on_quote(self.quote())
        with self.assertRaises(ValueError):other.on_bar(bar(self.clock()-1),self.clock(),test_only=True)
        other.close()
    def test_bid_ask_adverse_nonzero_fee_and_latency(self):
        self.ready();self.call();self.e.on_quote(self.quote());self.assertIsNone(self.e.snapshot()['position'])
        self.advance(999);self.e.on_quote(self.quote());self.assertIsNone(self.e.snapshot()['position'])
        self.advance(1);self.e.on_quote(self.quote());p=self.e.snapshot()['position']
        self.assertGreater(int(p['entry']['price_micros']),price('100001'));self.assertGreater(int(p['entry']['fee_micros']),0)
        self.assertGreaterEqual(p['entry']['latency_ms'],1000)
        self.assertLessEqual(int(p['entry']['notional_micros']),self.cfg.initial_equity_micros//10)
        self.assertLess(int(self.e.snapshot()['account']['cash_micros']),self.cfg.initial_equity_micros)
    def test_duplicate_bar_and_quote_no_duplicate_fill(self):
        self.ready();q=self.quote();self.e.on_quote(q);self.assertFalse(self.e.on_quote(q))
        self.assertTrue(self.call());self.assertFalse(self.call());self.advance(1000);self.e.on_quote(self.quote())
        self.assertEqual(len(self.e.snapshot()['calls']['items']),1)
        self.assertEqual(len([a for a in self.e.snapshot()['audit']['items'] if a['reason']=='ENTRY']),1)
    def test_stale_entry_cancels_no_late_fill(self):
        self.ready();self.call();self.advance(2001);self.e.on_quote(self.quote());self.assertIsNone(self.e.snapshot()['position'])
    def test_out_of_order_fails_closed(self):
        self.ready();self.call();self.e.on_quote(self.quote(sequence=0));self.assertIsNone(self.e.snapshot()['pending']);self.assertEqual(self.e.snapshot()['state'],'STALE')
    def test_future_exchange_timestamp_rejected(self):
        self.assertFalse(self.e.on_quote(self.quote(exchange_ms=self.clock()+501)))
    def test_invalid_book_rejected(self):self.assertFalse(self.e.on_quote(self.quote(bid_micros=price('100002'))))
    def test_wide_spread_abstains(self):
        self.ready();self.e.on_quote(self.quote('100000','100200'));self.call();self.assertEqual(self.e.snapshot()['calls']['items'][0]['reason'],'SPREAD_TOO_WIDE')
    def test_incomplete_stale_bar_rejected(self):
        self.ready();self.assertFalse(self.e.on_bar(bar(self.clock()+14999),self.clock(),test_only=True))
        self.assertFalse(self.e.on_bar(bar(self.clock()-15001),self.clock(),test_only=True))
    def test_partial_depth_limits_entry(self):
        self.ready();self.call();self.advance(1000);self.e.on_quote(self.quote(ask_sats=100000))
        self.assertLessEqual(int(self.e.snapshot()['position']['quantity_sats']),10000)
    def test_exit_waits_for_depth_no_assumed_fill(self):
        self.opened();self.e.on_quote(self.quote('99000','99001'));self.advance(250)
        self.e.on_quote(self.quote('99000','99001',bid_sats=1));self.assertIsNotNone(self.e.snapshot()['position'])
        self.e.on_quote(self.quote('99000','99001'));self.assertIsNone(self.e.snapshot()['position'])
    def test_net_labels_fee_inclusive_and_no_double_close(self):
        self.close_win();s=self.e.snapshot();t=s['trades']['items'][0]
        self.assertEqual(t['outcome'],'WIN');self.assertEqual(int(t['net_pnl_micros']),int(t['gross_pnl_micros'])-int(t['fees_micros']))
        self.assertEqual(t['symbol'],'BTCUSD');self.assertIn('strategy_version',t);self.assertIn('risk_micros',t);self.assertIn('planned_stop_risk_micros',t)
        self.e.on_quote(self.quote('102000','102001'));self.assertEqual(self.e.snapshot()['account']['closed_trades'],1)
        self.assertEqual(int(s['account']['cash_micros']),self.cfg.initial_equity_micros+int(t['net_pnl_micros']))
    def test_pause_cancels_entry_but_manages_open_exits(self):
        self.opened();self.e.control('pause',str(uuid.uuid4()));self.e.on_quote(self.quote('99000','99001'))
        self.advance(250);self.e.on_quote(self.quote('99000','99001'));self.assertEqual(self.e.snapshot()['account']['losses'],1)
    def test_controls_idempotent(self):
        key=str(uuid.uuid4());a=self.e.control('pause',key);self.assertEqual(a,self.e.control('pause',key))
        with self.assertRaises(ValueError):self.e.control('start',key)
    def test_short_injection_rejected(self):
        self.ready();self.e.evaluate=lambda *a:dict(long_signal(),action='SHORT')
        with self.assertRaises(ValueError):self.call()
        self.assertEqual(self.e.snapshot()['calls']['items'],[])
    def test_restart_cancels_entries_and_pauses(self):
        self.ready();self.call();self.e.close();self.e=Engine(self.path,self.cfg,self.clock,evaluator=long_signal)
        self.assertIsNone(self.e.snapshot()['pending']);self.assertFalse(self.e.snapshot()['running_requested'])
    def test_restart_preserves_position_and_closes_once(self):
        self.opened();pid=self.e.snapshot()['position']['position_id'];self.e.close();self.e=Engine(self.path,self.cfg,self.clock,evaluator=long_signal)
        self.assertEqual(self.e.snapshot()['position']['position_id'],pid);self.e.on_quote(self.quote('99000','99001'))
        self.advance(250);self.e.on_quote(self.quote('99000','99001'));self.assertEqual(self.e.snapshot()['account']['closed_trades'],1)
    def test_two_writer_processes_refused(self):
        with self.assertRaises(AlreadyRunning):Engine(self.path,self.cfg,self.clock,evaluator=long_signal)
    def test_lease_expired_fails_closed(self):
        self.clock.now+=self.cfg.lease_ms+1
        with self.assertRaises(LeaseLost):self.e.on_quote(self.quote())
    def test_lease_fenced_fails_closed(self):
        self.e.store.db.execute("UPDATE lease SET epoch=epoch+1")
        with self.assertRaises(LeaseLost):self.e.tick()
    def test_immutable_config_mismatch(self):
        self.e.close()
        with self.assertRaises(ValueError):Engine(self.path,dataclasses.replace(self.cfg,taker_fee_bps=11),self.clock,evaluator=long_signal)
    def test_daily_then_drawdown_severity_escalation(self):
        self.opened();self.e.on_quote(self.quote('89000','89001'))
        self.assertEqual(self.e._s()['circuit_reason'],'DAILY_LOSS_LIMIT')
        self.clock.now+=10;self.e.on_quote(self.quote('40000','40001'))
        self.assertEqual(self.e._s()['circuit_reason'],'DRAWDOWN_LIMIT')
        self.advance(250);self.e.on_quote(self.quote('40000','40001'))
        with self.assertRaises(ValueError):self.e.control('reset_circuit_breaker',str(uuid.uuid4()))
    def test_circuit_stays_latched_after_mark_recovers(self):
        self.opened();self.e.on_quote(self.quote('89000','89001'));self.clock.now+=10;self.e.on_quote(self.quote())
        self.assertEqual(self.e._s()['circuit_reason'],'DAILY_LOSS_LIMIT')
    def test_public_api_refuses_test_ledger(self):
        with self.assertRaises(ValueError):create_app(self.e,OwnerAuth(AuthConfig()),background=False)
    def test_run_identity_persists_and_pages_include_it(self):
        old=self.e.snapshot()['run_id'];self.e.close();self.e=Engine(self.path,self.cfg,self.clock,evaluator=long_signal)
        self.assertEqual(self.e.snapshot()['run_id'],old)
        with TestClient(create_app(self.e,OwnerAuth(AuthConfig()),background=False,allow_test_api=True)) as c:
            page=c.get('/api/v1/trades').json();self.assertEqual(page['run_id'],old);self.assertEqual(page['provenance'],'TEST')
            self.assertEqual(c.get('/api/v1/positions').json()['run_id'],old)
    def test_public_api_empty_and_no_private_lease_data(self):
        with TestClient(create_app(self.e,OwnerAuth(AuthConfig()),background=False,allow_test_api=True)) as c:
            s=c.get('/api/v1/snapshot').json();self.assertNotIn('lease_owner',s['simulator']);self.assertEqual(s['audit']['items'],[])
            self.assertIsNone(s['feed']['bid_micros']);self.assertEqual(c.get('/api/v1/audit').status_code,404)
            self.assertEqual(c.post('/api/v1/control',json={'action':'start','request_id':str(uuid.uuid4())}).status_code,503)
            self.assertEqual(c.post('/api/v1/order',json={'mode':'REAL'}).status_code,405)
            self.assertEqual(c.get('/health').json()['real_orders_supported'],False)
    def test_page_limit_and_cursor(self):
        with self.e.store.transaction(self.clock()):
            for i in range(60):self.e.store.insert('calls',{'call_id':str(i)},str(i))
        p=self.e.store.page('calls',10);self.assertEqual(len(p['items']),10);q=self.e.store.page('calls',10,p['next_cursor'])
        self.assertLess(q['items'][0]['id'],p['items'][-1]['id'])
    def test_10k_trades_constant_cost_account_rollup(self):
        with self.e.store.transaction(self.clock()):
            for i in range(10000):self.e.store.insert('trades',{'trade_id':str(i),'outcome':'FLAT','gross_pnl_micros':'0','net_pnl_micros':'0','fees_micros':'0'},str(i))
            totals=self.e.store.get('totals');totals['count']=10000;totals['flats']=10000;self.e.store.put('totals',totals)
        self.e._trades=lambda:(_ for _ in ()).throw(AssertionError('unbounded ledger scan'))
        start=time.perf_counter()
        for _ in range(200):self.e.on_quote(self.quote())
        duration=time.perf_counter()-start
        self.assertLess(duration,5);self.assertEqual(self.e._account(self.e._s(),self.clock())['closed_trades'],10000)
        print(f'BENCHMARK 10k ledger / 200 quote transactions: {duration:.3f}s; {duration/200*1000:.3f}ms/quote')

if __name__=='__main__':unittest.main()
