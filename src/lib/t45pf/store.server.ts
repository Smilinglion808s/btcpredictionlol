// T45 PriceFlow — persistence layer (server only).
//
// Reads the shared collector/feature tables (read-only) and writes ONLY to
// t45_pf_*. It can never mutate T45 Balanced, ES1, B4x4, A2, TD1/TD2 or V6.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  T45PF_ACTIVATION_KEY,
  T45PF_ACTIVATION_TABLE,
  T45PF_FEATURE_ORDER,
  T45PF_FITS_TABLE,
  T45PF_PREDICTIONS_TABLE,
  T45PF_RANK_WINDOW,
  T45PF_TRAIN_WINDOW,
  MODEL_VERSION,
} from "./config";
import type { PFTrainingRow } from "./head";
import type { T45SecondBar } from "@/lib/t45/features";

type Row = Record<string, unknown>;

/** Shared read-only sources — never written by this model. */
const SAMPLES_TABLE = "t45_second_samples";
const FEATURES_TABLE = "t45_features";
const LABELS_TABLE = "t45_training_labels";
const T45_COLLECTOR_VERSION = "t45-kline-collector-r1";
const T45_FEATURE_VERSION = "t45-features-r1";

export async function readPFActivation(sb: SupabaseClient): Promise<Row> {
  const { data } = await sb
    .from(T45PF_ACTIVATION_TABLE)
    .select("*")
    .eq("singleton_key", T45PF_ACTIVATION_KEY)
    .maybeSingle();
  return (data ?? { mode: "SHADOW_ONLY", webhooks_enabled: false }) as Row;
}

export async function loadPFBars(
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
  if (error) throw new Error(`t45pf_bar_load:${error.message}`);
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

/** Absolute walk-forward index: feature rows strictly before `targetTs`. */
export async function pfRowIndex(sb: SupabaseClient, targetTs: string): Promise<number> {
  const { count, error } = await sb
    .from(FEATURES_TABLE)
    .select("target_ts", { count: "exact", head: true })
    .eq("feature_version", T45_FEATURE_VERSION)
    .lt("target_ts", targetTs);
  if (error) throw new Error(`t45pf_row_index:${error.message}`);
  return count ?? 0;
}

export async function loadPFTrainingRows(
  sb: SupabaseClient,
  blockStart: number,
): Promise<PFTrainingRow[]> {
  const lo = Math.max(0, blockStart - T45PF_TRAIN_WINDOW);
  const cols = ["target_ts", "spot_complete", ...T45PF_FEATURE_ORDER].join(", ");
  const { data, error } = await sb
    .from(FEATURES_TABLE)
    .select(cols)
    .eq("feature_version", T45_FEATURE_VERSION)
    .order("target_ts", { ascending: true })
    .range(lo, blockStart - 1);
  if (error) throw new Error(`t45pf_training_load:${error.message}`);
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return [];

  const labels = await loadPFLabels(
    sb,
    String(rows[0].target_ts),
    String(rows[rows.length - 1].target_ts),
  );

  const out: PFTrainingRow[] = [];
  rows.forEach((r, i) => {
    const ts = new Date(String(r.target_ts)).toISOString();
    const label = labels.get(ts);
    if (label == null || !Number.isFinite(label) || label === 0) return;
    if (r.spot_complete !== true) return;
    const vector: number[] = [];
    for (const name of T45PF_FEATURE_ORDER) {
      const v = r[name];
      if (typeof v !== "number" || !Number.isFinite(v)) return;
      vector.push(v);
    }
    out.push({ targetTs: ts, index: lo + i, vector, label });
  });
  return out;
}

export async function loadPFLabels(
  sb: SupabaseClient,
  fromTs: string,
  toTs: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const page = 1000;
  for (let offset = 0; ; offset += page) {
    const { data, error } = await sb
      .from(LABELS_TABLE)
      .select("target_ts, evaluation_label_strict, training_label_feedback")
      .gte("target_ts", fromTs)
      .lte("target_ts", toTs)
      .order("target_ts", { ascending: true })
      .range(offset, offset + page - 1);
    if (error) throw new Error(`t45pf_label_load:${error.message}`);
    const rows = (data ?? []) as Row[];
    for (const r of rows) {
      const v = (r.evaluation_label_strict ?? r.training_label_feedback) as unknown;
      if (typeof v === "number") out.set(new Date(String(r.target_ts)).toISOString(), v);
    }
    if (rows.length < page) break;
  }
  return out;
}

export async function readPFFit(sb: SupabaseClient, fitId: string): Promise<Row | null> {
  const { data } = await sb
    .from(T45PF_FITS_TABLE)
    .select("*")
    .eq("fit_id", fitId)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

export async function insertPFFit(sb: SupabaseClient, row: Row): Promise<void> {
  const { error } = await sb
    .from(T45PF_FITS_TABLE)
    .upsert(row as never, { onConflict: "fit_id", ignoreDuplicates: true });
  if (error) throw new Error(`t45pf_fit_upsert:${error.message}`);
}

/** Strictly past-only confidences for the rank window. */
export async function loadPFPriorConfidences(
  sb: SupabaseClient,
  targetTs: string,
): Promise<number[]> {
  const { data, error } = await sb
    .from(T45PF_PREDICTIONS_TABLE)
    .select("confidence")
    .eq("model_version", MODEL_VERSION)
    .not("confidence", "is", null)
    .lt("target_ts", targetTs)
    .order("target_ts", { ascending: false })
    .limit(T45PF_RANK_WINDOW);
  if (error) throw new Error(`t45pf_rank_history:${error.message}`);
  return ((data ?? []) as Row[])
    .map((r) => Number(r.confidence))
    .filter((v) => Number.isFinite(v))
    .reverse();
}

/** Shadow-only invariant enforced in code as well as in the schema default. */
export async function upsertPFPrediction(sb: SupabaseClient, row: Row): Promise<void> {
  const { error } = await sb.from(T45PF_PREDICTIONS_TABLE).upsert(
    { ...row, webhook_eligible: false, webhook_sent: false } as never,
    { onConflict: "target_ts,model_version,run_mode", ignoreDuplicates: false },
  );
  if (error) throw new Error(`t45pf_prediction_upsert:${error.message}`);
}

export async function auditPF(
  sb: SupabaseClient,
  event: string,
  payload: Row,
  success = true,
): Promise<void> {
  try {
    await sb.from("api_runs").insert({
      run_type: `t45pf-${event}`,
      response_payload: payload,
      success,
      error_message: success ? null : String(payload.error ?? event),
    } as never);
  } catch {
    /* auditing must never block decisioning */
  }
}
