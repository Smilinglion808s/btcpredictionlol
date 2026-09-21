// Authenticated, read-only aggregates. Never enters the signal/order path.
export function summarizeExecution(rows: any[]) {
  const summary={received:rows.length,filled:0,won:0,lost:0,pending:0,skipped:0,unresolved:0};
  for(const row of rows){
    const bet=row.bet_history;
    if(bet && Number(bet.contracts)>0){
      summary.filled++;
      if(bet.result==='won')summary.won++;
      else if(bet.result==='lost')summary.lost++;
      else summary.pending++;
    }else if(['NOT_SUBMITTED','NO_FILL','REJECTED_NO_FILL','PREFLIGHT_BLOCKED','CLAIM_REJECTED'].includes(row.execution_status))summary.skipped++;
    else summary.unresolved++;
  }
  return summary;
}
export async function executionStatus(route:string,get:(key:string)=>string|undefined,transport:typeof fetch,now:number){
  const base=get('SUPABASE_URL'),key=get('SUPABASE_SERVICE_ROLE_KEY')||get('KALSHI_SUPABASE_SERVICE_ROLE');
  if(!base||!key)throw Error('STORAGE_NOT_CONFIGURED');
  const response=await transport(base+'/rest/v1/v12_shadow_signals?route=eq.'+route+
    '&select=execution_status,bet_id&order=received_at.desc&limit=1000',
    {headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(2500)});
  if(!response.ok)throw Error('EXECUTION_STATUS_UNAVAILABLE');
  const rows=await response.json();if(!Array.isArray(rows))throw Error('EXECUTION_STATUS_UNAVAILABLE');
  const ids=rows.map((r:any)=>r.bet_id).filter((id:any)=>typeof id==='string'&&/^[0-9a-f-]{36}$/.test(id));
  const bets=new Map<string,any>();
  for(let i=0;i<ids.length;i+=100){
    const res=await transport(base+'/rest/v1/bet_history?select=id,contracts,result&id=in.('+ids.slice(i,i+100).join(',')+')',
      {headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(2500)});
    if(!res.ok)throw Error('EXECUTION_STATUS_UNAVAILABLE');
    const data=await res.json();if(!Array.isArray(data))throw Error('EXECUTION_STATUS_UNAVAILABLE');
    for(const b of data)bets.set(b.id,b);
  }
  for(const r of rows)r.bet_history=bets.get(r.bet_id);
  return {kind:'V12_EXECUTION_STATUS',route,as_of:new Date(now).toISOString(),...summarizeExecution(rows),
    window_limit:1000,truncated:rows.length===1000,orders_submitted:0,records_created:0};
}
