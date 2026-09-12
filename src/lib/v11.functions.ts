// Version 1.1 (combined V1 + T45 R2 fallback) — shadow dashboard data.
//
// Read-only. This model has no dispatch path of any kind.
//
// Returns the same aggregate-only public statistics as the other model tiles.
// No private rows, endpoints, payloads or secrets leave buildV11Stats.

import { createServerFn } from "@tanstack/react-start";
import { buildV11Stats } from "./v11/statsQuery.server";
import { cachedStats } from "./statsCache.server";

// POST (not GET) on purpose: GET server-function responses can be cached by the
// CDN in front of the published site, which pinned this tile to an old snapshot.
export const getV11Stats = createServerFn({ method: "POST" })
  .handler(async (): Promise<Record<string, any>> => {
    return (await cachedStats("v11-stats", buildV11Stats, 5_000)) as Record<
      string,
      any
    >;
  });
