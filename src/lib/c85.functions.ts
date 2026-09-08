// C85 MULTI_META server functions — thin wrappers only.
//
// Every runtime helper lives in ./c85/statsQuery.server because the
// server-function splitter drops module-scope siblings from this file.
//
// The returns are cast to plain JSON because the payloads carry open-ended
// jsonb columns (feed_freshness, gate_reasons, features) that the serializer
// cannot narrow statically. Everything crossing the wire is already JSON.

import { createServerFn } from "@tanstack/react-start";
import { buildC85Stats, loadC85Pending } from "./c85/statsQuery.server";
import { PENDING_TTL_MS, cachedStats } from "./statsCache.server";

/** Worker readiness, decision counts and timing evidence. */
export const getC85Stats = createServerFn({ method: "GET" }).handler(
  async () => (await cachedStats("c85-stats", buildC85Stats, 30_000)) as Record<string, any>,
);

/** Newest C85 target row — its decision for the most recent boundary. */
export const getC85Pending = createServerFn({ method: "GET" }).handler(
  async () =>
    (await cachedStats("c85-pending", loadC85Pending, PENDING_TTL_MS)) as Record<
      string,
      any
    > | null,
);
