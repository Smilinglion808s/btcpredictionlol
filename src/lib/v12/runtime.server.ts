import {readUExecution} from './execution-status.server';
// Store only bounded operational fields from the authenticated prediction worker.
const FIELDS=['stage','fit_expires_at','fit_version','last_context_at','last_error','u_eligible','u_block_reason',
  'early_features_ready','quote_received_at','quote_error','index_complete_through','spot_complete_through',
  'perp_complete_through','refresh_status','refresh_error','training_rows','training_latest_at',
  'last_attempt_at','last_attempt_status','last_attempt_checkpoint',
  // Bounded latency observability. Durations and timestamps only.
  'early_dispatch_at','early_dispatch_ms','early_dispatch_error','last_dispatch_leg','last_dispatch_at',
  'last_dispatch_decision_to_dispatch_ms','last_dispatch_decision_to_receipt_ms'];

export async function recordRuntime(sb:any,input:Record<string,unknown>,readExecution=readUExecution){
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
  // Independent heartbeat path: this read never delays prediction delivery.
  // Ignore any worker-supplied counts; obtain them from the signed receiver.
  status.u_execution=await readExecution(sb);
  const {error}=await sb.from('v12_predictor_runtime').upsert({worker_id:'v12-shadow-worker',received_at:new Date().toISOString(),status});
  if(error)throw new Error('PREDICTOR_STATUS_STORE_UNAVAILABLE');
  return {recorded:true};
}
