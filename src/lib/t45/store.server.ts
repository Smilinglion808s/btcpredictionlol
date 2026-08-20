// T45 Balanced — persistence layer (server only).
//
// Writes only to t45_* tables. Nothing here can read, mutate, block or delay
// ES1, B4x4, A2, TD1/TD2 or V6.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  T45_COLLECTOR_VERSION,
  T45_FEATURE_VERSION,
  T45_MODEL_VERSION,
  T45_FEATURE_ORDER,
  T45_RANK_WINDOW,
  T45_TRAIN_WINDOW,
} from "./config";
import type { T45SampleRow } from "./ingest";
import type { T45Head, T45TrainingRow } from "./head";
import type { T45SecondBar } from "./features";

export const SAMPLES_TABLE = "t45_second_samples";
export const FEATURES_TABLE = "t45_features";
export const LABELS_TABLE = "t45_training_labels";
export const FITS_TABLE = "t45_fits";
export const PREDICTIONS_TABLE = "t45_predictions";
export const HEALTH_TABLE = "t45_collector_health";
export const ACTIVATION_TABLE = "t45_activation";

type Row = Record<string, unknown>;

export async function upsertT45Samples(
  sb: SupabaseClient,
  rows: readonly T45SampleRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const { error } = await sb.from(SAMPLES_TABLE).upsert(rows as never, {
    onConflict: "target_ts,offset_seconds,collector_version",
    ignoreDuplicates: true,
  });
  if (error) throw new Error(`t45_sample_upsert:${error.message}`);
  return rows.length;
}

export async function upsertT45Health(sb: SupabaseClient, row: Row): Promise<void> {
  const { error } = await sb
    .from(HEALTH_TABLE)
    .upsert({ ...row, updated_at: new Date().toISOString() } as never, {
      onConflict: "stream_key",
    });
  if (error) throw new Error(`t45_health_upsert:${error.message}`);
}

export async function readT45Health(sb: SupabaseClient): Promise<Row[]> {
  const { data } = await sb.from(HEALTH_TABLE).select("*");
  return (data ?? []) as Row[];
}

export async function readT45Activation(sb: SupabaseClient): Promise<Row> {
  const { data } = await sb
    .from(ACTIVATION_TABLE)
    .select("*")
    .eq("singleton_key", "T45_BALANCED")
    .maybeSingle();
  return (data ?? { mode: "SHADOW_ONLY", webhooks_enabled: false }) as Row;
}

/** The 45 one-second bars captured for a target, in offset order. */
export async function loadT45Bars(
  sb: SupabaseClient,
  targetTs: string,
): Promise<T45SecondBar[]> {
  const { data, error } = await sb
    .from(SAMPLES_TABLE)
    .select(
      "offset_seconds, open, high, low, close, volume, quote_volume, trade_count, taker_buy_quote_volume",
    )
    .eq("target_ts", targetTs)
    .eq("collector_version", T45_COLLECTOR_VERSION)
    .order("offset_seconds", { ascending: true });
  if (error) throw new Error(`t45_bar_load:${error.message}`);
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

export async function upsertT45Feature(sb: SupabaseClient, row: Row): Promise<void> {
  const { error } = await sb.from(FEATURES_TABLE).upsert(row as never, {
    onConflict: "target_ts,feature_version",
    ignoreDuplicates: false,
  });
  if (error) throw new Error(`t45_feature_upsert:${error.message}`);
}

/** Absolute walk-forward row index: number of feature rows strictly before `targetTs`. */
export async function t45RowIndex(sb: SupabaseClient, targetTs: string): Promise<number> {
  const { count, error } = await sb
    .from(FEATURES_TABLE)
    .select("target_ts", { count: "exact", head: true })
    .eq("feature_version", T45_FEATURE_VERSION)
    .lt("target_ts", targetTs);
  if (error) throw new Error(`t45_row_index:${error.message}`);
  return count ?? 0;
}

/**
 * Training rows for the block window `[blockStart - T45_TRAIN_WINDOW, blockStart)`
 * in absolute index order, joined to their realized training labels.
 */
export async function loadT45TrainingRows(
  sb: SupabaseClient,
  blockStart: number,
): Promise<T45TrainingRow[]> {
  const lo = Math.max(0, blockStart - T45_TRAIN_WINDOW);
  const cols = ["target_ts", "feature_complete", ...T45_FEATURE_ORDER].join(", ");
  const { data, error } = await sb
    .from(FEATURES_TABLE)
    .select(cols)
    .eq("feature_version", T45_FEATURE_VERSION)
    .order("target_ts", { ascending: true })
    .range(lo, blockStart - 1);
  if (error) throw new Error(`t45_training_load:${error.message}`);
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return [];

  const labels = await loadT45Labels(
    sb,
    String(rows[0].target_ts),
    String(rows[rows.length - 1].target_ts),
  );

  const out: T45TrainingRow[] = [];
  rows.forEach((r, i) => {
    const ts = new Date(String(r.target_ts)).toISOString();
    const label = labels.get(ts);
    if (label == null || !Number.isFinite(label) || label === 0) return;
    if (r.feature_complete !== true) return;
    const vector: number[] = [];
    for (const name of T45_FEATURE_ORDER) {
      const v = r[name];
      if (typeof v !== "number" || !Number.isFinite(v)) return;
      vector.push(v);
    }
    out.push({ targetTs: ts, index: lo + i, vector, label });
  });
  return out;
}

export async function loadT45Labels(
  sb: SupabaseClient,
  fromTs: string,
  toTs: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const page = 1000;
  for (let offset = 0; ; offset += page) {
    const { data, error } = await sb
      .from(LABELS_TABLE)
      .select("target_ts, training_label_feedback")
      .gte("target_ts", fromTs)
      .lte("target_ts", toTs)
      .order("target_ts", { ascending: true })
      .range(offset, offset + page - 1);
    if (error) throw new Error(`t45_label_load:${error.message}`);
    const rows = (data ?? []) as Row[];
    for (const r of rows) {
      const v = r.training_label_feedback;
      if (typeof v === "number") out.set(new Date(String(r.target_ts)).toISOString(), v);
    }
    if (rows.length < page) break;
  }
  return out;
}

export async function upsertT45Label(
  sb: SupabaseClient,
  targetTs: string,
  feedback: number | null,
  strict: number | null,
  source: string,
): Promise<void> {
  await sb.from(LABELS_TABLE).upsert(
    {
      target_ts: targetTs,
      training_label_feedback: feedback,
      evaluation_label_strict: strict,
      label_source: source,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "target_ts" },
  );
}

export async function readT45Fit(sb: SupabaseClient, fitId: string): Promise<Row | null> {
  const { data } = await sb.from(FITS_TABLE).select("*").eq("fit_id", fitId).maybeSingle();
  return (data as Row | null) ?? null;
}

export async function insertT45Fit(sb: SupabaseClient, row: Row): Promise<void> {
  const { error } = await sb
    .from(FITS_TABLE)
    .upsert(row as never, { onConflict: "fit_id", ignoreDuplicates: true });
  if (error) throw new Error(`t45_fit_upsert:${error.message}`);
}

export function t45FitId(blockStart: number): string {
  return `${T45_MODEL_VERSION}::block=${blockStart}`;
}

export function headFromFitRow(row: Row): T45Head {
  return {
    scaler: {
      center: row.scaler_center as number[],
      scale: row.scaler_scale as number[],
    },
    coefficients: row.coefficients as number[],
    intercept: Number(row.intercept),
    trainingRowCount: Number(row.training_row_count),
    trainingStartTs: String(row.training_start_ts ?? ""),
    trainingEndTs: String(row.training_end_ts ?? ""),
    blockIndex: Number(row.block_index),
    blockStartIndex: Number(row.block_start_index),
    converged: row.converged === true,
    iterations: Number(row.iterations ?? 0),
    gradientNorm: Number(row.gradient_norm ?? 0),
  };
}

/** Strictly past-only confidences for the rank window. */
export async function loadPriorConfidences(
  sb: SupabaseClient,
  targetTs: string,
): Promise<number[]> {
  const { data, error } = await sb
    .from(PREDICTIONS_TABLE)
    .select("confidence")
    .eq("model_version", T45_MODEL_VERSION)
    .not("confidence", "is", null)
    .lt("target_ts", targetTs)
    .order("target_ts", { ascending: false })
    .limit(T45_RANK_WINDOW);
  if (error) throw new Error(`t45_rank_history:${error.message}`);
  return ((data ?? []) as Row[])
    .map((r) => Number(r.confidence))
    .filter((v) => Number.isFinite(v))
    .reverse();
}

export async function upsertT45Prediction(sb: SupabaseClient, row: Row): Promise<void> {
  const { error } = await sb.from(PREDICTIONS_TABLE).upsert(
    // Shadow-only invariant enforced in code as well as in the schema default.
    { ...row, webhook_eligible: false, webhook_sent: false } as never,
    { onConflict: "target_ts,model_version,run_mode", ignoreDuplicates: false },
  );
  if (error) throw new Error(`t45_prediction_upsert:${error.message}`);
}

export async function auditT45(
  sb: SupabaseClient,
  event: string,
  payload: Row,
  success = true,
): Promise<void> {
  try {
    await sb.from("api_runs").insert({
      run_type: `t45-${event}`,
      response_payload: payload,
      success,
      error_message: success ? null : String(payload.error ?? event),
    } as never);
  } catch {
    /* auditing must never block capture or decisioning */
  }
}
