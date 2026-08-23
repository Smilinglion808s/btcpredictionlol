// T30 PriceFlow — persistence layer (server only).
//
// Writes ONLY to t30_* tables. It never reads or mutates any T45, ES1, B4x4,
// A2, TD1 or V6 storage. The single shared read is `public.candles`, the
// confirmed OKX outcome source, which is read-only here.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  T30_ACTIVATION_KEY,
  T30_ACTIVATION_TABLE,
  T30_COLLECTOR_VERSION,
  T30_FEATURES_TABLE,
  T30_FEATURE_SCHEMA,
  T30_FITS_TABLE,
  T30_LONG_RANK_WINDOW,
  T30_MAX_TRAINING_LOOKBACK,
  T30_MODEL_VERSION,
  T30_PREDICTIONS_TABLE,
  T30_SAMPLES_TABLE,
  T30_SHADOWS_TABLE,
} from "./config";
import type { T30SecondBar } from "./features";
import type { T30PriorConfidence, T30TrainingRow } from "./head";
import type { T30SampleRow } from "./ingest";

type Row = Record<string, unknown>;

/** PostgREST caps a response at 1,000 rows, so every window read is paged. */
const PAGE = 1000;

export async function readT30Activation(sb: SupabaseClient): Promise<Row> {
  const { data } = await sb
    .from(T30_ACTIVATION_TABLE)
    .select("*")
    .eq("singleton_key", T30_ACTIVATION_KEY)
    .maybeSingle();
  return (data ?? { mode: "SHADOW_ONLY", webhooks_enabled: false }) as Row;
}

export async function upsertT30Samples(
  sb: SupabaseClient,
  rows: readonly T30SampleRow[],
): Promise<number> {
  if (!rows.length) return 0;
  let stored = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await sb
      .from(T30_SAMPLES_TABLE)
      .upsert(chunk as never, { onConflict: "target_ts,offset_seconds,collector_version" });
    if (error) throw new Error(`t30_sample_upsert:${error.message}`);
    stored += chunk.length;
  }
  return stored;
}

export async function upsertT30Health(sb: SupabaseClient, row: Row): Promise<void> {
  try {
    await sb
      .from("t30_collector_health")
      .upsert({ ...row, updated_at: new Date().toISOString() } as never, {
        onConflict: "stream_key",
      });
  } catch {
    /* health must never block ingest */
  }
}

export async function loadT30Bars(
  sb: SupabaseClient,
  targetTs: string,
): Promise<T30SecondBar[]> {
  const { data, error } = await sb
    .from(T30_SAMPLES_TABLE)
    .select(
      "offset_seconds, open, high, low, close, volume, quote_volume, trade_count, taker_buy_quote_volume",
    )
    .eq("target_ts", targetTs)
    .eq("collector_version", T30_COLLECTOR_VERSION)
    .order("offset_seconds", { ascending: true });
  if (error) throw new Error(`t30_bar_load:${error.message}`);
  return ((data ?? []) as Row[]).map((r) => ({
    offsetSeconds: Number(r.offset_seconds),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
    quoteVolume: Number(r.quote_volume),
    tradeCount: Number(r.trade_count),
    takerBuyQuoteVolume: Number(r.taker_buy_quote_volume),
  }));
}

export async function upsertT30Features(sb: SupabaseClient, row: Row): Promise<void> {
  const { error } = await sb
    .from(T30_FEATURES_TABLE)
    .upsert(row as never, { onConflict: "target_ts,feature_version" });
  if (error) throw new Error(`t30_feature_upsert:${error.message}`);
}

export async function upsertT30FeatureBatch(
  sb: SupabaseClient,
  rows: readonly Row[],
): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += 96) {
    const chunk = rows.slice(i, i + 96);
    let lastErr = "";
    let ok = false;
    for (let attempt = 0; attempt < 5 && !ok; attempt++) {
      const { error } = await sb
        .from(T30_FEATURES_TABLE)
        .upsert(chunk as never, { onConflict: "target_ts,feature_version" });
      if (!error) {
        ok = true;
        break;
      }
      lastErr = error.message;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
    if (!ok) throw new Error(`t30_feature_batch:${lastErr}`);
    n += chunk.length;
  }
  return n;
}


/** Absolute walk-forward index: feature rows strictly before `targetTs`. */
export async function t30RowIndex(sb: SupabaseClient, targetTs: string): Promise<number> {
  const { count, error } = await sb
    .from(T30_FEATURES_TABLE)
    .select("target_ts", { count: "exact", head: true })
    .eq("feature_version", T30_FEATURE_SCHEMA)
    .lt("target_ts", targetTs);
  if (error) throw new Error(`t30_row_index:${error.message}`);
  return count ?? 0;
}

/**
 * Labelled training rows in absolute index range [blockStart-8640, blockStart).
 * Paged: an unpaged read silently truncates the window at 1,000 rows and makes
 * every fit fail the minimum-rows gate.
 */
export async function loadT30TrainingRows(
  sb: SupabaseClient,
  blockStart: number,
): Promise<T30TrainingRow[]> {
  const lo = Math.max(0, blockStart - T30_MAX_TRAINING_LOOKBACK);
  const hi = blockStart - 1;
  if (hi < lo) return [];
  const rows: Row[] = [];
  for (let from = lo; from <= hi; from += PAGE) {
    const to = Math.min(hi, from + PAGE - 1);
    const { data, error } = await sb
      .from(T30_FEATURES_TABLE)
      .select("target_ts, feature_complete, vector, label")
      .eq("feature_version", T30_FEATURE_SCHEMA)
      .order("target_ts", { ascending: true })
      .range(from, to);
    if (error) throw new Error(`t30_training_load:${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < to - from + 1) break;
  }

  const out: T30TrainingRow[] = [];
  rows.forEach((r, i) => {
    const label = Number(r.label);
    if (r.feature_complete !== true) return;
    if (!Number.isFinite(label) || label === 0) return;
    const vector = r.vector as number[] | null;
    if (!Array.isArray(vector) || vector.some((v) => !Number.isFinite(Number(v)))) return;
    out.push({
      targetTs: new Date(String(r.target_ts)).toISOString(),
      index: lo + i,
      vector: vector.map(Number),
      label,
    });
  });
  return out;
}

export async function readT30Fit(sb: SupabaseClient, fitId: string): Promise<Row | null> {
  const { data } = await sb.from(T30_FITS_TABLE).select("*").eq("fit_id", fitId).maybeSingle();
  return (data as Row | null) ?? null;
}

export async function insertT30Fit(sb: SupabaseClient, row: Row): Promise<void> {
  const { error } = await sb
    .from(T30_FITS_TABLE)
    .upsert(row as never, { onConflict: "fit_id", ignoreDuplicates: true });
  if (error) throw new Error(`t30_fit_upsert:${error.message}`);
}

/**
 * Strictly past-only confidences, oldest→newest, for the rank windows.
 * The current target is excluded by the `lt` filter, never by slicing.
 *
 * Run-mode agnostic (the T45 convention): BACKFILL rows are the deterministic
 * replay of the same frozen head over the same certified fit chain, so the
 * rank window is continuous across the backfill→live handoff instead of
 * restarting a 768-candle warm-up at go-live. When both a LIVE and a BACKFILL
 * row exist for one target, LIVE wins.
 */
export async function loadT30PriorConfidences(
  sb: SupabaseClient,
  targetTs: string,
  runMode = "LIVE",
): Promise<T30PriorConfidence[]> {
  const { data, error } = await sb
    .from(T30_PREDICTIONS_TABLE)
    .select("target_ts, run_mode, confidence")
    .eq("model_version", T30_MODEL_VERSION)
    .not("confidence", "is", null)
    .lt("target_ts", targetTs)
    .order("target_ts", { ascending: false })
    .limit(T30_LONG_RANK_WINDOW * 2);
  if (error) throw new Error(`t30_rank_history:${error.message}`);
  const byTarget = new Map<string, { targetTs: string; confidence: number; live: boolean }>();
  for (const r of (data ?? []) as Row[]) {
    const confidence = Number(r.confidence);
    if (!Number.isFinite(confidence)) continue;
    const ts = new Date(String(r.target_ts)).toISOString();
    const live = String(r.run_mode) === runMode;
    const existing = byTarget.get(ts);
    if (!existing || (live && !existing.live)) byTarget.set(ts, { targetTs: ts, confidence, live });
  }
  return [...byTarget.values()]
    .sort((a, b) => a.targetTs.localeCompare(b.targetTs))
    .slice(-T30_LONG_RANK_WINDOW)
    .map(({ targetTs: ts, confidence }) => ({ targetTs: ts, confidence }));
}


export async function upsertT30Prediction(sb: SupabaseClient, row: Row): Promise<void> {
  const { error } = await sb
    .from(T30_PREDICTIONS_TABLE)
    .upsert(row as never, { onConflict: "target_ts,model_version,run_mode" });
  if (error) throw new Error(`t30_prediction_upsert:${error.message}`);
}

export async function upsertT30Shadows(
  sb: SupabaseClient,
  rows: readonly Row[],
): Promise<void> {
  if (!rows.length) return;
  const { error } = await sb
    .from(T30_SHADOWS_TABLE)
    .upsert(rows as never, { onConflict: "target_ts,policy,run_mode" });
  if (error) throw new Error(`t30_shadow_upsert:${error.message}`);
}

export interface T30Candle {
  candleTs: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Confirmed OKX 15m candles — the only outcome source T30 may use. */
export async function loadConfirmedCandles(
  sb: SupabaseClient,
  fromTs: string,
  toTs: string,
): Promise<Map<string, T30Candle>> {
  const out = new Map<string, T30Candle>();
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
    if (error) throw new Error(`t30_candle_load:${error.message}`);
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

export async function auditT30(
  sb: SupabaseClient,
  event: string,
  payload: Row,
  success = true,
): Promise<void> {
  try {
    await sb.from("api_runs").insert({
      run_type: `t30-${event}`,
      response_payload: payload,
      success,
      error_message: success ? null : String(payload.error ?? event),
    } as never);
  } catch {
    /* auditing must never block decisioning */
  }
}
