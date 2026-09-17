// Store only bounded operational fields from the authenticated prediction worker.
const FIELDS=['stage','fit_expires_at','fit_version','last_context_at','last_error','u_eligible','u_block_reason',
  'early_features_ready','quote_received_at','quote_error','index_complete_through','spot_complete_through',
  'perp_complete_through','refresh_status','refresh_error','training_rows','training_latest_at'];
export async function recordRuntime(sb:any,input:Record<string,unknown>){
  if(!input || typeof input!=='object' || Array.isArray(input) || input.mode!=='shadow' || input.execution_enabled!==false)
    throw new Error('INVALID_PREDICTOR_STATUS');
  const status:Record<string,unknown>={mode:'shadow',execution_enabled:false};
  for(const key of FIELDS){
    const value=input[key];
    if(value===null || typeof value==='boolean' || (typeof value==='number' && Number.isFinite(value)) ||
      (typeof value==='string' && value.length<=160))status[key]=value;
  }
  const probe=input.receiver_probe as any;
  if(probe && Array.isArray(probe.receivers))status.receiver_auth=Object.fromEntries(
    ['V1','T45R2','U'].map(leg=>[leg,probe.receivers.some((r:any)=>r.leg===leg && r.authenticated===true)]));
  const {error}=await sb.from('v12_predictor_runtime').upsert({worker_id:'v12-shadow-worker',received_at:new Date().toISOString(),status});
  if(error)throw new Error('PREDICTOR_STATUS_STORE_UNAVAILABLE');
  return {recorded:true};
}
