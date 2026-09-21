// Preserve receiver observation time; stale/invalid aggregates are unavailable.
export function freshExecution(value:any, now:number){
  const keys=['received','filled','won','lost','pending','skipped','unresolved'];
  if(!value || !keys.every(k=>Number.isSafeInteger(value[k])&&value[k]>=0))return null;
  const at=Date.parse(value.as_of);
  if(!Number.isFinite(at)||at>now+1000||now-at>90000)return null;
  return Object.fromEntries([...keys,'as_of','truncated'].map(k=>[k,value[k]]));
}
