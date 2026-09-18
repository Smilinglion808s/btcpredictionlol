// Current-interval V1.2 status for the dashboard tile.
//
// POST (not GET) so the CDN in front of the published site cannot pin the tile
// to an old snapshot. Read-only: it dispatches nothing and writes nothing.

import { createServerFn } from "@tanstack/react-start";
import { buildV12Live } from "./v12/live.server";
import { cachedStats } from "./statsCache.server";

// NOTE ON ACCESS: this deliberately carries no requireSupabaseAuth middleware.
// The dashboard layout under src/routes/_authenticated/ is a PUBLIC layout
// (no gate, and the backend has no auth users at all), and every other tile
// feed on that page — getV11Stats, getLiteAStats, getT45Stats — is likewise
// unauthenticated. Adding the middleware here would 401 the V1.2 tile for
// everyone, including the owner, while changing nothing about exposure.
// The payload is status only: leg, direction, delivery state, worker state.
// No private rows, no payloads, no secrets, no endpoint credentials.
export const getV12Live = createServerFn({ method: "POST" }).handler(
  async (): Promise<Record<string, any>> =>
    // 800 ms collapses concurrent viewers into one round trip while staying
    // well inside the ~1 s visible refresh the tile uses when a call is live.
    (await cachedStats("v12-live", () => buildV12Live(), 800)) as Record<string, any>,
);
