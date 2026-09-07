// C85 MULTI_META server functions — thin wrappers only.
//
// Every runtime helper lives in ./c85/statsQuery.server because the
// server-function splitter drops module-scope siblings from this file.

import { createServerFn } from "@tanstack/react-start";
import { buildC85Stats, loadC85Pending } from "./c85/statsQuery.server";
import { PENDING_TTL_MS, cachedStats } from "./statsCache.server";

/** Worker readiness, decision counts and timing evidence. */
export const getC85Stats = createServerFn({ method: "GET" }).handler(async () =>
  cachedStats("c85-stats", buildC85Stats, 30_000),
);

/** Newest C85 target row — its decision for the most recent boundary. */
export const getC85Pending = createServerFn({ method: "GET" }).handler(async () =>
  cachedStats("c85-pending", loadC85Pending, PENDING_TTL_MS),
);
