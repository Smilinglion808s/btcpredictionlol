// Manual cache-bust for the stats dashboard: drops every server-side stats
// aggregate so the next read hits the database directly.

import { createServerFn } from "@tanstack/react-start";
import { clearAllStats } from "./statsCache.server";

export const forceRefreshStats = createServerFn({ method: "POST" }).handler(async () => ({
  cleared: clearAllStats(),
  at: new Date().toISOString(),
}));
