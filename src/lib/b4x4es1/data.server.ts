// Canonical input loaders for B4x4-ES1. Read-only: nothing here writes to any
// existing model's tables.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ES1_A2_SOURCE_VARIANT,
  ES1_EXCHANGE,
  ES1_SYMBOL,
  ES1_TIMEFRAME,
  ES1_TRAINING_SOURCE_EPOCH_TS,
} from "./config";
import type { CanonicalCandle } from "./features";
import type { ObSnapshot } from "./engine";
import type { A2Row } from "./replay";

type DbRow = Record<string, unknown>;

async function pageAll(
  build: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  page = 1000,
): Promise<DbRow[]> {
  const out: DbRow[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await build(from, from + page - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as DbRow[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

/** Confirmed OKX BTC-USDT 15m candles since the ES1 training epoch. */
export async function loadCanonicalCandles(
  supabase: SupabaseClient,
  opts: { upTo?: string } = {},
): Promise<CanonicalCandle[]> {
  const rows = await pageAll((from, to) => {
    let q = supabase
      .from("candles")
      .select("candle_ts, open, high, low, close, volume")
      .eq("symbol", ES1_SYMBOL)
      .eq("timeframe", ES1_TIMEFRAME)
      .eq("fetch_source", ES1_EXCHANGE)
      .eq("confirm", true)
      .gte("candle_ts", ES1_TRAINING_SOURCE_EPOCH_TS)
      .order("candle_ts", { ascending: true })
      .range(from, to);
    if (opts.upTo) q = q.lte("candle_ts", opts.upTo);
    return q;
  });

  const byTs = new Map<string, CanonicalCandle>();
  for (const r of rows) {
    const ts = new Date(String(r.candle_ts)).toISOString();
    const open = Number(r.open);
    const high = Number(r.high);
    const low = Number(r.low);
    const close = Number(r.close);
    if (![open, high, low, close].every((n) => Number.isFinite(n) && n > 0)) continue;
    byTs.set(ts, {
      candleTs: ts,
      open,
      high,
      low,
      close,
      volume: r.volume == null ? null : Number(r.volume),
    });
  }
  return [...byTs.values()].sort((a, b) => a.candleTs.localeCompare(b.candleTs));
}

/** A2_Combined prediction-time probabilities, keyed by target candle. */
export async function loadA2Rows(
  supabase: SupabaseClient,
  opts: { upTo?: string } = {},
): Promise<Map<string, A2Row>> {
  const rows = await pageAll((from, to) => {
    let q = supabase
      .from("model7_shadow")
      .select(
        "id, prediction_id, candle_ts, probability_green, timing_status, leakage_check_passed, model_fit_id, created_at",
      )
      .eq("variant", ES1_A2_SOURCE_VARIANT)
      .order("candle_ts", { ascending: true })
      .range(from, to);
    if (opts.upTo) q = q.lte("candle_ts", opts.upTo);
    return q;
  });

  const byTs = new Map<string, A2Row>();
  const createdAt = new Map<string, string>();
  for (const r of rows) {
    if (r.timing_status !== "ON_TIME") continue;
    if (r.leakage_check_passed !== true) continue;
    const p = r.probability_green == null ? NaN : Number(r.probability_green);
    if (!Number.isFinite(p) || p < 0 || p > 1) continue;
    const ts = new Date(String(r.candle_ts)).toISOString();
    const created = String(r.created_at ?? "");
    if (byTs.has(ts) && created < (createdAt.get(ts) ?? "")) continue;
    createdAt.set(ts, created);
    byTs.set(ts, {
      targetTs: ts,
      probabilityGreen: p,
      rowId: (r.id as string | null) ?? null,
      predictionId: (r.prediction_id as string | null) ?? null,
      modelFitId: (r.model_fit_id as string | null) ?? null,
      productionModelVersion: null,
    });
  }
  return byTs;
}

/** Pre-boundary order-book snapshots, keyed by target candle. */
export async function loadObSnapshots(
  supabase: SupabaseClient,
  opts: { upTo?: string } = {},
): Promise<Map<string, ObSnapshot>> {
  const rows = await pageAll((from, to) => {
    let q = supabase
      .from("b4x4_shadow_market_data")
      .select(
        "target_candle_ts, snapshot_event_ts, snapshot_received_at, capture_status, book_complete, depth_imbalance_10bps",
      )
      .order("target_candle_ts", { ascending: true })
      .range(from, to);
    if (opts.upTo) q = q.lte("target_candle_ts", opts.upTo);
    return q;
  });

  const byTs = new Map<string, ObSnapshot>();
  for (const r of rows) {
    const ts = new Date(String(r.target_candle_ts)).toISOString();
    const depth = r.depth_imbalance_10bps == null ? null : Number(r.depth_imbalance_10bps);
    const snapshotTs =
      (r.snapshot_event_ts as string | null) ?? (r.snapshot_received_at as string | null) ?? null;
    byTs.set(ts, {
      targetTs: ts,
      snapshotTs: snapshotTs ? new Date(snapshotTs).toISOString() : null,
      captureStatus: (r.capture_status as string | null) ?? null,
      bookComplete: (r.book_complete as boolean | null) ?? null,
      depthImbalance10bps: depth != null && Number.isFinite(depth) ? depth : null,
    });
  }
  return byTs;
}

export interface Es1Inputs {
  candles: CanonicalCandle[];
  a2: Map<string, A2Row>;
  ob: Map<string, ObSnapshot>;
}

export async function loadEs1Inputs(
  supabase: SupabaseClient,
  opts: { upTo?: string } = {},
): Promise<Es1Inputs> {
  const [candles, a2, ob] = await Promise.all([
    loadCanonicalCandles(supabase, opts),
    loadA2Rows(supabase, opts),
    loadObSnapshots(supabase, opts),
  ]);
  return { candles, a2, ob };
}
