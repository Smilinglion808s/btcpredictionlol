// One-off/operator backfill of the V3 Kalshi settlement cache using the same
// bounded server logic as the dashboard (12 per pass, pool of 3, monotonic RPC).
// Usage: bun scripts/v3/kalshi-backfill.ts   (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
import { createClient } from "@supabase/supabase-js";
import { refreshAndResolve } from "../../src/lib/v3/kalshi-grade";
import { supabaseGradeDeps } from "../../src/lib/v3/kalshi-cache.server";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data, error } = await sb.from("v3_decisions").select("candle_open,status,direction").limit(10000);
if (error) throw error;
const opens = (data ?? []).filter((r: any) => r.direction != null && (r.status === "SELECTED" || r.status === "EXPIRED_UNSENT"))
  .map((r: any) => Date.parse(r.candle_open));
const deps = supabaseGradeDeps(sb);
for (let pass = 0; pass < 40; pass++) {
  const g = await refreshAndResolve(opens, Date.now(), deps);
  console.log(`pass ${pass}: refreshed ${g.refreshed}, finalized ${g.outcomes.size}/${opens.length}, unavailable=${g.unavailable}`);
  if (g.unavailable || g.refreshed === 0) break;
}
