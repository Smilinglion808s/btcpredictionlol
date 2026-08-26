// T10 Bridge — persistence layer (server only).
//
// Writes ONLY to t10_* tables. It never reads or mutates T30, T45, ES1, B4x4,
// A2, TD1 or V6 storage. The single shared read is `public.candles`, the
// confirmed OKX outcome source, which is read-only here.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  T10_ACTIVATION_KEY,
  T10_ACTIVATION_TABLE,
  T10_BRIDGE_VERSION,
  T10_COLLECTOR_VERSION,
  T10_FITS_TABLE,
  T10_HEALTH_TABLE,
  T10_LONG_RANK_WINDOW,
  T10_PREDICTIONS_TABLE,
  T10_SAMPLES_TABLE,
  T10_TRAINING_LOOKBACK,
  t10SourceIndex,
} from "./config";
import type { T10PriorProbability, T10TrainingRow } from "./head";
import type { T10SecondBar } from "./packet";

type Row = Record<string, unknown>;

/** PostgREST caps a response at 1,000 rows, so every window read is paged. */
const PAGE = 1000;

export async function readT10Activation(sb: SupabaseClient): Promise<Row> {
  const { data } = await sb
    .from(T10_ACTIVATION_TABLE)
    .select("*")
    .eq("singleton_key", T10_ACTIVATION_KEY)
    .maybeSingle();
  return (data ?? { mode: "SHADOW_ONLY", webhooks_enabled: false }) as Row;
}

export async function upsertT10Samples(
  sb: SupabaseClient,
  rows: readonly Row[],
): Promise<number> {
  if (!rows.length) return 0;
  let stored = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await sb
      .from(T10_SAMPLES_TABLE)
      .upsert(chunk as never, { onConflict: "target_ts,offset_seconds,collector_version" });
    if (error) throw new Error(`t10_sample_upsert:${error.message}`);
    stored += chunk.length;
  }
  return stored;
}

export async function upsertT10Health(sb: SupabaseClient, row: Row): Promise<void> {
  try {
    await sb
      .from(T10_HEALTH_TABLE)
      .upsert({ ...row, updated_at: new Date().toISOString() } as never, {
        onConflict: "stream_key",
      });
  } catch {
    /* health must never block ingest */
  }
}

/** Offsets 0..9 for one target, exactly as persisted. Never widened. */
export async function loadT10Bars(
  sb: SupabaseClient,
  targetTs: string,
): Promise<T10SecondBar[]> {
  const { data, error } = await sb
    .from(T10_SAMPLES_TABLE)
    .select(
      "offset_seconds, open, high, low, close, volume, quote_volume, trade_count, taker_buy_quote_volume, is_final",
    )
    .eq("target_ts", targetTs)
    .eq("collector_version", T10_COLLECTOR_VERSION)
    .order("offset_seconds", { ascending: true });
  if (error) throw new Error(`t10_bar_load:${error.message}`);
  return ((data ?? []) as Row[]).map((r) => ({
    offset_seconds: Number(r.offset_seconds),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
    quote_volume: Number(r.quote_volume),
    trade_count: Number(r.trade_count),
    taker_buy_quote_volume: Number(r.taker_buy_quote_volume),
    is_final: r.is_final !== false,
  }));
}

export async function readT10Fit(sb: SupabaseClient, fitId: string): Promise<Row | null> {
  const { data } = await sb.from(T10_FITS_TABLE).select("*").eq("fit_id", fitId).maybeSingle();
  return (data as Row | null) ?? null;
}

export async function insertT10Fit(sb: SupabaseClient, row: Row): Promise<void> {
  const { error } = await sb
    .from(T10_FITS_TABLE)
    .upsert(row as never, { onConflict: "fit_id", ignoreDuplicates: true });
  if (error) throw new Error(`t10_fit_upsert:${error.message}`);
}

/**
 * Correctness-labelled training rows with absolute source index in
 * [blockStart - 8640, blockStart). Paged: an unpaged read silently truncates
 * the window at 1,000 rows.
 */
export async function loadT10TrainingRows(
  sb: SupabaseClient,
  blockStart: number,
): Promise<T10TrainingRow[]> {
  const lo = Math.max(0, blockStart - T10_TRAINING_LOOKBACK);
  const hi = blockStart - 1;
  if (hi < lo) return [];
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from(T10_PREDICTIONS_TABLE)
      .select("target_ts, source_index, feature_vector, base_direction, actual_direction")
      .eq("model_version", T10_BRIDGE_VERSION)
      .gte("source_index", lo)
      .lte("source_index", hi)
      .not("feature_vector", "is", null)
      .not("actual_direction", "is", null)
      .order("source_index", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`t10_training_load:${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const out: T10TrainingRow[] = [];
  const seen = new Set<number>();
  for (const r of rows) {
    const index = Number(r.source_index);
    if (seen.has(index)) continue;
    const vector = r.feature_vector as number[] | null;
    if (!Array.isArray(vector) || vector.some((v) => !Number.isFinite(Number(v)))) continue;
    const base = String(r.base_direction ?? "");
    const actual = String(r.actual_direction ?? "");
    if (base !== "GREEN" && base !== "RED") continue;
    // Exact-source parity: flat/PUSH rows keep their historical label.
    const label: 0 | 1 = base === actual ? 1 : 0;
    seen.add(index);
    out.push({
      targetTs: new Date(String(r.target_ts)).toISOString(),
      index,
      vector: vector.map(Number),
      label,
    });
  }
  return out;
}

/**
 * Strictly past-only certified probabilities, oldest→newest, for the rank
 * windows. The current target is excluded by the `lt` filter, never by
 * slicing, and operational gaps are never compressed away — rows simply do not
 * exist for skipped targets, so a short window fails closed upstream.
 */
export async function loadT10PriorProbabilities(
  sb: SupabaseClient,
  targetTs: string,
): Promise<T10PriorProbability[]> {
  const NEED = T10_LONG_RANK_WINDOW;
  const rows: Row[] = [];
  for (let from = 0; from < NEED; from += PAGE) {
    const to = Math.min(from + PAGE, NEED) - 1;
    const { data, error } = await sb
      .from(T10_PREDICTIONS_TABLE)
      .select("target_ts, correctness_probability")
      .eq("model_version", T10_BRIDGE_VERSION)
      .eq("fit_certified", true)
      .not("correctness_probability", "is", null)
      .lt("target_ts", targetTs)
      .order("target_ts", { ascending: false })
      .range(from, to);
    if (error) throw new Error(`t10_rank_history:${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < to - from + 1) break;
  }
  const byTarget = new Map<string, T10PriorProbability>();
  for (const r of rows) {
    const probability = Number(r.correctness_probability);
    if (!Number.isFinite(probability)) continue;
    const ts = new Date(String(r.target_ts)).toISOString();
    if (!byTarget.has(ts)) byTarget.set(ts, { targetTs: ts, probability });
  }
  return [...byTarget.values()]
    .sort((a, b) => a.targetTs.localeCompare(b.targetTs))
    .slice(-T10_LONG_RANK_WINDOW);
}

export async function upsertT10Prediction(sb: SupabaseClient, row: Row): Promise<void> {
  const { error } = await sb
    .from(T10_PREDICTIONS_TABLE)
    .upsert(row as never, { onConflict: "model_version,target_ts" });
  if (error) throw new Error(`t10_prediction_upsert:${error.message}`);
}

export async function readT10Prediction(
  sb: SupabaseClient,
  targetTs: string,
): Promise<Row | null> {
  const { data } = await sb
    .from(T10_PREDICTIONS_TABLE)
    .select("*")
    .eq("model_version", T10_BRIDGE_VERSION)
    .eq("target_ts", targetTs)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

export interface T10ConfirmedCandle {
  candleTs: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Confirmed OKX 15m candles — the only outcome source T10 may use. */
export async function loadConfirmedCandles(
  sb: SupabaseClient,
  fromTs: string,
  toTs: string,
): Promise<Map<string, T10ConfirmedCandle>> {
  const out = new Map<string, T10ConfirmedCandle>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb
      .from("candles")
      .select("candle_ts, open, high, low, close")
      .eq("symbol", "BTC-USDT")
      .eq("timeframe", "15m")
      .eq("confirm", true)
      .gte("candle_ts", fromTs)
      .lte("candle_ts", toTs)
      .order("candle_ts", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`t10_candle_load:${error.message}`);
    const rows = (data ?? []) as Row[];
    for (const r of rows) {
      const ts = new Date(String(r.candle_ts)).toISOString();
      out.set(ts, {
        candleTs: ts,
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Idempotent resolution: only resolution/audit fields are ever written. */
export async function resolveT10Row(
  sb: SupabaseClient,
  targetTs: string,
  patch: Row,
): Promise<void> {
  const { error } = await sb
    .from(T10_PREDICTIONS_TABLE)
    .update(patch as never)
    .eq("model_version", T10_BRIDGE_VERSION)
    .eq("target_ts", targetTs)
    .is("resolved_at", null);
  if (error) throw new Error(`t10_resolve:${error.message}`);
}

export { t10SourceIndex };
