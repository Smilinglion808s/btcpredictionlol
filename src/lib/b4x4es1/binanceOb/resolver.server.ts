// B4x4-ES1 Binance Order-Book R1 — shadow policy resolution (server only).
//
// Outcome truth is the canonical OKX BTC-USDT 15m confirmed candle, exactly as
// used by ES1 itself. Binance is never used to grade an outcome.

import type { SupabaseClient } from "@supabase/supabase-js";
import { BINANCE_OB_POLICY_VERSION, BINANCE_OB_RESOLVER_VERSION } from "./config";
import { scorePolicy, type Direction } from "./policies";
import { POLICY_TABLE, auditBinanceOb } from "./store.server";

const ES1_SYMBOL = "BTC-USDT";
const ES1_TIMEFRAME = "15m";
const ES1_EXCHANGE = "okx";

type Row = Record<string, unknown>;

export interface ResolveSummary {
  scanned: number;
  resolved: number;
  skippedNoCandle: number;
  errors: number;
}

function directionOf(open: number, close: number): "GREEN" | "RED" | "PUSH" {
  if (close > open) return "GREEN";
  if (close < open) return "RED";
  return "PUSH";
}

/**
 * Resolve every unresolved policy shadow whose target candle has closed.
 * Idempotent: rows already carrying `resolved_at` are never touched.
 */
export async function resolveBinanceObShadows(
  sb: SupabaseClient,
  limit = 400,
): Promise<ResolveSummary> {
  const summary: ResolveSummary = { scanned: 0, resolved: 0, skippedNoCandle: 0, errors: 0 };
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const { data, error } = await sb
    .from(POLICY_TABLE)
    .select("id, target_ts, candidate_direction, resolution_attempt_count")
    .eq("policy_version", BINANCE_OB_POLICY_VERSION)
    .is("resolved_at", null)
    .lt("target_ts", cutoff)
    .order("target_ts", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`binance_ob_resolve_scan:${error.message}`);

  const rows = (data ?? []) as Row[];
  summary.scanned = rows.length;
  if (rows.length === 0) return summary;

  const targets = [...new Set(rows.map((r) => String(r.target_ts)))];
  const { data: candles } = await sb
    .from("candles")
    .select("candle_ts, open, close")
    .eq("symbol", ES1_SYMBOL)
    .eq("timeframe", ES1_TIMEFRAME)
    .eq("fetch_source", ES1_EXCHANGE)
    .eq("confirm", true)
    .in("candle_ts", targets);

  const byTs = new Map<string, { open: number; close: number }>();
  for (const c of (candles ?? []) as Row[]) {
    const ts = new Date(String(c.candle_ts)).toISOString();
    const open = Number(c.open);
    const close = Number(c.close);
    if (Number.isFinite(open) && Number.isFinite(close)) byTs.set(ts, { open, close });
  }

  for (const r of rows) {
    const ts = new Date(String(r.target_ts)).toISOString();
    const candle = byTs.get(ts);
    const attempt = Number(r.resolution_attempt_count ?? 0) + 1;
    if (!candle) {
      summary.skippedNoCandle++;
      await sb
        .from(POLICY_TABLE)
        .update({
          resolution_attempt_count: attempt,
          last_resolution_attempt_at: new Date().toISOString(),
          last_resolution_error: "OKX_CONFIRMED_CANDLE_UNAVAILABLE",
        } as never)
        .eq("id", r.id as string);
      continue;
    }

    const actual = directionOf(candle.open, candle.close);
    const { result, score } = scorePolicy(
      (r.candidate_direction as Direction | null) ?? null,
      actual,
    );
    const { error: upErr } = await sb
      .from(POLICY_TABLE)
      .update({
        actual_direction: actual,
        result,
        result_score: score,
        resolved_at: new Date().toISOString(),
        resolver_version: BINANCE_OB_RESOLVER_VERSION,
        resolution_attempt_count: attempt,
        last_resolution_attempt_at: new Date().toISOString(),
        last_resolution_error: null,
      } as never)
      .eq("id", r.id as string)
      .is("resolved_at", null);
    if (upErr) summary.errors++;
    else summary.resolved++;
  }

  await auditBinanceOb(sb, "resolve", { ...summary });
  return summary;
}
