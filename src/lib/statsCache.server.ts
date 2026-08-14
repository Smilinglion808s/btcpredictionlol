/**
 * Server-side read cache for expensive stats aggregates.
 *
 * Purpose: many viewers polling the stats page used to translate 1:1 into
 * heavy database aggregations, which saturated the connection pool and
 * starved the prediction writes. This helper collapses concurrent callers
 * into a single in-flight query (single-flight), serves a short-lived cached
 * value, and falls back to the last known good value when the database is
 * slow or erroring instead of cascading failures.
 *
 * It never touches model logic — read path only.
 */

type Entry = {
  value: unknown;
  at: number;
  inflight: Promise<unknown> | null;
};

const store = new Map<string, Entry>();

export const STATS_TTL_MS = 150_000;
/** Short TTL for "pending candle" reads that must stay near-live but still
 *  collapse many concurrent viewers into a single database round-trip. */
export const PENDING_TTL_MS = 12_000;
/** How long a stale value may still be served when the database misbehaves. */
const STALE_GRACE_MS = 10 * 60_000;

export async function cachedStats<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs: number = STATS_TTL_MS,
): Promise<T> {
  const now = Date.now();
  const entry = store.get(key);

  if (entry && entry.value !== undefined && now - entry.at < ttlMs) {
    return entry.value as T;
  }

  if (entry?.inflight) {
    try {
      return (await entry.inflight) as T;
    } catch {
      if (entry.value !== undefined && now - entry.at < STALE_GRACE_MS) return entry.value as T;
      throw new Error(`stats unavailable: ${key}`);
    }
  }

  const next: Entry = entry ?? { value: undefined, at: 0, inflight: null };
  store.set(key, next);

  const p = (async () => {
    const value = await loader();
    next.value = value;
    next.at = Date.now();
    return value;
  })();

  next.inflight = p;

  try {
    return (await p) as T;
  } catch (err) {
    if (next.value !== undefined && Date.now() - next.at < STALE_GRACE_MS) {
      console.error(`[statsCache] ${key} failed, serving stale value`, err);
      return next.value as T;
    }
    throw err;
  } finally {
    if (next.inflight === p) next.inflight = null;
  }
}

/** Drop a cached entry (used after visual resets so the UI updates at once). */
export function invalidateStats(key: string) {
  store.delete(key);
}
