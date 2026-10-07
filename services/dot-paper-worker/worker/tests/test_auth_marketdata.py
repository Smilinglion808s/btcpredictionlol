"""Synthetic protocols and ephemeral signing fixtures. Never production inputs."""
import dataclasses
import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from worker.auth import AuthConfig,OwnerAuth,AuthError
from worker.config import Config
from worker.engine import Engine
from worker.marketdata import KrakenObserver,parse_message,timestamp_ms,aggregate_completed_seconds,ObservationLimit,AccessDenied,StrictKrakenConnect,WS_URL,SUBSCRIPTIONS
from worker.tests.test_execution import Clock,bar

class AuthTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    def setUp(self):
        cfg=AuthConfig(issuer='https://example.supabase.co/auth/v1',owner_id='known-owner',controls_enabled=True)
        self.auth=OwnerAuth(cfg,SimpleNamespace(get_signing_key_from_jwt=lambda _:SimpleNamespace(key=self.key.public_key())))
    def token(self,**overrides):
        t=int(time.time());p={'sub':'known-owner','iss':self.auth.cfg.issuer,'aud':'authenticated','iat':t,'exp':t+300,'role':'authenticated'};p.update(overrides)
        return 'Bearer '+jwt.encode(p,self.key,algorithm='RS256',headers={'kid':'ephemeral-test-only'})
    def test_valid_owner(self):self.assertEqual(self.auth.verify(self.token()),'known-owner')
    def test_wrong_owner(self):
        with self.assertRaises(AuthError) as c:self.auth.verify(self.token(sub='other'))
        self.assertEqual(c.exception.status,403)
    def test_expired_wrong_issuer_audience_anonymous(self):
        for change in [{'exp':int(time.time())-10},{'iss':'https://attacker.example/auth/v1'},{'aud':'wrong'},{'is_anonymous':True},{'role':'anon'},{'nbf':int(time.time())+600}]:
            with self.assertRaises(AuthError):self.auth.verify(self.token(**change))
    def test_algorithm_confusion_no_unsigned(self):
        for alg,key in [('none',None),('HS256','ephemeral-test-only-secret')]:
            with self.assertRaises(AuthError):self.auth.verify('Bearer '+jwt.encode({'sub':'known-owner'},key,algorithm=alg,headers={'kid':'test'}))
    def test_no_public_owner_from_metadata(self):
        with self.assertRaises(AuthError):self.auth.verify(self.token(sub='other',user_metadata={'owner':True,'sub':'known-owner'}))
    def test_locked_default_and_invalid_issuer(self):
        with self.assertRaises(AuthError):OwnerAuth(AuthConfig()).verify(None)
        for issuer in ['http://example.com/auth/v1','https://user:pass@example.com/auth/v1','https://example.com/auth/v1?x=1']:
            with self.assertRaises(ValueError):AuthConfig(issuer=issuer)

class ObserverTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='dot-observer-TEST-');self.clock=Clock()
        self.e=Engine(Path(self.tmp.name)/'fixture.sqlite3',Config(ledger_kind='TEST',feed_enabled=True,feed_rights_approved=True),self.clock)
        self.o=KrakenObserver(self.e,max_seconds=30,max_trades=3);self.o.start();self.o.consume('{"channel":"status","data":[{"system":"online"}]}')
    def tearDown(self):self.e.close();self.tmp.cleanup()
    def ticker(self,**kw):
        from datetime import datetime,timezone
        row={'symbol':'BTC/USD','timestamp':datetime.fromtimestamp(self.clock()/1000,timezone.utc).isoformat(),
             'bid':'100000.1','ask':'100000.2','bid_qty':'2','ask_qty':'3'};row.update(kw)
        return json.dumps({'channel':'ticker','type':'update','data':[row]})
    def trade(self,tid=1,**kw):
        from datetime import datetime,timezone
        row={'symbol':'BTC/USD','timestamp':datetime.fromtimestamp(self.clock()/1000,timezone.utc).isoformat(),
             'price':'100000.1','qty':'0.001','side':'buy','ord_type':'limit','trade_id':tid};row.update(kw)
        return json.dumps({'channel':'trade','type':'update','data':[row]})
    def test_keyless_allowlisted_source_subscriptions(self):
        self.assertEqual(WS_URL,'wss://ws.kraken.com/v2')
        self.assertTrue(all(x['method']=='subscribe' for x in SUBSCRIPTIONS));self.assertNotIn('token',json.dumps(SUBSCRIPTIONS))
    def test_ticker_observation_no_trades_and_no_orders(self):
        self.o.consume(self.ticker());s=self.e.snapshot();self.assertEqual(s['feed']['health'],'FRESH');self.assertEqual(s['trades']['items'],[])
        self.assertFalse(self.e.cfg.execution_enabled)
    def test_quote_history_private_idempotent_and_rejections_audited(self):
        raw=self.ticker();self.o.consume(raw);self.o.consume(raw)
        self.assertEqual(self.e.store.get('observed_quote_count'),1)
        doc=json.loads(self.e.store.db.execute('SELECT document FROM observed_quotes').fetchone()[0])
        self.assertTrue(doc['accepted']);self.assertEqual(doc['sequence_origin'],'LOCAL_RECEIPT')
        self.assertIn('receipt_monotonic_ns',doc);self.assertEqual(doc['session_id'],self.o.session_id)
        self.o.consume(self.ticker(timestamp='2020-01-01T00:00:00Z'))
        self.assertEqual(self.e.store.get('observed_quote_count'),2)
        rows=[json.loads(r[0]) for r in self.e.store.db.execute('SELECT document FROM observed_quotes')]
        self.assertFalse(rows[-1]['accepted']);self.assertIn('STALE',rows[-1]['reason'])
        from worker.api import public_snapshot,create_app
        from fastapi.testclient import TestClient
        public=public_snapshot(self.e)
        self.assertNotIn('observed_quotes',public);self.assertIsNone(public['feed']['bid_micros'])
        with TestClient(create_app(self.e,OwnerAuth(AuthConfig()),background=False,allow_test_api=True)) as client:
            self.assertEqual(client.get('/api/v1/observed_quotes').status_code,404)
    def test_trade_dedupe_and_taker_side(self):
        self.o.consume(self.trade());self.o.consume(self.trade());self.assertEqual(self.e.store.get('observed_trade_count'),1)
        doc=json.loads(self.e.store.db.execute('SELECT document FROM observed_trades').fetchone()[0]);self.assertEqual(doc['taker_side'],'buy')
    def test_conflicting_trade_fails_transaction(self):
        self.o.consume(self.trade())
        with self.assertRaises(ValueError):self.o.consume(self.trade(price='99999'))
        self.assertEqual(self.e.store.get('observed_trade_count'),1)
    def test_wrong_symbol_stale_subscription_denied(self):
        for raw in [self.ticker(symbol='ETH/USD'),self.trade(symbol='ETH/USD'),json.dumps({'method':'subscribe','success':False})]:
            with self.assertRaises((ValueError,AccessDenied)):self.o.consume(raw)
    def test_heartbeat_does_not_refresh_quote(self):
        self.o.consume(self.ticker());self.clock.now+=2500;self.e.tick();self.o.consume('{"channel":"heartbeat"}')
        self.assertEqual(self.e.snapshot()['feed']['health'],'STALE')
    def test_reconnect_local_sequence_does_not_reset(self):
        self.o.consume(self.ticker());first=self.e._s()['quote_sequence'];self.o=KrakenObserver(self.e,max_seconds=30);self.o.start();self.o.consume('{"channel":"status","data":[{"system":"online"}]}')
        self.clock.now+=1;self.o.consume(self.ticker());self.assertGreater(self.e._s()['quote_sequence'],first)
    def test_observer_stop_persistent_and_count_bounded(self):
        deadline=self.e.store.get('observer_stop_ms');self.o=KrakenObserver(self.e,max_seconds=60);self.o.start();self.o.consume('{"channel":"status","data":[{"system":"online"}]}');self.assertEqual(self.e.store.get('observer_stop_ms'),deadline)
        self.o.max_trades=1;self.o.consume(self.trade())
        with self.assertRaises(ObservationLimit):self.o.check_limits()
    def test_offline_exchange_never_becomes_fresh_from_ticker(self):
        self.o.consume('{"channel":"status","data":[{"system":"maintenance"}]}');self.o.consume(self.ticker())
        self.assertNotEqual(self.e.snapshot()['feed']['health'],'FRESH')
    def test_no_write_after_persisted_deadline(self):
        self.clock.now=self.e.store.get('observer_stop_ms')
        with self.assertRaises(ObservationLimit):self.o.consume(self.ticker())
        self.assertEqual(self.e.store.get('observed_quote_count',0),0)
    def test_clock_regression_stops_observer(self):
        self.clock.now-=1
        with self.assertRaises(ObservationLimit):self.o.consume(self.ticker())
    def test_quiet_check_highwater_survives_observer_restart(self):
        self.clock.now+=100;self.o.check_limits();self.clock.now-=1
        fresh=KrakenObserver(self.e,max_seconds=30)
        with self.assertRaises(ObservationLimit):fresh.start()
    def test_monotonic_deadline_stops_even_if_wall_clock_frozen(self):
        self.o.monotonic_stop=time.monotonic()-1
        with self.assertRaises(ObservationLimit):self.o.consume(self.ticker())
    def test_batch_never_exceeds_row_limit(self):
        self.o.max_trades=1
        one=json.loads(self.trade(1));one['data']+=json.loads(self.trade(2))['data']
        with self.assertRaises(ObservationLimit):self.o.consume(json.dumps(one))
        self.assertLessEqual(self.e.store.get('observed_trade_count',0),1)
    def test_all_redirect_statuses_refused_without_connection(self):
        obj=object.__new__(StrictKrakenConnect)
        for status in [300,301,302,303,307,308]:
            result=obj.process_redirect(SimpleNamespace(response=SimpleNamespace(status_code=status)))
            self.assertIsInstance(result,AccessDenied)
    def test_decimal_json_exact_and_timezone(self):
        self.assertEqual(str(parse_message('{"price":100000.123456}')['price']),'100000.123456')
        self.assertEqual(timestamp_ms('2026-01-01T01:00:00+01:00'),timestamp_ms('2026-01-01T00:00:00Z'))
    def test_complete15_seconds_only(self):
        start=self.clock()-15000;rows=[]
        for i in range(15):
            r=bar(start+i*1000+999);r['open_ms']=start+i*1000;rows.append(r)
        r=aggregate_completed_seconds(rows);self.assertEqual(r['quote_volume'],'1500000');self.assertEqual(r['close_ms'],start+14999)
        with self.assertRaises(ValueError):aggregate_completed_seconds(rows[:-1])
        rows[4]['open_ms']+=1
        with self.assertRaises(ValueError):aggregate_completed_seconds(rows)

if __name__=='__main__':unittest.main()
