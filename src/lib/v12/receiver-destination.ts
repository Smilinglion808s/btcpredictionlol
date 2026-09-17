// Secret lookup accepts the existing receiver's documented region hint only.
// Actual recording destinations remain fixed and never use this saved URL.
export const V12_RECEIVER_BASE='https://ruxndqfjfdbtdbkheuge.supabase.co/functions/v1/';
export function isAuthorizedBettingEndpoint(value:unknown):boolean {
  if(typeof value!=='string')return false;
  try {
    const url=new URL(value),expected=new URL(V12_RECEIVER_BASE+'place-trade');
    if(url.origin!==expected.origin || url.pathname!==expected.pathname || url.username || url.password || url.hash)return false;
    const params=[...url.searchParams];
    return params.length===0 || (params.length===1 && params[0][0]==='forceFunctionRegion' && params[0][1]==='us-west-1');
  } catch {return false;}
}
