// T30 PriceFlow Balanced server functions — thin wrappers only.
//
// Every runtime helper lives in ./t30/statsQuery.server because the
// server-function splitter drops module-scope siblings from this file.

import { createServerFn } from "@tanstack/react-start";
import { buildT30Csv, buildT30Stats, loadT30Pending } from "./t30/statsQuery.server";
import { PENDING_TTL_MS, cachedStats } from "./statsCache.server";

/** Shadow performance, packet readiness, gates and activation state. */
export const getT30Stats = createServerFn({ method: "GET" }).handler(async () =>
  cachedStats("t30-stats", buildT30Stats, 30_000),
);

/** Newest LIVE T30 row — its decision for the pending candle. */
export const getT30Pending = createServerFn({ method: "GET" }).handler(async () =>
  cachedStats("t30-pending", loadT30Pending, PENDING_TTL_MS),
);

/** Full-history CSV: audit fields plus every frozen prediction-time feature. */
export const exportT30Csv = createServerFn({ method: "GET" }).handler(async () =>
  buildT30Csv(),
);
