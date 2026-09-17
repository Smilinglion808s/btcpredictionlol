/** Pure order planner. No exchange credentials, submissions or automatic activation. */
import {budgetCents,ROUTES,type Route} from './contract.ts';

export function takerFeeCents(contracts:number,priceCents:number):number {
  // ceil(100 * .07 * q * p * (1-p)), evaluated exactly for integer cents.
  return Number((7n*BigInt(contracts)*BigInt(priceCents)*BigInt(100-priceCents)+9999n)/10000n);
}
export interface PlanInput {
  route:Route;openingEquityCents:number;availableCashCents:number;
  bidCents:number;askCents:number;tickCents:number;
  // Existing early-route floors, copied explicitly from the current receiver.
  minOdds:number;
  // U's original conservative fee/reserve admission remains independent of execution mode.
  uLimitAllIn?:number;uKnownAsk?:number;
}
export function planEntry(i:PlanInput){
  const r=ROUTES[i.route];
  if(!r || !Number.isSafeInteger(i.availableCashCents) || i.availableCashCents<0 ||
    ![i.bidCents,i.askCents,i.tickCents].every(Number.isSafeInteger) || i.tickCents<1 ||
    i.bidCents<=0 || i.askCents>=100 || i.bidCents>i.askCents || !Number.isFinite(i.minOdds) || i.minOdds<=1)
    throw new Error('INVALID_PRICE_OR_BUDGET');
  const target=budgetCents(i.openingEquityCents,i.route);
  // Insufficient cash means a smaller affordable order, never borrowed buying power.
  const budget=Math.min(target,i.availableCashCents);
  const taker=r.execution==='taker_only';
  let price=taker?i.askCents:Math.min(i.bidCents+i.tickCents,i.askCents-i.tickCents);
  if(i.route==='U'){
    if(!Number.isFinite(i.uLimitAllIn) || !Number.isFinite(i.uKnownAsk) || i.uLimitAllIn!<=0 || i.uLimitAllIn!>=1)
      throw new Error('U_ADMISSION_MISSING');
    const conservative=Math.max(i.uKnownAsk!,i.askCents/100)+.01;
    if(conservative>=1 || conservative+.07*conservative*(1-conservative)>i.uLimitAllIn!+1e-12)
      return {status:'U_PRICE_REJECTED'} as const;
  }
  // Preserve the current early-route three-cent safety allowance at admission.
  const ceiling=i.route==='U'?99:Math.floor(100/i.minOdds-3+1e-9);
  if(taker && price>ceiling)return {status:'PRICE_REJECTED'} as const;
  price=Math.min(price,ceiling);
  price=Math.floor(price/i.tickCents)*i.tickCents;
  if(price<1 || (!taker && price>=i.askCents))return {status:'NO_MAKER_PRICE'} as const;
  let quantity=Math.floor(budget/price);
  const fee=(q:number)=>taker?takerFeeCents(q,price):0;
  // Binary search includes order-level fee rounding without an O(stake) loop.
  let low=0,high=quantity;
  while(low<high){const mid=Math.ceil((low+high)/2);if(mid*price+fee(mid)<=budget)low=mid;else high=mid-1;}
  quantity=low;
  if(quantity<1)return {status:'INSUFFICIENT_BUDGET'} as const;
  return {status:'PLANNED',route:i.route,modelVersion:r.model,execution:r.execution,
    targetBudgetCents:target,budgetCents:budget,priceCents:price,quantity,feesCents:fee(quantity),
    totalCostCents:quantity*price+fee(quantity),postOnly:!taker,
    timeInForce:taker?'immediate_or_cancel':'good_till_canceled',allowTakerFallback:false} as const;
}
