// T45 PriceFlow Q37.5 server functions — thin wrappers only.

import { createServerFn } from "@tanstack/react-start";
import {
  buildPriceFlowCsv,
  buildPriceFlowStats,
  loadPriceFlowPending,
} from "./t45pf/statsQuery.server";

/** Shadow performance, packet readiness and activation state. */
export const getPriceFlowStats = createServerFn({ method: "GET" }).handler(async () =>
  buildPriceFlowStats(),
);

/** Newest LIVE PriceFlow row — its decision for the pending candle. */
export const getPriceFlowPending = createServerFn({ method: "GET" }).handler(async () =>
  loadPriceFlowPending(),
);

/** Full-history CSV: every prediction-time feature, provenance and audit field. */
export const exportPriceFlowCsv = createServerFn({ method: "GET" }).handler(async () =>
  buildPriceFlowCsv(),
);
