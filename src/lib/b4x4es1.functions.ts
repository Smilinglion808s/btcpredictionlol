// B4x4-ES1 server functions: dashboard stats, pending row, CSV export.
//
// Thin wrapper only — all runtime helpers live in ./b4x4es1/statsQuery.server
// because the server-function splitter drops module-scope siblings here.

import { createServerFn } from "@tanstack/react-start";
import { cachedStats, PENDING_TTL_MS } from "./statsCache.server";
import { buildEs1Csv, buildEs1Stats, loadEs1Pending } from "./b4x4es1/statsQuery.server";

/** Live forward-test performance for the active ES1 model. */
export const getEs1Stats = createServerFn({ method: "GET" }).handler(async () =>
  cachedStats("b4x4-es1-stats", buildEs1Stats),
);

/** Most recent ES1 row — its decision for the pending candle. */
export const getEs1Pending = createServerFn({ method: "GET" }).handler(async () =>
  // Near-live TTL: the pending decision must surface within seconds of the
  // boundary run, not on the 150s stats cadence.
  cachedStats("b4x4-es1-pending", loadEs1Pending, Math.min(PENDING_TTL_MS, 5_000)),
);

/** Full ES1 CSV export — every tracked column plus explicit outcome flags. */
export const exportEs1Csv = createServerFn({ method: "GET" }).handler(async () => buildEs1Csv());
