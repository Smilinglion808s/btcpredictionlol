// Read-only adapter over the committed original decisions. No claims or guard writes.
import type { SupabaseClient } from '@supabase/supabase-js';
import { readV1Snapshot } from '@/lib/v11/store.server';
import { computeV11Vol } from '@/lib/v11/features';
import { uEligible } from './contract';

/**
 * Minimal early-route reader for the latency-critical V1/T45R2 dispatch.
 *
 * It resolves exactly the same identity, committed state, input validity, run
 * mode and signed T45 provenance that `readV12Context` applies to those two
 * legs, using two parallel reads. It deliberately omits the U feature row, the
 * 96-row volatility history and the U-only prior-claim read: none of those are
 * inputs to a V1 or T45R2 decision. U publishing uses readV12UContext below.
 */
export async function readV12EarlyContext(sb: SupabaseClient, open: string) {
  const [target, fallback] = await Promise.all([
    sb.from('c85_targets').select('ticker,target_open_utc,run_mode,final_side,probability_yes,publication_offset_ms,features')
      .eq('model_version','lite-a-floor4-top10-r1').eq('target_open_utc',open).maybeSingle(),
    sb.from('v11_decisions').select('ticker,target_ts,leg,side,reason,probability,decision_offset_ms,run_mode,evidence,within_publication_ceiling,created_at')
      .eq('target_ts',open).maybeSingle(),
  ]);
  for (const result of [target,fallback]) if(result.error) throw result.error;
  const v1=target.data, t45=fallback.data;
  if(!v1 || v1.run_mode!=='LIVE') return {ready:false,reason:'V1_NOT_COMMITTED_LIVE'} as const;
  return {ready:true,ticker:v1.ticker,open:new Date(open).toISOString(),v1,
    t45:t45 && t45.ticker===v1.ticker && t45.within_publication_ceiling===true ? t45 : null} as const;
}

export async function readV12Context(sb: SupabaseClient, open: string) {

  const [snapshot, target, fallback, early, history] = await Promise.all([
    readV1Snapshot(sb, open),
    sb.from('c85_targets').select('ticker,target_open_utc,run_mode,final_side,probability_yes,publication_offset_ms,features')
      .eq('model_version','lite-a-floor4-top10-r1').eq('target_open_utc',open).maybeSingle(),
    sb.from('v11_decisions').select('ticker,target_ts,leg,side,reason,probability,decision_offset_ms,run_mode,evidence,within_publication_ceiling,created_at')
      .eq('target_ts',open).maybeSingle(),
    sb.from('t45_features').select('spot_complete,t45_quote_flow_45s,t45_quote_flow_15s,t45_close_vwap_gap_bps,t45_path_efficiency_45s,t45_last15_ret_bps,t45_trade_count_last15_share')
      .eq('feature_version','t45-features-r1').eq('target_ts',open).maybeSingle(),
    sb.from('c85_targets').select('target_open_utc,features').eq('model_version','lite-a-floor4-top10-r1')
      .lte('target_open_utc',open).order('target_open_utc',{ascending:false}).limit(96),
  ]);
  for (const result of [target,fallback,early,history]) if(result.error) throw result.error;
  const v1=target.data, t45=fallback.data;
  if(!v1 || !snapshot.committed || snapshot.runMode!=='LIVE') return {ready:false,reason:'V1_NOT_COMMITTED_LIVE'};
  const eligibility={v1:{inputValid:snapshot.inputValid,reason:snapshot.reason,
    ordinaryFloorAllows:snapshot.ordinaryFloorOpen===true,finalSide:snapshot.finalSide},
    t45:{finalized:!!t45 && t45.run_mode==='LIVE_SHADOW' && t45.ticker===v1.ticker &&
      t45.evidence?.trigger_signed===true && t45.within_publication_ceiling===true,finalSide:t45?.side},
    anyPriorClaim:snapshot.sendClaim!=='none'};
  const rows=(history.data??[]).slice().reverse();
  const raw=rows.map((r:any)=>r.features?.direction60?.binance_spot_t0_w900_return_bps??null);
  const last=rows.at(-1);
  const vol=last && Date.parse(last.target_open_utc)===Date.parse(open) ? computeV11Vol(raw.slice(0,-1),raw.at(-1)) : {vol:null};
  const e=early.data; let features:Record<string,number>|null=null;
  // U consumes only the six completed spot-bar fields below. The legacy
  // feature_complete flag also requires an unrelated frozen R2 prior; that
  // prior is not an input to either original U head. Keep all six finite checks.
  if(e?.spot_complete===true && vol.vol!==null){
    const fields=['quote_flow_45s','quote_flow_15s','close_vwap_gap_bps','path_efficiency_45s','trade_count_last15_share'];
    const values=fields.map(k=>(e as any)['t45_'+k]);
    if(values.every(v=>typeof v==='number' && Number.isFinite(v)) && typeof e.t45_last15_ret_bps==='number' && Number.isFinite(e.t45_last15_ret_bps)){
      features=Object.fromEntries(fields.map((k,i)=>['feature_t45_'+k,values[i]]));
      features.norm_feature_t45_last15_ret_bps=Math.max(-10,Math.min(10,e.t45_last15_ret_bps/vol.vol));
    }
  }
  return {ready:true,ticker:v1.ticker,open:new Date(open).toISOString(),v1,t45,eligibility,early:features,
    u_eligible:uEligible(eligibility.v1 as any,eligibility.t45 as any,eligibility.anyPriorClaim)};
}

/** Revalidate U eligibility at send time without rebuilding its model features.
 * Features are supplied only by the full reader before scoring; all mutable
 * eligibility and prior-claim checks are still read authoritatively here.
 */
export async function readV12UContext(sb: SupabaseClient, open: string) {
  const [snapshot,target,fallback] = await Promise.all([
    readV1Snapshot(sb,open),
    sb.from('c85_targets').select('ticker').eq('model_version','lite-a-floor4-top10-r1').eq('target_open_utc',open).maybeSingle(),
    sb.from('v11_decisions').select('ticker,run_mode,side,evidence,within_publication_ceiling').eq('target_ts',open).maybeSingle(),
  ]);
  if(target.error)throw target.error;if(fallback.error)throw fallback.error;
  if (!target.data || !snapshot.committed || snapshot.runMode !== 'LIVE')
    return {ready:false, reason:'V1_NOT_COMMITTED_LIVE'} as const;
  const early={ready:true as const,ticker:target.data.ticker,open:new Date(open).toISOString()};
  const t45=fallback.data;
  const eligibility={v1:{inputValid:snapshot.inputValid,reason:snapshot.reason,
    ordinaryFloorAllows:snapshot.ordinaryFloorOpen===true,finalSide:snapshot.finalSide},
    t45:{finalized:!!t45 && t45.run_mode==='LIVE_SHADOW' && t45.ticker===early.ticker &&
      t45.evidence?.trigger_signed===true && t45.within_publication_ceiling===true,finalSide:t45?.side},
    anyPriorClaim:snapshot.sendClaim!=='none'};
  return {...early,eligibility,u_eligible:uEligible(eligibility.v1 as any,eligibility.t45 as any,eligibility.anyPriorClaim)};
}
