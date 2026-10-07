from __future__ import annotations
from dataclasses import asdict, dataclass
from decimal import Decimal, ROUND_CEILING
import json
import time
import uuid
from .config import Config, artifact_hash, canonical, digest
from .money import SAT, BPS, cost, fee, gross_pnl, execution_price, price, quantity, ceildiv
from .store import Store
from . import strategy_fast as strategy

@dataclass(frozen=True)
class Quote:
    sequence: int
    exchange_ms: int
    event_ms: int
    receipt_ms: int
    bid_micros: int
    ask_micros: int
    bid_sats: int
    ask_sats: int
    symbol: str = 'BTCUSD'
    test_only: bool = False

class Engine:
    def __init__(self, path, config=None, clock=None, evaluator=None):
        self.cfg=config or Config()
        self.clock=clock or (lambda: time.time_ns()//1_000_000)
        if evaluator is not None and self.cfg.ledger_kind != 'TEST':
            raise ValueError('Injected strategies are test-only')
        self.evaluate=evaluator or strategy.evaluate
        frozen={k:v for k,v in self.cfg.dict().items() if k not in {'feed_enabled','feed_rights_approved'}}
        self.config_hash=digest({'execution':frozen,'strategy_config_hash':strategy.CONFIG_HASH})
        self.artifact_hash=artifact_hash()
        identity={'schema':'dot-paper/v1','mode':'PAPER','symbol':self.cfg.symbol,'ledger_kind':self.cfg.ledger_kind,
                  'config_hash':self.config_hash,'artifact_hash':self.artifact_hash,'strategy_hash':strategy.STRATEGY_HASH}
        self.store=Store(path,self.clock(),self.cfg.lease_ms,identity)
        with self.store.transaction(self.clock()):
            if self.store.get('state') is None:
                self.store.put('state',{'run_id':str(uuid.uuid4()),'running':False,'position':None,'pending':None,'circuit':False,'circuit_reason':None,
                    'quote':None,'quote_valid':False,'feed_reason':'NO_DATA','quote_sequence':-1,'last_quote_exchange_ms':0,
                    'last_bar_close_ms':None,'last_decision_ms':None,'last_fill_ms':None,'last_close_ms':None,
                    'initial_ms':self.clock(),'last_tick_ms':self.clock(),'last_known_equity':None,'last_equity_checkpoint_ms':None,
                    'peak_equity':self.cfg.initial_equity_micros,'day':None,'day_start_equity':None,'daily_loss':None})
            if self.store.get('totals') is None:
                self.store.put('totals',{'gross':0,'net':0,'fees':0,'wins':0,'losses':0,'flats':0,'count':0})
            state=self._s()
            state['running']=False # restart always requires explicit owner start
            state['quote']=None;state['quote_valid']=False;state['feed_reason']='RESTART_REQUIRES_FRESH_DATA'
            if state['pending'] and state['pending']['kind']=='ENTRY':
                self._audit('CANCEL','RESTART_CANCELLED_ENTRY',state['pending'])
                state['pending']=None
            if self.clock()<state['last_tick_ms']:
                state['circuit']=True;state['circuit_reason']='CLOCK_REGRESSION';state['feed_reason']='CLOCK_REGRESSION'
            state['last_tick_ms']=max(self.clock(),state['last_tick_ms'])
            self._save(state)
            self._audit('LIFECYCLE','SAFE_START',{'ledger_kind':self.cfg.ledger_kind,'recovered_position':bool(state['position'])})

    def _s(self): return self.store.get('state')
    def _save(self,s): self.store.put('state',s)
    def _audit(self,kind,reason,details=None):
        return self.store.insert('audit',{'at_ms':self.clock(),'kind':kind,'reason':reason,'details':details or {}})

    def _reject(self,s,reason,details=None):
        if s['feed_reason'] != reason: self._audit('DATA_REJECT',reason,details)
        s['quote_valid']=False;s['feed_reason']=reason
        if s['pending'] and s['pending']['kind']=='ENTRY':
            self._audit('CANCEL','INVALID_DATA_CANCELLED_ENTRY',{'reason':reason})
            s['pending']=None

    def _fresh(self,s,now):
        q=s['quote']
        return bool(s['quote_valid'] and q and 0 <= now-q['receipt_ms'] <= self.cfg.max_quote_age_ms
                    and -self.cfg.future_tolerance_ms <= now-q['exchange_ms'] <= self.cfg.max_quote_age_ms)

    def _trades(self): return self.store.all_trades()

    def _account(self,s,now):
        totals=self.store.get('totals')
        gross=totals['gross'];net=totals['net'];fees=totals['fees']
        base_equity=self.cfg.initial_equity_micros+net
        cash=base_equity
        p=s['position'];unrealized=0;mark=None;equity=None
        if p:
            entry_fee=int(p['entry']['fee_micros']);fees+=entry_fee
            cash-=int(p['entry']['notional_micros'])+entry_fee
        if self._fresh(s,now):
            q=s['quote'];mark=q['exchange_ms']
            if p:
                qty=int(p['quantity_sats']);entry=int(p['entry']['price_micros'])
                ep=execution_price(q['bid_micros'],q['ask_micros'],'LONG',False,self.cfg.slippage_bps)
                unrealized=gross_pnl(entry,ep,qty,'LONG')-int(p['entry']['fee_micros'])-fee(ep,qty,self.cfg.taker_fee_bps)
            equity=base_equity+unrealized
        else: unrealized=None
        wins=totals['wins'];losses=totals['losses'];flats=totals['flats'];count=totals['count']
        return {'currency':self.cfg.quote_currency,'initial_equity_micros':str(self.cfg.initial_equity_micros),'cash_micros':str(cash),
            'realized_gross_micros':str(gross),'realized_net_micros':str(net),'fees_paid_micros':str(fees),'carry_paid_micros':'0',
            'unrealized_net_micros':None if unrealized is None else str(unrealized),'equity_micros':None if equity is None else str(equity),
            'equity_mark_ms':mark,'last_known_equity_micros':None if s['last_known_equity'] is None else str(s['last_known_equity']),
            'wins':wins,'losses':losses,'flats':flats,'closed_trades':count,'win_rate_pct':100*wins/count if count else None}

    def _risk(self,s,now):
        a=self._account(s,now)
        if a['equity_micros'] is None: return
        equity=int(a['equity_micros']);s['last_known_equity']=equity
        if self.cfg.execution_enabled and (s['last_equity_checkpoint_ms'] is None or now-s['last_equity_checkpoint_ms']>=15_000 or s['last_fill_ms']==now):
            self.store.insert('equity',{'at_ms':now,'equity_micros':str(equity),'mark_ms':s['quote']['exchange_ms'],'source':'FORWARD_PAPER_MARK','config_hash':self.config_hash})
            s['last_equity_checkpoint_ms']=now
        day=now//86_400_000
        if s['day'] != day:
            s['day']=day;s['day_start_equity']=equity
            if s['circuit_reason']=='DAILY_LOSS_LIMIT':
                s['circuit']=False;s['circuit_reason']=None
                self._audit('CIRCUIT','UTC_DAILY_ENTRY_HALT_CLEARED')
        s['peak_equity']=max(s['peak_equity'],equity)
        s['daily_loss']=max(0,s['day_start_equity']-equity)
        cause=None
        if s['daily_loss']*BPS >= s['day_start_equity']*self.cfg.daily_loss_limit_bps: cause='DAILY_LOSS_LIMIT'
        if (s['peak_equity']-equity)*BPS >= s['peak_equity']*self.cfg.drawdown_halt_bps: cause='DRAWDOWN_LIMIT'
        severity={None:0,'DAILY_LOSS_LIMIT':1,'DRAWDOWN_LIMIT':2,'CLOCK_REGRESSION':3}
        if cause and severity.get(cause,0)>severity.get(s['circuit_reason'],0):
            s['circuit']=True;s['circuit_reason']=cause
            self._audit('CIRCUIT',cause,{'equity_micros':str(equity)})
            if s['pending'] and s['pending']['kind']=='ENTRY':s['pending']=None
            if cause=='DRAWDOWN_LIMIT':
                s['running']=False
                if s['position']: self._queue_exit(s,cause,now,self.cfg.exit_latency_ms)

    def _entry_gate(self,s,now):
        if not self.cfg.execution_enabled:return 'OBSERVER_ONLY_UNVALIDATED_VENUE_AND_COSTS'
        if not self.cfg.feed_enabled or not self.cfg.feed_rights_approved: return 'FEED_DISABLED_OR_RIGHTS_UNAPPROVED'
        if not s['running']: return 'PAUSED'
        if s['circuit']: return s['circuit_reason'] or 'CIRCUIT_BREAKER'
        if not self._fresh(s,now): return 'STALE_OR_MISSING_QUOTE'
        q=s['quote']
        if (q['ask_micros']-q['bid_micros'])*BPS > q['bid_micros']*self.cfg.max_spread_bps: return 'SPREAD_TOO_WIDE'
        if s['position']: return 'POSITION_ALREADY_OPEN'
        if s['pending']: return 'ORDER_ALREADY_PENDING'
        if s['last_close_ms'] and now-s['last_close_ms'] < self.cfg.cooldown_ms: return 'COOLDOWN'
        if self._account(s,now)['equity_micros'] is None:return 'EQUITY_UNKNOWN'
        return None

    def tick(self):
        now=self.clock()
        with self.store.transaction(now):
            s=self._s()
            if now < s['last_tick_ms']:
                s['running']=False;s['circuit']=True;s['circuit_reason']='CLOCK_REGRESSION'
                self._reject(s,'CLOCK_REGRESSION')
            s['last_tick_ms']=max(now,s['last_tick_ms'])
            if s['quote'] and not self._fresh(s,now): self._reject(s,'STALE_QUOTE')
            if s['pending'] and s['pending']['kind']=='ENTRY' and now > s['pending']['expires_ms']:
                self._audit('CANCEL','ENTRY_EXPIRED',s['pending']);s['pending']=None
            self._risk(s,now)
            if s['position'] and now-s['position']['opened_ms'] >= s['position']['max_hold_ms']+16_000:
                self._queue_exit(s,'MISSING_BAR_MAX_HOLD_BACKSTOP',now,self.cfg.exit_latency_ms)
            self._save(s)

    def disconnected(self,reason='FEED_DISCONNECTED'):
        with self.store.transaction(self.clock()):
            s=self._s();self._reject(s,reason);self._save(s)

    def _capture_quote(self,q,now,accepted,reason,observation):
        if observation is None:return
        document=dict(asdict(q),processed_ms=now,accepted=accepted,reason=reason,
            sequence_origin='LOCAL_RECEIPT',session_id=observation['session_id'],
            receipt_monotonic_ns=str(observation['receipt_monotonic_ns']),
            observation_id=observation['observation_id'])
        self.store.db.execute('INSERT INTO observed_quotes VALUES(?,?,?,?,?,?)',
            (observation['observation_id'],q.sequence,q.exchange_ms,q.receipt_ms,int(accepted),canonical(document)))
        self.store.put('observed_quote_count',self.store.get('observed_quote_count',0)+1)

    def on_quote(self,q:Quote,observation=None):
        now=self.clock()
        with self.store.transaction(now):
            s=self._s()
            if q.test_only and self.cfg.ledger_kind!='TEST': raise ValueError('Synthetic feed cannot enter forward ledger')
            if observation is not None:
                if now>=observation['deadline_ms'] or time.monotonic()>=observation['monotonic_deadline']:raise ValueError('OBS_CAPTURE_DEADLINE')
                uuid.UUID(observation['session_id'])
                if self.store.db.execute('SELECT 1 FROM observed_quotes WHERE observation_id=?',(observation['observation_id'],)).fetchone():return False
                self.store.put('observer_quote_sequence',q.sequence)
            if not self.cfg.feed_enabled: return False
            reason=None
            if q.symbol!=self.cfg.symbol: reason='WRONG_SYMBOL'
            elif not all(type(v) is int and v>=0 for v in [q.sequence,q.exchange_ms,q.event_ms,q.receipt_ms,q.bid_micros,q.ask_micros,q.bid_sats,q.ask_sats]): reason='INVALID_QUOTE_TYPES'
            elif q.bid_micros<=0 or q.ask_micros<q.bid_micros or min(q.bid_sats,q.ask_sats)<=0: reason='INVALID_BOOK'
            elif q.receipt_ms>now or now-q.receipt_ms>self.cfg.max_quote_age_ms: reason='STALE_RECEIPT'
            elif now-q.exchange_ms>self.cfg.max_quote_age_ms or q.exchange_ms-now>self.cfg.future_tolerance_ms or q.event_ms-now>self.cfg.future_tolerance_ms: reason='STALE_OR_FUTURE_EXCHANGE_TIME'
            elif q.sequence<s['quote_sequence'] or q.exchange_ms<s['last_quote_exchange_ms']:reason='OUT_OF_ORDER_QUOTE'
            elif q.sequence==s['quote_sequence']:
                if s['quote'] and asdict(q)=={k:v for k,v in s['quote'].items() if k!='processed_ms'}:return False
                reason='DUPLICATE_OR_CONFLICTING_QUOTE'
            if reason:
                self._reject(s,reason,{'sequence':q.sequence});self._capture_quote(q,now,False,reason,observation);self._save(s);return False
            s['quote']=dict(asdict(q),processed_ms=now);s['quote_valid']=True;s['feed_reason']='FRESH'
            s['quote_sequence']=q.sequence;s['last_quote_exchange_ms']=q.exchange_ms
            self._risk(s,now)
            p=s['position']
            if p:
                mark=q.bid_micros if p['side']=='LONG' else q.ask_micros
                stop=int(p['stop_micros']);target=int(p['target_micros'])
                if (p['side']=='LONG' and mark<=stop) or (p['side']=='SHORT' and mark>=stop):self._queue_exit(s,'STOP_LOSS',now,self.cfg.exit_latency_ms)
                elif (p['side']=='LONG' and mark>=target) or (p['side']=='SHORT' and mark<=target):self._queue_exit(s,'TAKE_PROFIT',now,self.cfg.exit_latency_ms)
                elif now-p['opened_ms']>=p['max_hold_ms']+16_000:self._queue_exit(s,'MISSING_BAR_MAX_HOLD_BACKSTOP',now,self.cfg.exit_latency_ms)
            self._fill_pending(s,now)
            self._risk(s,now);self._capture_quote(q,now,True,'FRESH',observation);self._save(s)
            return True

    def warmup(self,bars,*,test_only=False):
        if test_only and self.cfg.ledger_kind!='TEST':raise ValueError('Synthetic warmup rejected')
        now=self.clock()
        with self.store.transaction(now):
            for b in bars[-400:]:
                self._validate_bar(b,now,now,allow_old=True)
                existing=self.store.db.execute('SELECT document FROM bars WHERE close_ms=?',(b['close_ms'],)).fetchone()
                if existing and existing['document'] != canonical(b):raise ValueError('Historical bar conflicts with stored observation')
                self.store.db.execute('INSERT OR IGNORE INTO bars VALUES(?,?)',(b['close_ms'],canonical(b)))
            self._trim_bars();self._audit('WARMUP','HISTORICAL_BARS_NO_TRADES',{'bars':len(bars)})

    def _validate_bar(self,b,received_ms,now,allow_old=False):
        if type(b['open_ms']) is not int or type(b['close_ms']) is not int or b['open_ms']%strategy.CONFIG['timeframe_ms'] or b['close_ms']!=b['open_ms']+strategy.CONFIG['timeframe_ms']-1:raise ValueError('INVALID_BAR_BOUNDARY')
        if b['close_ms']>=received_ms or received_ms>now:raise ValueError('INCOMPLETE_OR_FUTURE_BAR')
        if not allow_old and (now-received_ms>self.cfg.max_bar_delay_ms or received_ms-b['close_ms']>self.cfg.max_bar_delay_ms):raise ValueError('STALE_BAR')
        o,h,l,c=[price(b[x]) for x in ['open','high','low','close']]
        if min(o,h,l,c)<=0 or not l<=min(o,c)<=max(o,c)<=h:raise ValueError('INVALID_OHLC')
        v=Decimal(b['volume']);q=Decimal(b['quote_volume']);buy=Decimal(b['taker_buy_quote_volume'])
        if not all(x.is_finite() for x in [v,q,buy]) or v<0 or q<0 or buy<0 or buy>q:raise ValueError('INVALID_VOLUME')

    def _trim_bars(self):
        self.store.db.execute('DELETE FROM bars WHERE close_ms NOT IN (SELECT close_ms FROM bars ORDER BY close_ms DESC LIMIT 400)')

    def on_bar(self,b,received_ms,*,test_only=False):
        now=self.clock()
        with self.store.transaction(now):
            s=self._s()
            if test_only and self.cfg.ledger_kind!='TEST':raise ValueError('Synthetic bar rejected')
            if not self.cfg.feed_enabled:return False
            try:self._validate_bar(b,received_ms,now)
            except (ValueError,KeyError,TypeError) as e:
                self._reject(s,str(e));self._save(s);return False
            unique=f'{strategy.STRATEGY_VERSION}:{b["close_ms"]}'
            if self.store.db.execute('SELECT 1 FROM calls WHERE unique_id=?',(unique,)).fetchone():return False
            if s['last_bar_close_ms'] is not None and b['close_ms']<=s['last_bar_close_ms']:
                self._reject(s,'OUT_OF_ORDER_BAR');self._save(s);return False
            existing=self.store.db.execute('SELECT document FROM bars WHERE close_ms=?',(b['close_ms'],)).fetchone()
            if existing and existing['document']!=canonical(b):
                self._reject(s,'CONFLICTING_BAR');self._save(s);return False
            self.store.db.execute('INSERT OR IGNORE INTO bars VALUES(?,?)',(b['close_ms'],canonical(b)))
            self._trim_bars()
            rows=[json.loads(r['document']) for r in self.store.db.execute('SELECT document FROM bars ORDER BY close_ms')]
            p=s['position'];sp={'side':p['side'],'entry':str(Decimal(p['entry']['price_micros'])/1_000_000),'entry_ms':p['opened_ms']} if p else None
            d=self.evaluate(rows,sp,strategy.CONFIG)
            if d.get('action') not in {'LONG','EXIT','ABSTAIN'}:raise ValueError('Invalid strategy decision')
            action=d['action'];reason=d['reason'];gate=None
            if action=='LONG':
                gate=self._entry_gate(s,now)
                if not self.cfg.min_stop_bps<=int(d['stop_bps'])<=self.cfg.max_stop_bps:gate='INVALID_STOP'
                if int(d['target_bps'])<=0 or not 0<int(d['max_hold_ms'])<=300_000:gate='INVALID_EXIT_BOUNDS'
                if gate:action='ABSTAIN';reason=gate
            call={'call_id':unique,'action':action,'strategy_action':d['action'],'reason':reason,'decision_ms':now,'bar_close_ms':b['close_ms'],
                  'received_ms':received_ms,'strategy_version':strategy.STRATEGY_VERSION,'risk_micros':str(int(self._account(s,now)['equity_micros'] or 0)*self.cfg.risk_bps//BPS),'config_hash':self.config_hash,'artifact_hash':self.artifact_hash,'signal':d.get('signal',{})}
            self.store.insert('calls',call,unique)
            s['last_bar_close_ms']=b['close_ms'];s['last_decision_ms']=now
            if action=='LONG':
                s['pending']={'kind':'ENTRY','side':action,'call_id':unique,'decision_ms':now,'eligible_ms':now+self.cfg.entry_latency_ms,
                    'expires_ms':now+self.cfg.entry_timeout_ms,'reason':d['reason'],'stop_bps':int(d['stop_bps']),
                    'target_bps':int(d['target_bps']),'max_hold_ms':int(d['max_hold_ms'])}
            elif action=='EXIT' and p:self._queue_exit(s,d['reason'],now,self.cfg.signal_exit_latency_ms)
            self._save(s);return True

    def _queue_exit(self,s,reason,now,delay):
        if not s['position']:return
        pending=s['pending']
        if pending and pending['kind']=='EXIT':
            # A protective exit may accelerate an existing delayed strategy exit.
            if now+delay < pending['eligible_ms']:
                pending.update(reason=reason,decision_ms=now,eligible_ms=now+delay)
            return
        s['pending']={'kind':'EXIT','reason':reason,'decision_ms':now,'eligible_ms':now+delay,'expires_ms':None}
        self._audit('EXIT_INTENT',reason,{'position_id':s['position']['position_id']})

    def _fill(self,q,side,opening,qty,decision_ms,now):
        p=execution_price(q['bid_micros'],q['ask_micros'],side,opening,self.cfg.slippage_bps)
        return {'price_micros':str(p),'quantity_sats':str(qty),'notional_micros':str(cost(p,qty)),
            'fee_micros':str(fee(p,qty,self.cfg.taker_fee_bps)),'exchange_ms':q['exchange_ms'],'event_ms':q['event_ms'],
            'receipt_ms':q['receipt_ms'],'decision_ms':decision_ms,'fill_ms':now,'quote_sequence':str(q['sequence']),'sequence_origin':'LOCAL_RECEIPT',
            'latency_ms':now-decision_ms,'bid_micros':str(q['bid_micros']),'ask_micros':str(q['ask_micros']),
            'slippage_bps':self.cfg.slippage_bps}

    def _fill_pending(self,s,now):
        pending=s['pending'];q=s['quote']
        if not pending or now<pending['eligible_ms'] or not self._fresh(s,now):return
        # Require genuinely new exchange+receipt observation at/after eligibility.
        if q['receipt_ms']<pending['eligible_ms'] or q['exchange_ms']<pending['eligible_ms']:return
        if pending['kind']=='ENTRY':
            s['pending']=None
            gate=self._entry_gate(s,now)
            if now>pending['expires_ms']:gate='ENTRY_EXPIRED'
            if gate:self._audit('CANCEL',gate,pending);return
            equity=int(self._account(s,now)['equity_micros'])
            side=pending['side'];ep=execution_price(q['bid_micros'],q['ask_micros'],side,True,self.cfg.slippage_bps)
            risk=equity*self.cfg.risk_bps//BPS;max_notional=equity*self.cfg.max_exposure_bps//BPS
            # Risk includes stop gap, entry+exit fee and slippage budget, not a guaranteed maximum loss.
            risk_cost_bps=pending['stop_bps']+2*self.cfg.taker_fee_bps+ceildiv(int(self.cfg.slippage_bps*10)*2,10)
            by_risk=risk*SAT*BPS//(ep*risk_cost_bps)
            qty=min(max_notional*SAT//ep,by_risk)
            depth=q['ask_sats'] if side=='LONG' else q['bid_sats']
            qty=min(qty,depth*self.cfg.max_depth_participation_bps//BPS)
            if qty<=0:self._audit('CANCEL','INSUFFICIENT_SIZE',pending);return
            fill=self._fill(q,side,True,qty,pending['decision_ms'],now)
            stop=ep*(BPS-pending['stop_bps'])//BPS if side=='LONG' else ceildiv(ep*(BPS+pending['stop_bps']),BPS)
            target=ceildiv(ep*(BPS+pending['target_bps']),BPS) if side=='LONG' else ep*(BPS-pending['target_bps'])//BPS
            s['position']={'position_id':str(uuid.uuid5(uuid.NAMESPACE_URL,self.config_hash+pending['call_id'])),
                'call_id':pending['call_id'],'side':side,'opened_ms':now,'entry':fill,'quantity_sats':str(qty),
                'stop_micros':str(stop),'target_micros':str(target),'max_hold_ms':pending['max_hold_ms'],
                'risk_micros':str(risk),'strategy_version':strategy.STRATEGY_VERSION,'symbol':self.cfg.symbol,'planned_stop_risk_micros':str(ceildiv(abs(ep-stop)*qty,SAT)),'entry_notional_micros':fill['notional_micros'],'entry_equity_micros':str(equity),'exposure_bps':ceildiv(int(fill['notional_micros'])*BPS,equity),'config_hash':self.config_hash,'artifact_hash':self.artifact_hash}
            self._audit('PAPER_FILL','ENTRY',{'position_id':s['position']['position_id'],'fill':fill})
        else:
            p=s['position']
            if not p:s['pending']=None;return
            qty=int(p['quantity_sats']);depth=q['bid_sats'] if p['side']=='LONG' else q['ask_sats']
            if qty>depth*self.cfg.max_depth_participation_bps//BPS:
                if s.get('exit_depth_blocked')!=p['position_id']:
                    self._audit('ABSTAIN','EXIT_LIQUIDITY_INSUFFICIENT',{'position_id':p['position_id']})
                    s['exit_depth_blocked']=p['position_id']
                return
            fill=self._fill(q,p['side'],False,qty,pending['decision_ms'],now)
            gross=gross_pnl(int(p['entry']['price_micros']),int(fill['price_micros']),qty,p['side'])
            fees=int(p['entry']['fee_micros'])+int(fill['fee_micros'])
            net=gross-fees
            trade={'trade_id':p['position_id'],'position_id':p['position_id'],'side':p['side'],'entry':p['entry'],'exit':fill,
                'closed_ms':now,'exit_reason':pending['reason'],'gross_pnl_micros':str(gross),'fees_micros':str(fees),
                'carry_micros':'0','net_pnl_micros':str(net),'outcome':'WIN' if net>0 else 'LOSS' if net<0 else 'FLAT','strategy_version':strategy.STRATEGY_VERSION,'risk_micros':p['risk_micros'],'planned_stop_risk_micros':p['planned_stop_risk_micros'],'entry_notional_micros':p['entry_notional_micros'],'entry_equity_micros':p['entry_equity_micros'],'exposure_bps':p['exposure_bps'],'symbol':self.cfg.symbol,'config_hash':self.config_hash,'artifact_hash':self.artifact_hash}
            self.store.insert('trades',trade,p['position_id'])
            totals=self.store.get('totals');totals['gross']+=gross;totals['net']+=net;totals['fees']+=fees;totals['count']+=1
            totals[{'WIN':'wins','LOSS':'losses','FLAT':'flats'}[trade['outcome']]]+=1
            self.store.put('totals',totals)
            self._audit('PAPER_FILL','EXIT_NET_PNL_FINAL',{'position_id':p['position_id'],'fill':fill})
            s['position']=None;s['pending']=None;s['last_close_ms']=now;s['exit_depth_blocked']=None
        s['last_fill_ms']=now

    def control(self,action,request_id):
        if action not in {'start','pause','reset_circuit_breaker'}:raise ValueError('Control not allowed')
        uuid.UUID(request_id)
        now=self.clock()
        with self.store.transaction(now):
            row=self.store.db.execute('SELECT action,document FROM controls WHERE request_id=?',(request_id,)).fetchone()
            if row:
                if row['action']!=action:raise ValueError('Idempotency key reused for another action')
                return json.loads(row['document'])
            s=self._s()
            if action=='pause':
                s['running']=False
                if s['pending'] and s['pending']['kind']=='ENTRY':s['pending']=None
            elif action=='start':
                if not self.cfg.execution_enabled:raise ValueError('OBSERVER_ONLY_UNVALIDATED_VENUE_AND_COSTS')
                if not self.cfg.feed_enabled or not self.cfg.feed_rights_approved:raise ValueError('FEED_DISABLED_OR_RIGHTS_UNAPPROVED')
                if s['circuit']:raise ValueError('CIRCUIT_BREAKER_REQUIRES_REVIEW')
                s['running']=True
            else:
                self._risk(s,now)
                if s['position']:raise ValueError('UNRESOLVED_POSITION')
                if s['circuit_reason'] in {'DRAWDOWN_LIMIT','CLOCK_REGRESSION'}:raise ValueError('IMMUTABLE_RISK_HALT_REQUIRES_NEW_REVIEWED_RUN')
                if s['daily_loss'] and s['daily_loss']*BPS>=s['day_start_equity']*self.cfg.daily_loss_limit_bps:raise ValueError('DAILY_LIMIT_STILL_BREACHED')
                if not self._fresh(s,now):raise ValueError('FRESH_DATA_REQUIRED')
                s['circuit']=False;s['circuit_reason']=None;s['running']=False
            self._save(s);self._audit('OWNER_CONTROL',action,{'request_id':request_id})
            result={'ok':True,'action':action,'request_id':request_id,'running_requested':s['running'],'at_ms':now}
            self.store.db.execute('INSERT INTO controls VALUES(?,?,?)',(request_id,action,canonical(result)))
            return result

    def snapshot(self):
        now=self.clock()
        with self.store.lock:
            s=self._s();fresh=self._fresh(s,now);q=s['quote'];a=self._account(s,now)
            no_data=q is None
            state='CIRCUIT_BREAKER' if s['circuit'] else ('EMPTY' if no_data and not self.cfg.feed_enabled else 'WAITING_FOR_DATA' if no_data else 'STALE' if not fresh else 'RUNNING' if s['running'] else 'PAUSED')
            reason=s['circuit_reason'] if s['circuit'] else (s['feed_reason'] if not fresh else 'OWNER_PAUSED' if not s['running'] else self._entry_gate(s,now) or 'READY')
            lease=self.store.db.execute('SELECT * FROM lease WHERE singleton=1').fetchone()
            if lease['expires_ms']<now:state='ERROR';reason='LEASE_EXPIRED'
            equity=int(a['equity_micros'] or s['last_known_equity'] or self.cfg.initial_equity_micros)
            gates=[{'name':'paper_only','ok':True,'reason':'NO_REAL_ORDER_CAPABILITY'},
                   {'name':'data_rights','ok':self.cfg.feed_rights_approved,'reason':'APPROVED' if self.cfg.feed_rights_approved else 'REQUIRES_APPROVAL'},
                   {'name':'fresh_quote','ok':fresh,'reason':'FRESH' if fresh else s['feed_reason']},
                   {'name':'owner_start','ok':s['running'],'reason':'RUNNING' if s['running'] else 'PAUSED'},
                   {'name':'circuit_breaker','ok':not s['circuit'],'reason':s['circuit_reason'] or 'CLEAR'}]
            return {'run_id':s['run_id'],'provenance':self.cfg.ledger_kind,'started_at_ms':s['initial_ms'],'schema_version':'dot-paper/v1','mode':'PAPER','caller':'DOT','symbol':self.cfg.symbol,'server_ms':now,'state':state,
                'running_requested':s['running'],'status_reason':reason,
                'strategy':{'version':strategy.STRATEGY_VERSION,'config_hash':self.config_hash,'strategy_hash':strategy.STRATEGY_HASH,
                    'artifact_hash':self.artifact_hash,'validation':'EXPERIMENTAL_UNVALIDATED','config':strategy.CONFIG,'calibration_venue':'BINANCE_SPOT','forward_venue':self.cfg.feed_source,'domain_shift':self.cfg.feed_source!='TEST_FIXTURE'},
                'feed':{'source':self.cfg.feed_source,'enabled':self.cfg.feed_enabled,'rights_approved':self.cfg.feed_rights_approved,
                    'health':'DISABLED' if not self.cfg.feed_enabled else 'UNKNOWN' if no_data else 'FRESH' if fresh else 'STALE','reason':s['feed_reason'],
                    'exchange_ms':q['exchange_ms'] if q else None,'event_ms':q['event_ms'] if q else None,'receipt_ms':q['receipt_ms'] if q else None,
                    'processed_ms':q['processed_ms'] if q else None,'quote_age_ms':now-q['receipt_ms'] if q else None,
                    'bid_micros':str(q['bid_micros']) if q else None,'ask_micros':str(q['ask_micros']) if q else None,
                    'spread_bps':(q['ask_micros']-q['bid_micros'])*BPS/q['bid_micros'] if q else None,'bar_close_ms':s['last_bar_close_ms'],
                    'warmup_bars':self.store.db.execute('SELECT count(*) FROM bars').fetchone()[0]},
                'simulator':{'health':'READY' if fresh and self.cfg.feed_enabled else 'BLOCKED','reason':reason,'lease_owner':lease['owner'],
                    'lease_expires_ms':lease['expires_ms'],'last_decision_ms':s['last_decision_ms'],'last_fill_ms':s['last_fill_ms']},
                'account':a,'risk':{'risk_bps':self.cfg.risk_bps,'max_exposure_bps':self.cfg.max_exposure_bps,'daily_loss_limit_bps':self.cfg.daily_loss_limit_bps,
                    'circuit_breaker':s['circuit'],'daily_loss_micros':str(s['daily_loss']) if s['daily_loss'] is not None else None,
                    'risk_budget_micros':str(equity*self.cfg.risk_bps//BPS),'max_notional_micros':str(equity*self.cfg.max_exposure_bps//BPS)},
                'assumptions':{'taker_fee_bps':self.cfg.taker_fee_bps,'slippage_bps':self.cfg.slippage_bps,'entry_latency_ms':self.cfg.entry_latency_ms,
                    'exit_latency_ms':self.cfg.exit_latency_ms,'signal_exit_latency_ms':self.cfg.signal_exit_latency_ms,'max_quote_age_ms':self.cfg.max_quote_age_ms,
                    'max_spread_bps':self.cfg.max_spread_bps,'entry_timeout_ms':self.cfg.entry_timeout_ms,
                    'fill_model':'TAKER_BID_ASK_PLUS_ADVERSE_SLIPPAGE; <=10% displayed top quantity; no guaranteed maker fills',
                    'carry_model':'LONG-only cash spot; no borrowing, leverage or funding. Kraken fee80bps/side is conservative public tier1 scenario, user tier unknown.'},
                'observer':{'enabled':self.cfg.feed_enabled,'quote_observations':self.store.get('observed_quote_count',0),'trade_observations':self.store.get('observed_trade_count',0),'stop_at_ms':self.store.get('observer_stop_ms'),'last_receipt_ms':self.store.get('observer_last_ms'),'paper_execution_enabled':False},
                'gates':gates,'position':s['position'],'pending':s['pending'],'calls':self.store.page('calls'),'trades':self.store.page('trades'),'audit':self.store.page('audit'),'equity':self.store.page('equity')}

    def close(self):self.store.close()
