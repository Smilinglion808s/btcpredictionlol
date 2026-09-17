import test from 'node:test';
import assert from 'node:assert/strict';
import {planEntry,takerFeeCents} from './execution.ts';
const base={openingEquityCents:100000,availableCashCents:100000,bidCents:54,askCents:56,tickCents:1,minOdds:1.5};
test('maker plans preserve route budgets and cannot turn into takers',()=>{
  for(const route of ['V1','U'] as const){
    const p=planEntry({...base,route,uLimitAllIn:.8,uKnownAsk:.56});
    assert.equal(p.status,'PLANNED');if(p.status!=='PLANNED')return;
    assert.equal(p.targetBudgetCents,route==='V1'?4000:10000);
    assert(p.postOnly);assert.equal(p.allowTakerFallback,false);assert.equal(p.feesCents,0);
    assert(p.totalCostCents<=p.budgetCents);assert(p.priceCents<base.askCents);
  }
});
test('T45 exact rounded fees fit within 5 percent, cash cap and affordability',()=>{
  assert.equal(takerFeeCents(100,50),175);assert.equal(takerFeeCents(1,50),2);
  const p=planEntry({...base,route:'T45R2',minOdds:1.4,availableCashCents:4300});
  assert.equal(p.status,'PLANNED');if(p.status!=='PLANNED')return;
  assert.equal(p.targetBudgetCents,5000);assert.equal(p.budgetCents,4300);assert.equal(p.postOnly,false);
  assert(p.totalCostCents<=4300);
  assert((p.quantity+1)*p.priceCents+takerFeeCents(p.quantity+1,p.priceCents)>4300);
});
test('missing or breached original U admission cannot become a maker order',()=>{
  assert.throws(()=>planEntry({...base,route:'U'}));
  assert.equal(planEntry({...base,route:'U',uKnownAsk:.56,uLimitAllIn:.58}).status,'U_PRICE_REJECTED');
});
