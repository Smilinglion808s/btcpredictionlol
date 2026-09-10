// Version 1 (`lite-a-floor4-top10-r1`) server function — thin wrapper only.
//
// The runtime helper lives in ./litea/statsQuery.server because the
// server-function splitter drops module-scope siblings from this file.

import { createServerFn } from "@tanstack/react-start";
import { buildLiteAStats } from "./litea/statsQuery.server";
import { cachedStats } from "./statsCache.server";

/** Version 1 connection, freshness and forward shadow counts. */
export const getLiteAStats = createServerFn({ method: "GET" }).handler(
  async () => (await cachedStats("litea-stats", buildLiteAStats, 15_000)) as Record<string, any>,
);
