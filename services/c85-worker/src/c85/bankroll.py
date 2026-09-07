"""Adapted verified staking replay: variable week count and zero/failure guards."""
import numpy as np
import pandas as pd

def run(f,option,origin='2026-04-13',win_profit_pct=80,keep_ledger=False,weeks=20):
    local_start=pd.Timestamp(origin,tz='America/Boise')
    boundaries=pd.date_range(local_start,periods=weeks+1,freq='7D').tz_convert('UTC')
    start,end=boundaries[0],boundaries[-1]
    p=f.CM_BOTH.to_numpy(int);y=f.label.to_numpy(int)
    ts=f.ts.astype('int64').to_numpy(); st=f.settlement_ts.astype('int64').to_numpy()
    called=np.flatnonzero((p!=0)&(ts>=start.value)&(ts<end.value))
    events=[]
    for i in called:
        events.append((int(ts[i])+5_000_000_000,3,int(i)))
        if st[i]<=end.value:events.append((int(st[i]),0,int(i)))
    for w,b in enumerate(boundaries):events.append((int(b.value),1,w))
    if option['reset']=='weekly':resets=boundaries[:-1]
    elif option['reset']=='daily':resets=pd.date_range(local_start,periods=weeks*7,freq='D').tz_convert('UTC')
    else:resets=[]
    for b in resets:events.append((int(b.value),2,-1))
    cash=50000;pending={};pnl=0;stake=0;peak=50000;peak_time=start.isoformat()
    worst_dd=0.;worst=None;mincash=cash;minprincipal=cash;minbuffer=float('inf');squeeze=None
    maxpending=0;maxpendingpct=0.;maxactualpct=0.;maxactual=None;minstake=None;maxstake=0
    weekly=[];ledger=[];failure=None;funded=settled=0;zero=False
    def sized(principal):return (principal*option['basis_points']+5000)//10000
    def finish_week():
        r=weekly[-1];principal=cash+sum(pending.values())
        r.update(ending_principal_cents=principal,ending_cash_cents=cash,pending_cost_cents=sum(pending.values()),
            return_pct=100*(principal/r['opening_principal_cents']-1))
    for t,kind,i in sorted(events):
        if kind==1:
            if weekly:finish_week()
            if i==weeks:break
            score=p*y;mask=(ts>=boundaries[i].value)&(ts<boundaries[i+1].value)&(p!=0)
            weekly.append(dict(week=i+1,start_date=boundaries[i].tz_convert('America/Boise').strftime('%Y-%m-%d'),
                end_date=(boundaries[i+1].tz_convert('America/Boise').date()-pd.Timedelta(days=1)).strftime('%Y-%m-%d'),
                wins=int((score[mask]==1).sum()),losses=int((score[mask]==-1).sum()),calls=int(mask.sum()),
                opening_principal_cents=cash+sum(pending.values()),realized_pnl_cents=0,
                minimum_principal_cents=cash+sum(pending.values()),minimum_cash_cents=cash,
                first_stake_cents=None,minimum_stake_cents=None,maximum_stake_cents=None))
        elif kind==2:stake=sized(cash+sum(pending.values()))
        elif kind==3:
            principal=cash+sum(pending.values())
            if option['reset']=='each_call':stake=sized(principal)
            if stake<=0 or cash<stake:
                failure=dict(time_utc=pd.Timestamp(t,tz='UTC').isoformat(),week=len(weekly),
                    cash_cents=cash,stake_cents=stake,principal_cents=principal)
                break
            actual=100*stake/principal
            if actual>maxactualpct:
                maxactualpct=actual;maxactual=dict(time_utc=pd.Timestamp(t,tz='UTC').isoformat(),
                    stake_cents=stake,principal_cents=principal)
            minstake=stake if minstake is None else min(minstake,stake);maxstake=max(maxstake,stake)
            pending[i]=stake;cash-=stake;funded+=1;maxpending=max(maxpending,len(pending))
            w=weekly[-1]
            if w['first_stake_cents'] is None:w['first_stake_cents']=stake
            w['minimum_stake_cents']=stake if w['minimum_stake_cents'] is None else min(w['minimum_stake_cents'],stake)
            w['maximum_stake_cents']=stake if w['maximum_stake_cents'] is None else max(w['maximum_stake_cents'],stake)
        else:
            assert i in pending
            amount=pending.pop(i)
            profit=(amount*win_profit_pct+50)//100 if p[i]==y[i] else -amount
            cash+=amount+profit;pnl+=profit;settled+=1
            weekly[-1]['realized_pnl_cents']+=profit
        principal=cash+sum(pending.values())
        assert principal==50000+pnl and cash>=0
        zero=zero or principal<=0
        if principal>peak:peak=principal;peak_time=pd.Timestamp(t,tz='UTC').isoformat()
        dd=(peak-principal)/peak
        if dd>worst_dd:
            worst_dd=dd;worst=dict(peak_cents=peak,trough_cents=principal,peak_time_utc=peak_time,
                trough_time_utc=pd.Timestamp(t,tz='UTC').isoformat(),week=len(weekly))
        if stake and cash/stake<minbuffer:
            minbuffer=cash/stake;squeeze=dict(cash_cents=cash,stake_cents=stake,
                pending_cost_cents=sum(pending.values()),time_utc=pd.Timestamp(t,tz='UTC').isoformat())
        maxpendingpct=max(maxpendingpct,100*sum(pending.values())/principal if principal>0 else 0.)
        mincash=min(mincash,cash);minprincipal=min(minprincipal,principal)
        if weekly:
            weekly[-1]['minimum_cash_cents']=min(weekly[-1]['minimum_cash_cents'],cash)
            weekly[-1]['minimum_principal_cents']=min(weekly[-1]['minimum_principal_cents'],principal)
        if keep_ledger and kind in [0,3]:
            ledger.append(dict(time_utc=pd.Timestamp(t,tz='UTC').isoformat(),kind='settlement' if kind==0 else 'entry',
                source_row=i,week=len(weekly),cash_cents=cash,pending_cost_cents=sum(pending.values()),
                principal_cents=principal,stake_cents=amount if kind==0 else stake,
                profit_cents=profit if kind==0 else 0))
    completed=[w for w in weekly if 'ending_principal_cents' in w]
    for w in completed:assert w['opening_principal_cents']+w['realized_pnl_cents']==w['ending_principal_cents']
    for a,b in zip(completed,completed[1:]):assert a['ending_principal_cents']==b['opening_principal_cents']
    if not failure:assert funded==len(called) and len(completed)==weeks
    returns=[w['return_pct'] for w in completed]
    result=dict(option=option,origin=origin,gross_payout=1+win_profit_pct/100,all_calls_funded=failure is None,
        funding_failure=failure,literal_zero=zero,calls_planned=len(called),calls_funded=funded,calls_settled=settled,
        ending_principal_cents=cash+sum(pending.values()),ending_cash_cents=cash,pending_cost_cents=sum(pending.values()),
        total_return_pct=100*((cash+sum(pending.values()))/50000-1) if not failure else None,
        max_drawdown_pct=100*worst_dd,worst_drawdown=worst,minimum_cash_cents=mincash,
        minimum_principal_cents=minprincipal,minimum_cash_in_stakes=minbuffer,tightest_cash=squeeze,
        maximum_pending_bets=maxpending,maximum_pending_cost_pct=maxpendingpct,
        maximum_actual_stake_pct=maxactualpct,maximum_actual_stake=maxactual,
        minimum_stake_cents=minstake,maximum_stake_cents=maxstake,
        worst_week_pct=min(returns) if returns else None,best_week_pct=max(returns) if returns else None,median_week_pct=float(np.median(returns)) if returns else None,
        geometric_week_pct=100*((cash+sum(pending.values()))/50000)**(1/weeks)-100 if not failure else None,
        losing_weeks=sum(x<0 for x in returns),weekly=weekly)
    return result,ledger
