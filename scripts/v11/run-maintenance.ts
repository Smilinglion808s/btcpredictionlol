// Bounded shadow maintenance runner (service-role, read/write to v11_* only).
import { createClient } from "@supabase/supabase-js";
import { runV11Maintenance } from "../../src/lib/v11/maintenance.server";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
console.log(JSON.stringify(await runV11Maintenance(sb as never, { recoverLimit: 24, kalshiLimit: 12 }), null, 2));
