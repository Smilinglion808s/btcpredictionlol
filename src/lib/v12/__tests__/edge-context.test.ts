import {describe,it,expect} from 'vitest';
import {readV12Context as canonical,readV12UContext} from '../context.server';
// The generated, deployable bundle must retain the canonical behavior.
// @ts-ignore generated JavaScript has no declaration file
import {readV12Context as bundled} from '../../../../supabase/functions/v12-shadow-adapter/core.js';

const open='2026-09-17T20:00:00.000Z';
function fixture(){
  return {target:{ticker:'KXBTC15M-26SEP171415-15',run_mode:'LIVE',final_side:0,publication_offset_ms:6000,
    target_open_utc:open,webhook_status:null,webhook_dedupe_key:null,
    features:{input_valid:true,lite_a:{reason:'CONFIDENCE_ABSTAIN'},daily_floor:{ordinary_floor_allows:true},direction60:{binance_spot_t0_w900_return_bps:6}}},
    t45:{ticker:'KXBTC15M-26SEP171415-15',run_mode:'LIVE_SHADOW',side:0,evidence:{trigger_signed:true},within_publication_ceiling:true},
    early:{spot_complete:true,feature_complete:true,t45_quote_flow_45s:1,t45_quote_flow_15s:2,t45_close_vwap_gap_bps:3,t45_path_efficiency_45s:4,
      t45_last15_ret_bps:5,t45_trade_count_last15_share:6},
    history:Array.from({length:96},(_,i)=>({target_open_utc:new Date(Date.parse(open)-i*900000).toISOString(),features:{direction60:{binance_spot_t0_w900_return_bps:i%3?i:-250}}})),
    claims:[],claimError:null};
}
function database(f:any){
  return {from:(table:string)=>{let history=false;
    const result=()=>({data:table==='c85_targets'?(history?f.history:f.target):table==='v11_decisions'?f.t45:table==='t45_features'?f.early:f.claims,
      error:table==='c85_outbox'?f.claimError:null});
    const q:any={select:()=>q,eq:()=>q,lte:()=>{history=true;return q;},order:()=>q,limit:()=>q,maybeSingle:async()=>result(),
      then:(resolve:any,reject:any)=>Promise.resolve(result()).then(resolve,reject)};return q;}};
}
describe('Edge bundle decision-reader parity',()=>{
  const cases:Record<string,(f:any)=>void>={
    eligible:()=>{},missingV1:f=>f.target=null,notLive:f=>f.target.run_mode='BACKFILL',
    stringFalse:f=>f.target.features.input_valid='false',floorClosed:f=>f.target.features.daily_floor.ordinary_floor_allows=false,
    noFallback:f=>f.t45=null,selectedFallback:f=>f.t45.side=1,unsignedFallback:f=>f.t45.evidence.trigger_signed=false,
    lateFallback:f=>f.t45.within_publication_ceiling=false,
    claimed:f=>f.claims=[{state:'PENDING'}],failedClaimRead:f=>f.claimError={message:'unavailable'},
    sent:f=>f.target.webhook_status='SENT',missingEarly:f=>f.early=null,nullInput:f=>f.early.t45_last15_ret_bps=null,
    unrelatedPriorMissing:f=>f.early.feature_complete=false,incompleteSpot:f=>f.early.spot_complete=false,
    stringSpotFlag:f=>f.early.spot_complete='true',
    tooFewVol:f=>f.history=f.history.slice(0,23),zeroVol:f=>f.history.forEach((r:any)=>r.features.direction60.binance_spot_t0_w900_return_bps=0),
  };
  for(const [name,mutate] of Object.entries(cases))it(name,async()=>{
    const f:any=fixture();mutate(f);
    const expected=await canonical(database(f) as any,open),actual=await bundled(database(f),open);
    expect(actual).toEqual(expected);
    const minimal=await readV12UContext(database(f) as any,open);
    expect(minimal.ready).toEqual(expected.ready);
    if(expected.ready && minimal.ready){expect(minimal.u_eligible).toEqual(expected.u_eligible);expect(minimal.eligibility).toEqual(expected.eligibility);}
    if(name==='eligible')expect(actual.u_eligible).toBe(true);
    if(name==='unrelatedPriorMissing')expect(actual.early).not.toBeNull();
    if(['incompleteSpot','stringSpotFlag','nullInput','missingEarly','tooFewVol'].includes(name))expect(actual.early).toBeNull();
    if(['stringFalse','floorClosed','noFallback','selectedFallback','unsignedFallback','lateFallback','claimed','failedClaimRead','sent'].includes(name))expect(actual.u_eligible).toBe(false);
  });
});

it('U send validation does not read feature history',async()=>{
  const f=fixture(),base=database(f);
  const sb={from:(table:string)=>{
    if(table==='t45_features')throw Error('feature read on critical path');
    const q=base.from(table);q.lte=()=>{throw Error('history on critical path');};return q;
  }};
  const result=await readV12UContext(sb as any,open);
  expect(result.ready && result.u_eligible).toBe(true);
});
