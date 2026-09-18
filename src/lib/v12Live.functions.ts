// Current-interval V1.2 status for the dashboard tile.
//
// POST (not GET) so the CDN in front of the published site cannot pin the tile
// to an old snapshot. Read-only: it dispatches nothing and writes nothing.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildV12Live } from "./v12/live.server";
import { cachedStats } from "./statsCache.server";

// Signed-in dashboard readers only, like the other operator-facing reads. The
// bearer token is attached by the global client middleware in src/start.ts.
export const getV12Live = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<Record<string, any>> =>
    // 800 ms collapses concurrent viewers into one round trip while staying
    // well inside the ~1 s visible refresh the tile uses when a call is live.
    (await cachedStats("v12-live", () => buildV12Live(), 800)) as Record<string, any>,
);
