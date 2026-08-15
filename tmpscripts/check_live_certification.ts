import { createClient } from "@supabase/supabase-js";
import { buildEs1Replay } from "../src/lib/b4x4es1/orchestrator.server";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { rows } = await buildEs1Replay(sb as never, { force: true });
const byBoundary = new Map<number, string>();
for (const r of rows) if (r.resolvedFit) byBoundary.set(r.resolvedFit.fit.blockIndex, `${r.resolvedFit.source}/${r.resolvedFit.certified}`);
console.log([...byBoundary.entries()].sort((a,b)=>a[0]-b[0]).map(([b,s])=>`${b}:${s}`).join("  "));
const tail = rows.slice(-4);
for (const r of tail) console.log(r.targetTs, r.decision.decisionReason, r.decision.finalPrediction, r.resolvedFit?.source, "certified", r.resolvedFit?.certified, "state", r.decisionStateCertified);
