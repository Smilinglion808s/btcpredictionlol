import { createClient } from "@supabase/supabase-js";
import { runV11Maintenance } from "@/lib/v11/maintenance.server";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const r = await runV11Maintenance(sb, { contextLimit: 50, labelLimit: 100, kalshiLimit: 3, recoverLimit: 5 });
console.log(JSON.stringify(r, null, 2));
