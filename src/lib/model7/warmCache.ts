// In-memory warm cache for Model 7 B2/B4.2 critical-path inputs.
//
// Populated by /api/public/hooks/prewarm-b4_2 shortly before each 15m boundary
// and consumed by runShadowForPrediction at score time. All cached data is
// strictly older than the target boundary — pre-warming can never leak the
// target candle. Fail-open: if the cache misses (cold start, worker recycle,
// pre-warm skipped), the shadow orchestrator falls back to live fetches.
//
// Scope: module-level Map, per-worker isolate. Not shared across workers.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Candle } from "./featurize";
import type { ModelFit } from "./scorer";
import { loadLatestVariantBFit } from "./fitStore";

const TF_MS = 15 * 60 * 1000;
const HISTORY_DEPTH_CANDLES = 24;
const ENTRY_TTL_MS = 90_000; // outlives one full candle cycle
const MAX_ENTRIES = 8;

export interface WarmedInputs {
  target_boundary_ms: number;
  warmed_at_ms: number;
  history: Candle[];
  variantBFit: ModelFit | null;
  variantBFitReason: "loaded" | "warming_up";
}

const cache = new Map<number, WarmedInputs>();

function gc(): void {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.warmed_at_ms > ENTRY_TTL_MS) cache.delete(k);
  }
  while (cache.size > MAX_ENTRIES) {
    // evict oldest by insertion order
    const first = cache.keys().next();
    if (first.done) break;
    cache.delete(first.value);
  }
}

/** Next 15m UTC boundary strictly after `nowMs`. */
export function nextBoundaryMs(nowMs: number): number {
  return Math.ceil((nowMs + 1) / TF_MS) * TF_MS;
}

async function fetchPriorCandles(
  supabase: SupabaseClient,
  boundaryIso: string,
): Promise<Candle[]> {
  const { data } = await supabase
    .from("candles")
    .select("candle_ts,open,high,low,close,volume")
    .eq("symbol", "BTC-USDT").eq("timeframe", "15m")
    .lt("candle_ts", boundaryIso)
    .order("candle_ts", { ascending: false })
    .limit(HISTORY_DEPTH_CANDLES);
  return (data ?? []).map((c) => ({
    candle_ts: c.candle_ts as string,
    open: Number(c.open), high: Number(c.high),
    low: Number(c.low), close: Number(c.close),
    volume: c.volume === null ? null : Number(c.volume),
  }));
}

/**
 * Pre-fetch history + latest Variant B fit for the given target boundary and
 * park them in the cache. Safe to call repeatedly; last write wins.
 */
export async function warmForBoundary(
  supabase: SupabaseClient,
  targetBoundaryMs: number,
  trainingModelVersion = "6.0",
): Promise<WarmedInputs> {
  gc();
  const boundaryIso = new Date(targetBoundaryMs).toISOString();
  const [history, variantBFit] = await Promise.all([
    fetchPriorCandles(supabase, boundaryIso),
    loadLatestVariantBFit(supabase, trainingModelVersion),
  ]);
  const entry: WarmedInputs = {
    target_boundary_ms: targetBoundaryMs,
    warmed_at_ms: Date.now(),
    history,
    variantBFit,
    variantBFitReason: variantBFit ? "loaded" : "warming_up",
  };
  cache.set(targetBoundaryMs, entry);
  return entry;
}

/** Return the warmed entry for a boundary and evict it. Null if none/expired. */
export function consumeWarmed(targetBoundaryMs: number): WarmedInputs | null {
  const entry = cache.get(targetBoundaryMs);
  if (!entry) return null;
  cache.delete(targetBoundaryMs);
  if (Date.now() - entry.warmed_at_ms > ENTRY_TTL_MS) return null;
  return entry;
}

/** Debug helper. */
export function warmCacheSize(): number {
  return cache.size;
}
