import pytest
from decimal import Decimal as D
from alt import ledger as L

def cfg(**k): return L.Config({'ALT_PAPER_STRATEGY_ENABLED':'true', **k})

def test_config_limits():
    assert L.Config({}).enabled is False
    with pytest.raises(ValueError): L.Config({'ALT_PAPER_LEVERAGE':'9'})
    with pytest.raises(ValueError): L.Config({'ALT_PAPER_HOLD_MIN':'10'})

def test_open_close_fees_idempotent_one_position(tmp_path):
    l=L.Ledger(tmp_path,cfg(ALT_PAPER_LEVERAGE='8',ALT_PAPER_HOLD_MIN='5'),0)
    assert l.cash()==D('1000')
    t=l.open('SOLUSDT','LONG','100','100.02',1000)
    assert t and l.open('SOLUSDT','SHORT','100','100.02',2000) is None
    assert l.cash()<D('900')
    assert l.on_quote('SOLUSDT','100','100.02',1000+4*60_000,True) is None
    d=l.on_quote('SOLUSDT','100','100.02',1000+5*60_000,True)
    assert d['exit_reason']=='TIME_5M' and D(d['net_pnl'])<0 and d['entry_ms']==1000
    assert l.close('SOLUSDT','1','2',9,'X') is None and l.status()['trade_count']==1
    assert l.cash()==D('1000')+D(d['net_pnl'])

def test_liquidation_caps_loss_at_margin(tmp_path):
    l=L.Ledger(tmp_path,cfg(ALT_PAPER_LEVERAGE='8'),0)
    l.open('DOGEUSDT','LONG','0.2','0.2001',0)
    d=l.on_quote('DOGEUSDT','0.17','0.1701',10,True)
    assert d['exit_reason']=='LIQUIDATION'
    assert D(d['net_pnl'])==-(D(d['margin'])+D(d['entry_fee']))
    assert D(l.status()['equity'])>D('880')

def test_persists_never_resets_and_mismatch_fails_closed(tmp_path):
    l=L.Ledger(tmp_path,cfg(),0); l.open('SOLUSDT','SHORT','100','100.02',5); c=l.cash(); l.db.close()
    l2=L.Ledger(tmp_path,cfg(),99); assert l2.cash()==c and l2.position('SOLUSDT')
    l2._put('identity','other'); l2.db.close()
    with pytest.raises(ValueError,match='IDENTITY'): L.Ledger(tmp_path,cfg(),1)
    (tmp_path/'ledger'/'junk').write_text('x')
    with pytest.raises(ValueError,match='UNEXPECTED'): L.Ledger(tmp_path,cfg(),1)

def test_disabled_or_stale_never_trades(tmp_path):
    for c,fresh in ((L.Config({}),True),(cfg(),False)):
        d=tmp_path/str(fresh); d.mkdir(); l=L.Ledger(d,c,0)
        for i in range(0,70_000,5000): l.on_quote('SOLUSDT',str(100+i/1000),str(100.02+i/1000),i,fresh)
        assert l.status()['trade_count']==0 and not l.position('SOLUSDT')

def test_exploratory_rule_enters_on_fresh_move(tmp_path):
    l=L.Ledger(tmp_path,cfg(),0)
    for i in range(0,61_000,5000): l.on_quote('SOLUSDT',str(100+i/1000),str(100.02+i/1000),i,True)
    assert l.position('SOLUSDT')['side']=='LONG'
