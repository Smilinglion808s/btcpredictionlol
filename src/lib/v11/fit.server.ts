// Version 1.1 — daily fitting and vector materialisation.
//
// Deliberately OFF the decision critical path: the T+45 observer only reads a
// head that already exists. Fitting and backfill run from the maintenance hook.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  V11_MIN_TRAIN_ROWS,
  V11_TRAIN_DAYS,
  V11_VOL_SOURCE,
  utcDate,
} from "./config";
import { buildV11Vector, computeV11Vol } from "./features";
import { fitV11Head, v11FitCutoff, v11HeadCertified, type V11Head } from "./head";
import {
  advanceState,
  readHeadForDate,
  readTrainingRows,
  upsertVector,
  writeHead,
} from "./store.server";

const V11_CONTEXT_TABLE = "v11_context_rows";
const T45_FEATURE_VERSION = "t45-features-r1";

export interface V11FitResult {
  fitDate: string;
  created: boolean;
  head: V11Head | null;
  reason: string;
  trainingRows: number;
}

/** Read-or-fit the daily head for `fitDate` (UTC day being served). */
export async function ensureV11Head(
  sb: SupabaseClient,
  fitDate: string,
): Promise<V11FitResult> {
  const existing = await readHeadForDate(sb, fitDate);
  if (existing) {
    return {
      fitDate,
      created: false,
      head: existing,
      reason: "HEAD_EXISTS",
      trainingRows: existing.trainingRowCount,
    };
  }
  const cutoff = Date.parse(v11FitCutoff(fitDate));
  const from = new Date(cutoff - V11_TRAIN_DAYS * 86_400_000).toISOString();
  const to = new Date(cutoff).toISOString();
  const rows = await readTrainingRows(sb, from, to);
  const head = fitV11Head(fitDate, rows);
  if (!head) {
    return {
      fitDate,
      created: false,
      head: null,
      reason:
        rows.length < V11_MIN_TRAIN_ROWS
          ? `INSUFFICIENT_ROWS(${rows.length}<${V11_MIN_TRAIN_ROWS})`
          : "FIT_REJECTED",
      trainingRows: rows.length,
    };
  }
  if (!v11HeadCertified(head)) {
    return {
      fitDate,
      created: false,
      head: null,
      reason: "FIT_UNCERTIFIED",
      trainingRows: head.trainingRowCount,
    };
  }
  await writeHead(sb, head);
  await advanceState(sb, { lastFitDate: fitDate });
  return {
    fitDate,
    created: true,
    head,
    reason: "FIT_CREATED",
    trainingRows: head.trainingRowCount,
  };
}

export interface V11BackfillResult {
  from: string;
  to: string;
  considered: number;
  written: number;
  valid: number;
}

/**
 * Materialise 80-input vectors for a bounded chronological range. The vol
 * scaler uses the official-opportunity clock, so rows are processed in order
 * and each row's own pre-open return is included in its own window.
 */
export async function backfillV11Vectors(
  sb: SupabaseClient,
  fromTs: string,
  toTs: string,
): Promise<V11BackfillResult> {
  const { data: ctxData, error: ctxErr } = await sb
    .from(V11_CONTEXT_TABLE)
    .select("target_ts, input_valid, label, settlement_ts, feats")
    .gte("target_ts", fromTs)
    .lt("target_ts", toTs)
    .order("target_ts", { ascending: true })
    .limit(5000);
  if (ctxErr) throw ctxErr;
  const ctxRows = (ctxData ?? []) as {
    target_ts: string;
    input_valid: boolean;
    label: number | null;
    settlement_ts: string | null;
    feats: Record<string, number>;
  }[];

  // Warm the volatility clock with the 95 rows immediately before `fromTs`.
  const { data: warmData } = await sb
    .from(V11_CONTEXT_TABLE)
    .select("target_ts, feats")
    .lt("target_ts", fromTs)
    .order("target_ts", { ascending: false })
    .limit(95);
  const volClock: number[] = ((warmData ?? []) as { feats: Record<string, number> }[])
    .reverse()
    .map((r) => Number(r.feats?.[V11_VOL_SOURCE]));

  const t45Map = await readT45Range(sb, fromTs, toTs);

  let written = 0;
  let valid = 0;
  for (const row of ctxRows) {
    const ts = new Date(row.target_ts).toISOString();
    const current = Number(row.feats?.[V11_VOL_SOURCE]);
    const vol = computeV11Vol(volClock, current);
    volClock.push(current);
    if (volClock.length > 200) volClock.splice(0, volClock.length - 200);

    const t45 = t45Map.get(ts) ?? null;
    const built = row.input_valid
      ? buildV11Vector({ direction60: row.feats, t45 }, vol.vol)
      : { vector: null, valid: false, missing: ["v1_input_invalid"], vol: vol.vol };
    await upsertVector(sb, {
      targetTs: ts,
      vector: built.vector,
      vol: built.vol,
      valid: built.valid,
      missing: built.missing,
      label: row.label,
      settlementTs: row.settlement_ts,
    });
    written++;
    if (built.valid) valid++;
  }

  return { from: fromTs, to: toTs, considered: ctxRows.length, written, valid };
}

async function readT45Range(
  sb: SupabaseClient,
  fromTs: string,
  toTs: string,
): Promise<Map<string, Record<string, number>>> {
  const { V11_T45_BASE_ORDER } = await import("./config");
  const out = new Map<string, Record<string, number>>();
  const page = 1000;
  for (let offset = 0; ; offset += page) {
    const { data, error } = await sb
      .from("t45_features")
      .select(["target_ts", ...V11_T45_BASE_ORDER].join(", "))
      .eq("feature_version", T45_FEATURE_VERSION)
      .gte("target_ts", fromTs)
      .lt("target_ts", toTs)
      .order("target_ts", { ascending: true })
      .range(offset, offset + page - 1);
    if (error) throw error;
    const rows = (data ?? []) as Record<string, unknown>[];
    for (const r of rows) {
      const ts = new Date(r.target_ts as string).toISOString();
      const rec: Record<string, number> = {};
      for (const n of V11_T45_BASE_ORDER) rec[n] = Number(r[n]);
      out.set(ts, rec);
    }
    if (rows.length < page) break;
  }
  return out;
}

/** Convenience: ensure today's head exists for the UTC day of `now`. */
export async function ensureHeadForNow(
  sb: SupabaseClient,
  now: Date = new Date(),
): Promise<V11FitResult> {
  return ensureV11Head(sb, utcDate(now));
}
