// V6 admin server functions. Thin wrappers only — logic lives in v6-admin.server.ts.

import { createServerFn } from "@tanstack/react-start";

export const initV6Warmup = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { initV6WarmupServer } = await import("./v6-admin.server");
  return initV6WarmupServer(supabaseAdmin);
});

export const runV6AtBoundary = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { runV6AtBoundaryServer } = await import("./v6-admin.server");
  return runV6AtBoundaryServer(supabaseAdmin);
});
