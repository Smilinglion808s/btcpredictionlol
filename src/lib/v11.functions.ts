// Version 1.1 (combined V1 + T45 R2 fallback) — shadow dashboard data.
//
// Read-only. This model has no dispatch path of any kind.
//
// The underlying query reads with the service role, so the server itself must
// prove the caller is signed in BEFORE any cached or privileged read happens.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildV11Stats } from "./v11/statsQuery.server";
import { cachedStats } from "./statsCache.server";

// POST (not GET) on purpose: GET server-function responses can be cached by the
// CDN in front of the published site, which pinned this tile to an old snapshot.
export const getV11Stats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<Record<string, any>> => {
    return (await cachedStats("v11-stats", buildV11Stats, 5_000)) as Record<
      string,
      any
    >;
  });
