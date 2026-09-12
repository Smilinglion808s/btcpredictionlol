// Version 1.1 (combined V1 + T45 R2 fallback) — shadow dashboard data.
//
// Read-only. This model has no dispatch path of any kind.
//
// The underlying query reads with the service role, so the server itself must
// prove the caller is signed in BEFORE any cached or privileged read happens.
// The client-side bearer attacher only ATTACHES a token; it validates nothing.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildV11Stats } from "./v11/statsQuery.server";
import { cachedStats } from "./statsCache.server";

export const getV11Stats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async () =>
      (await cachedStats("v11-stats", buildV11Stats, 15_000)) as Record<string, any>,
  );
