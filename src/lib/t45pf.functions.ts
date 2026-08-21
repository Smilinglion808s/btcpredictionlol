// T45 PriceFlow Q37.5 server functions — thin wrappers only.

import { createServerFn } from "@tanstack/react-start";
import {
  buildPriceFlowCsv,
  buildPriceFlowStats,
  loadPriceFlowPending,
} from "./t45pf/statsQuery.server";
import { PENDING_TTL_MS, cachedStats } from "./statsCache.server";

/** Shadow performance, packet readiness and activation state. */
export const getPriceFlowStats = createServerFn({ method: "GET" }).handler(async () =>
  cachedStats("t45pf-stats", buildPriceFlowStats, 30_000),
);

/** Newest LIVE PriceFlow row — its decision for the pending candle. */
export const getPriceFlowPending = createServerFn({ method: "GET" }).handler(async () =>
  cachedStats("t45pf-pending", loadPriceFlowPending, PENDING_TTL_MS),
);

/** Full-history CSV: every prediction-time feature, provenance and audit field. */
export const exportPriceFlowCsv = createServerFn({ method: "GET" }).handler(async () =>
  buildPriceFlowCsv(),
);
