// Deploy ONLY to the predictor backend alevdzyisibxcvwoyrqb.
// HALTED 2026-09-29 by owner request: V1.2 sends nothing to any receiver.
// To restore, bring back the previous entrypoint (createAdapterHandler from ./core.js).
Deno.serve(() => new Response(JSON.stringify({ error: 'V12_HALTED' }), {
  status: 503,
  headers: { 'content-type': 'application/json' },
}));
