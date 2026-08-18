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

/** Drop every cached aggregate (manual "force fresh data" from the stats page). */
export function clearAllStats(): number {
  const n = store.size;
  store.clear();
  rowStore.clear();
  return n;
}

/* ------------------------------------------------------------------ *
 * Incremental row cache
 *
 * The stats aggregates used to re-read an entire history table (tens of
 * thousands of wide rows) on every cache miss, which dominated the
 * project's disk-IO budget. Rows older than the overlap window are
 * immutable (they are fully resolved), so we keep them in memory and
 * only re-read the recent tail plus anything newer.
 *
 * This is a read-path optimisation only: the merged row set is identical
 * to what a full scan would return, so no model or aggregate output
 * changes.
 * ------------------------------------------------------------------ */

type RowEntry = {
  rows: Map<string, Record<string, unknown>>;
  maxTs: string | null;
  builtAt: number;
};

const rowStore = new Map<string, RowEntry>();

/** How far back the tail re-read reaches (covers late resolutions). */
const DEFAULT_OVERLAP_MS = 36 * 60 * 60_000;
/** Periodic full rebuild so deletes/backfills can never go unnoticed. */
const DEFAULT_FULL_REBUILD_MS = 30 * 60_000;

export interface IncrementalRowsOptions<T> {
  /** Column holding the row timestamp used for the incremental cursor. */
  tsKey: string;
  /** Stable row identity; defaults to the timestamp value. */
  keyFn?: (row: T) => string;
  /** Sort direction of the returned array. Defaults to ascending. */
  desc?: boolean;
  overlapMs?: number;
  fullRebuildMs?: number;
}

export async function incrementalRows<T extends Record<string, unknown>>(
  cacheKey: string,
  /** Fetch rows with `tsKey` strictly greater than `sinceIso` (null = all). */
  fetchRows: (sinceIso: string | null) => Promise<T[]>,
  opts: IncrementalRowsOptions<T>,
): Promise<T[]> {
  const {
    tsKey,
    keyFn = (r: T) => String(r[tsKey] ?? ""),
    desc = false,
    overlapMs = DEFAULT_OVERLAP_MS,
    fullRebuildMs = DEFAULT_FULL_REBUILD_MS,
  } = opts;

  const now = Date.now();
  let entry = rowStore.get(cacheKey);
  const stale = !entry || now - entry.builtAt > fullRebuildMs || entry.maxTs == null;

  let since: string | null = null;
  if (!stale && entry?.maxTs) {
    const cursor = Date.parse(entry.maxTs) - overlapMs;
    since = Number.isFinite(cursor) ? new Date(cursor).toISOString() : null;
  }
  if (stale) entry = undefined;

  const fetched = await fetchRows(since);

  const rows = entry ? entry.rows : new Map<string, Record<string, unknown>>();
  let maxTs = entry?.maxTs ?? null;
  for (const r of fetched) {
    rows.set(keyFn(r), r);
    const ts = String(r[tsKey] ?? "");
    if (ts && (maxTs == null || ts > maxTs)) maxTs = ts;
  }

  rowStore.set(cacheKey, { rows, maxTs, builtAt: entry ? entry.builtAt : now });

  const out = Array.from(rows.values()) as T[];
  out.sort((a, b) => {
    const x = String(a[tsKey] ?? "");
    const y = String(b[tsKey] ?? "");
    return desc ? (y > x ? 1 : y < x ? -1 : 0) : x > y ? 1 : x < y ? -1 : 0;
  });
  return out;
}

