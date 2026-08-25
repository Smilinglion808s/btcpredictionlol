// Cross89 — Supabase persistence helpers (server-only).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  T30X_ACTIVATION_TABLE,
  T30X_FEATURES_TABLE,
  T30X_FITS_TABLE,
  T30X_PREDICTIONS_TABLE,
  T30X_SAMPLES_TABLE,
  T30X_SHADOWS_TABLE,
} from "./config";

type SB = SupabaseClient<never, never, never>;
type Row = Record<string, unknown>;

const PAGE = 1000;

/** Upsert one-second bars; returns the number of rows written. */
export async function upsertX89Samples(sb: SB, rows: Row[]): Promise<number> {
  if (rows.length === 0) return 0;
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await sb
      .from(T30X_SAMPLES_TABLE)
      .upsert(chunk as never, { onConflict: "target_ts,offset_seconds" });
    if (error) throw new Error(`${T30X_SAMPLES_TABLE}:${error.message}`);
    written += chunk.length;
  }
  return written;
}

export async function upsertX89Features(sb: SB, rows: Row[]): Promise<number> {
  if (rows.length === 0) return 0;
  let written = 0;
  for (let i = 0; i < rows.length; i += 250) {
    const chunk = rows.slice(i, i + 250);
    const { error } = await sb
      .from(T30X_FEATURES_TABLE)
      .upsert(chunk as never, { onConflict: "target_ts" });
    if (error) throw new Error(`${T30X_FEATURES_TABLE}:${error.message}`);
    written += chunk.length;
  }
  return written;
}

/** Read the packet for one target boundary. */
export async function loadX89Packet(sb: SB, targetTs: string): Promise<Row[]> {
  const { data, error } = await sb
    .from(T30X_SAMPLES_TABLE)
    .select("*")
    .eq("target_ts", targetTs)
    .order("offset_seconds", { ascending: true });
  if (error) throw new Error(`${T30X_SAMPLES_TABLE}:${error.message}`);
  return (data ?? []) as Row[];
}

/**
 * Paged chronological read of feature rows. PostgREST caps a single response
 * at 1,000 rows, so every historical read here must page.
 */
export async function loadX89FeatureRows(
  sb: SB,
  opts: { columns?: string; fromTs?: string; toTs?: string; limitRows?: number } = {},
): Promise<Row[]> {
  const cols = opts.columns ?? "*";
  const out: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = sb
      .from(T30X_FEATURES_TABLE)
      .select(cols)
      .order("target_ts", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (opts.fromTs) q = q.gte("target_ts", opts.fromTs);
    if (opts.toTs) q = q.lte("target_ts", opts.toTs);
    const { data, error } = await q;
    if (error) throw new Error(`${T30X_FEATURES_TABLE}:${error.message}`);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    if (opts.limitRows && out.length >= opts.limitRows) break;
  }
  return out;
}

export async function upsertX89Fit(sb: SB, row: Row): Promise<void> {
  const { error } = await sb
    .from(T30X_FITS_TABLE)
    .upsert(row as never, { onConflict: "block_start_index" });
  if (error) throw new Error(`${T30X_FITS_TABLE}:${error.message}`);
}

export async function loadX89Fit(sb: SB, blockStartIndex: number): Promise<Row | null> {
  const { data, error } = await sb
    .from(T30X_FITS_TABLE)
    .select("*")
    .eq("block_start_index", blockStartIndex)
    .maybeSingle();
  if (error) throw new Error(`${T30X_FITS_TABLE}:${error.message}`);
  return (data as Row) ?? null;
}

export async function upsertX89Prediction(sb: SB, row: Row): Promise<Row | null> {
  const { data, error } = await sb
    .from(T30X_PREDICTIONS_TABLE)
    .upsert(row as never, { onConflict: "target_ts" })
    .select("id, target_ts")
    .maybeSingle();
  if (error) throw new Error(`${T30X_PREDICTIONS_TABLE}:${error.message}`);
  return (data as Row) ?? null;
}

export async function upsertX89Predictions(sb: SB, rows: Row[]): Promise<number> {
  if (rows.length === 0) return 0;
  let written = 0;
  for (let i = 0; i < rows.length; i += 250) {
    const chunk = rows.slice(i, i + 250);
    const { error } = await sb
      .from(T30X_PREDICTIONS_TABLE)
      .upsert(chunk as never, { onConflict: "target_ts" });
    if (error) throw new Error(`${T30X_PREDICTIONS_TABLE}:${error.message}`);
    written += chunk.length;
  }
  return written;
}

export async function upsertX89Shadows(sb: SB, rows: Row[]): Promise<number> {
  if (rows.length === 0) return 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb
      .from(T30X_SHADOWS_TABLE)
      .upsert(rows.slice(i, i + 500) as never, { onConflict: "target_ts,policy" });
    if (error) throw new Error(`${T30X_SHADOWS_TABLE}:${error.message}`);
  }
  return rows.length;
}

export interface X89Activation {
  mode: "SHADOW_ONLY" | "ACTIVE";
  webhooks_enabled: boolean;
  activation_target_ts: string | null;
  model_version: string;
}

export async function loadX89Activation(sb: SB): Promise<X89Activation> {
  const { data, error } = await sb
    .from(T30X_ACTIVATION_TABLE)
    .select("mode, webhooks_enabled, activation_target_ts, model_version")
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error(`${T30X_ACTIVATION_TABLE}:${error.message}`);
  const row = (data as X89Activation | null) ?? null;
  return (
    row ?? {
      mode: "SHADOW_ONLY",
      webhooks_enabled: false,
      activation_target_ts: null,
      model_version: "t30-cross89-dual-rank-r1",
    }
  );
}

/** Paged newest-first read of predictions used by CSV export and the card. */
export async function loadX89Predictions(
  sb: SB,
  opts: { columns?: string; sinceTs?: string; limitRows?: number } = {},
): Promise<Row[]> {
  const cols = opts.columns ?? "*";
  const out: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = sb
      .from(T30X_PREDICTIONS_TABLE)
      .select(cols)
      .order("target_ts", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (opts.sinceTs) q = q.gte("target_ts", opts.sinceTs);
    const { data, error } = await q;
    if (error) throw new Error(`${T30X_PREDICTIONS_TABLE}:${error.message}`);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    if (opts.limitRows && out.length >= opts.limitRows) break;
  }
  return out.reverse();
}
