// Version 1.1 (combined V1 + T45 R2 fallback) — shadow dashboard data.
//
// Read-only. This model has no dispatch path of any kind.

import { createServerFn } from "@tanstack/react-start";
import { buildV11Stats } from "./v11/statsQuery.server";
import { cachedStats } from "./statsCache.server";

export const getV11Stats = createServerFn({ method: "GET" }).handler(
  async () => (await cachedStats("v11-stats", buildV11Stats, 15_000)) as Record<string, any>,
);
