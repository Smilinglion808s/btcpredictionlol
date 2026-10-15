from decimal import Decimal as D
import pytest
from alt import ledger as L

def eqcfg(**k): return L.Config({'ALT_PAPER_STRATEGY_ENABLED':'true', **k})

def test_defaults_and_limits():
    c=L.Config({}); assert (c.leverage,c.margin_frac,c.margin_base)==(D('20'),D('0.20'),'equity')
    with pytest.raises(ValueError): L.Config({'ALT_PAPER_MARGIN_BASE':'x'})

def test_1000_gives_200_margin_4000_notional(tmp_path):
    l=L.Ledger(tmp_path,eqcfg(ALT_PAPER_FEE_BPS='0',ALT_PAPER_SLIPPAGE_BPS='0'),0)
    l.open('SOLUSDT','LONG','100','100',1); p=l.position('SOLUSDT')
    assert D(p['margin'])==D('200') and D(p['qty'])*D(p['entry_price'])==D('4000') and p['leverage']=='20'

def test_second_position_sized_on_equity_not_cash(tmp_path):
    l=L.Ledger(tmp_path,eqcfg(ALT_PAPER_FEE_BPS='0',ALT_PAPER_SLIPPAGE_BPS='0'),0)
    l.open('SOLUSDT','LONG','100','100',1)
    l.on_quote('SOLUSDT','100.5','100.5',1000,True)  # +0.5% * 4000 = +20 upnl
    l.open('DOGEUSDT','SHORT','0.2','0.2',2000)
    assert D(l.position('DOGEUSDT')['margin'])==D('204')  # 0.2*(800+220), not 0.2*800=160

def test_stale_or_unknown_mark_fails_closed(tmp_path):
    l=L.Ledger(tmp_path,eqcfg(),0); l.open('SOLUSDT','LONG','100','100.02',1)
    assert l.open('DOGEUSDT','SHORT','0.2','0.2001',2) is None  # no in-memory mark yet
    l.on_quote('SOLUSDT','100','100.02',100,True)
    assert l.open('DOGEUSDT','SHORT','0.2','0.2001',100+L.MARK_MAX_AGE_MS+1) is None
    l.on_quote('SOLUSDT','100','100.02',200,False)
    assert l.open('DOGEUSDT','SHORT','0.2','0.2001',300) is None
    l.on_quote('SOLUSDT','100','100.02',400,True)
    assert l.open('DOGEUSDT','SHORT','0.2','0.2001',500)

def test_never_exceeds_cash(tmp_path):
    l=L.Ledger(tmp_path,eqcfg(ALT_PAPER_MARGIN_FRACTION='0.5'),0)
    l.open('SOLUSDT','LONG','100','100',1); l.on_quote('SOLUSDT','104','104',2,True)  # equity ~1500+, cash ~496
    assert l.open('DOGEUSDT','LONG','0.2','0.2',3) is None and l.cash()>0

def test_liquidation_at_20x(tmp_path):
    l=L.Ledger(tmp_path,eqcfg(),0); l.open('DOGEUSDT','LONG','0.2','0.2001',0)
    d=l.on_quote('DOGEUSDT','0.19','0.1901',10,True)
    assert d['exit_reason']=='LIQUIDATION' and D(d['net_pnl'])==-(D(d['margin'])+D(d['entry_fee']))
    assert l.cash()==D('1000')+D(d['net_pnl'])

def test_prior_8x_position_kept_after_restart(tmp_path):
    l=L.Ledger(tmp_path,L.Config({'ALT_PAPER_LEVERAGE':'8','ALT_PAPER_MARGIN_BASE':'cash'}),0)
    l.open('SOLUSDT','SHORT','100','100.02',5); cash=l.cash(); l.db.close()
    l2=L.Ledger(tmp_path,eqcfg(),9)
    assert l2.position('SOLUSDT')['leverage']=='8' and l2.cash()==cash and l2._get('identity')==L.IDENTITY
    l2.on_quote('DOGEUSDT','0.2','0.2001',10,True)
    assert l2.open('DOGEUSDT','LONG','0.2','0.2001',11) is None  # SOL mark unknown since restart
    l2.on_quote('SOLUSDT','100','100.02',12,True); l2.open('DOGEUSDT','LONG','0.2','0.2001',13)
    assert l2.position('DOGEUSDT')['leverage']=='20' and l2.position('SOLUSDT')['leverage']=='8'
