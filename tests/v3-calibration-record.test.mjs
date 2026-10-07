import assert from 'node:assert/strict';
import {allowV3RecordTransition as ok} from '../src/lib/v3/reversal-record.ts';
const open=1791180000000;
const cal={version:'v3-calibrated-risk-r3-r1',lineage:'v3-okx-core-kalshi-official-r1',mode:'enforce',
  evaluated_at_ms:open+45010,feature_asof_ms:open+44999,head_sha256:'a'.repeat(64),p_correct:.70,
  status:'PASS',reason:'ADD_LOWER60',baseline_side:0,candidate_side:1,candidate_checkpoint:15,candidate_rank:.65,
  original_selected_side:null,original_selected_checkpoint:null,original_risk_status:null};
const add={status:'SELECTED',direction:1,checkpoint:15,reason:'ADD_LOWER60',calibration_filter:cal,
  reversal_risk:{version:'v3-reversal-risk-t45-r1',status:'PASS'}};
const none={status:'NO_CALL',direction:null,checkpoint:null};
assert(ok(none,{status:'SELECTED',direction:1,checkpoint:15,reason:null,
  calibration_filter:{...cal,mode:'shadow'}},open));
assert(ok(none,add,open));
assert(!ok(add,none,open));
assert(ok(add,add,open));
assert(ok(add,{...add,status:'EXPIRED_UNSENT'},open));
for(const bad of [{mode:'shadow'},{lineage:'v3-binance-index-proxy-r3'},{version:'bad'},
    {p_correct:.63},{candidate_side:-1},{candidate_checkpoint:30},{candidate_rank:.59},
    {evaluated_at_ms:open+46000},{head_sha256:'bad'}]) {
  // Legacy no-call -> selected is normally permitted; an invalid explicit calibration
  // must not inherit that permissive branch.
  assert(!ok(none,{...add,calibration_filter:{...cal,...bad}},open));
}
const old={status:'SELECTED',direction:-1,checkpoint:30};
const replacing={...add,calibration_filter:{...cal,original_selected_side:-1,
  original_selected_checkpoint:30,original_risk_status:'SKIP'}};
assert(ok(old,replacing,open));
assert(!ok(old,{...replacing,calibration_filter:{...replacing.calibration_filter,original_risk_status:'PASS'}},open));
const keep={...add,reason:'KEEP_BASELINE',calibration_filter:{...cal,reason:'KEEP_BASELINE',baseline_side:1,
  original_selected_side:1,original_selected_checkpoint:15}};
assert(ok({...old,direction:1,checkpoint:15},keep,open));
assert(!ok(old,keep,open));
const skip={...keep,status:'NO_CALL',reason:'SKIP_BASELINE',calibration_filter:{...keep.calibration_filter,
  reason:'SKIP_BASELINE',status:'SKIP',p_correct:.54}};
assert(ok({...old,direction:1,checkpoint:15},skip,open));
assert(!ok(skip,keep,open));
console.log('Calibration recording checks passed');
