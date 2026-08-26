// T10 Bridge R1 server functions — thin wrappers only.
//
// Every runtime helper lives in ./t10/statsQuery.server because the
// server-function splitter drops module-scope siblings from this file.

import { createServerFn } from "@tanstack/react-start";
import { buildT10Stats, loadT10Pending } from "./t10/statsQuery.server";
import { PENDING_TTL_MS, cachedStats } from "./statsCache.server";

/** Shadow performance, packet readiness and activation state. */
export const getT10Stats = createServerFn({ method: "GET" }).handler(async () =>
  cachedStats("t10-stats", buildT10Stats, 30_000),
);

/** Newest LIVE T10 row — its decision for the pending candle. */
export const getT10Pending = createServerFn({ method: "GET" }).handler(async () =>
  cachedStats("t10-pending", loadT10Pending, PENDING_TTL_MS),
);
