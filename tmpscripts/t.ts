import { createClient } from "@supabase/supabase-js";
import { buildEs1Replay, runEs1ForTarget } from "../src/lib/b4x4es1/orchestrator.server";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {auth:{persistSession:false}});
const { rows } = await buildEs1Replay(sb, { force: true });
console.log("rows", rows.length, "tail", rows.slice(-4).map(r=>r.targetTs));
