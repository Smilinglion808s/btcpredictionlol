import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  listAllPredictionsForHistory,
  exportTd1RcShadow,
  exportAas96Shadow,
  exportA96Csv,
} from "@/lib/predictions.functions";
import { exportModel8V3Csv } from "@/lib/model8_v3.functions";
import { supabase } from "@/integrations/supabase/client";
import { Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({ meta: [{ title: "CSV Data — BTC 15m" }] }),
  component: CsvDataPage,
});

const MT_TZ = "America/Denver";

// Base fields — indicator scores/weights are appended dynamically per model group.
const BASE_COLUMNS: { key: string; label: string }[] = [
  { key: "id", label: "id" },
  { key: "created_at", label: "created_at_utc" },
  { key: "created_at_mt", label: "created_at_mt" },
  { key: "candle_ts", label: "candle_ts_utc" },
  { key: "candle_ts_mt", label: "candle_ts_mt" },
  { key: "candle_ends_at", label: "candle_ends_at_utc" },
  { key: "input_candle_ts", label: "input_candle_ts_utc" },
  { key: "input_candle_ts_mt", label: "input_candle_ts_mt" },
  { key: "input_candle_age_seconds", label: "input_candle_age_seconds" },
  { key: "input_features_fresh", label: "input_features_fresh" },
  { key: "freshness_action", label: "freshness_action" },
  { key: "fetch_source", label: "fetch_source" },
  { key: "advance_check_passed", label: "advance_check_passed" },
  { key: "current_partial_minutes_elapsed", label: "current_partial_minutes_elapsed" },
  { key: "current_partial_snapshot_json", label: "current_partial_snapshot_json" },
  { key: "resolved_at", label: "resolved_at_utc" },
  { key: "seconds_to_resolve", label: "seconds_to_resolve" },
  { key: "symbol", label: "symbol" },
  { key: "timeframe", label: "timeframe" },
  { key: "model_version", label: "model_version" },
  { key: "api_model_id", label: "api_model_id" },
  { key: "prediction", label: "prediction" },
  { key: "confidence", label: "confidence" },
  { key: "confidence_bucket", label: "confidence_bucket" },
  { key: "ai_trade_status", label: "trade_status" },
  { key: "ai_total_score", label: "total_score" },
  { key: "ai_bullish_score", label: "bullish_score" },
  { key: "ai_bearish_score", label: "bearish_score" },
  { key: "ai_flip_level", label: "flip_level" },
  { key: "ai_confirmation_level", label: "confirmation_level" },
  { key: "ai_channel_fib_zone", label: "channel_fib_zone" },
  { key: "ai_channel_position", label: "channel_position" },
  { key: "ai_price_vs_vwap", label: "price_vs_vwap" },
  { key: "ai_vwap_distance_atr", label: "vwap_distance_atr" },
  { key: "ai_range_expansion_ratio", label: "range_expansion_ratio" },
  { key: "ai_expansion_state", label: "expansion_state" },
  { key: "ai_score_margin", label: "score_margin" },
  { key: "ai_directional_fallback_used", label: "directional_fallback_used" },
  { key: "ai_bullish_fallback_lockout_active", label: "bullish_fallback_lockout_active" },
  { key: "ai_bearish_fallback_lockout_active", label: "bearish_fallback_lockout_active" },
  { key: "ai_choppy_fallback_filter_active", label: "choppy_fallback_filter_active" },
  { key: "ai_fallback_whipsaw_guard_active", label: "fallback_whipsaw_guard_active" },
  { key: "ai_fallback_block_reason", label: "fallback_block_reason" },
  { key: "ai_original_prediction_before_2_4_1", label: "original_prediction_before_2_4_1" },
  { key: "ai_final_prediction_after_2_4_1", label: "final_prediction_after_2_4_1" },
  { key: "ai_blocked_prediction", label: "blocked_prediction" },
  { key: "ai_would_have_been_result", label: "would_have_been_result" },
  { key: "status", label: "status" },
  { key: "correct", label: "correct" },
  { key: "setup_type", label: "setup_type" },
  { key: "market_condition", label: "market_condition" },
  { key: "btc_price_at_prediction", label: "btc_price_at_prediction" },
  { key: "actual_next_candle_open", label: "actual_open" },
  { key: "actual_next_candle_high", label: "actual_high" },
  { key: "actual_next_candle_low", label: "actual_low" },
  { key: "actual_next_candle_close", label: "actual_close" },
  { key: "actual_direction", label: "actual_direction" },
  { key: "price_change_abs", label: "price_change_abs" },
  { key: "price_change_pct", label: "price_change_pct" },
  { key: "candle_range", label: "candle_range" },
  { key: "body_size", label: "body_size" },
  { key: "body_pct_of_range", label: "body_pct_of_range" },
  { key: "upper_wick", label: "upper_wick" },
  { key: "lower_wick", label: "lower_wick" },
  { key: "upper_wick_pct", label: "upper_wick_pct" },
  { key: "lower_wick_pct", label: "lower_wick_pct" },
  { key: "ind_ema9", label: "ema9" },
  { key: "ind_ema21", label: "ema21" },
  { key: "ind_ema50", label: "ema50" },
  { key: "ind_trend", label: "trend" },
  { key: "ind_volumeExpansion", label: "volume_expansion" },
  { key: "ind_range20High", label: "range20_high" },
  { key: "ind_range20Low", label: "range20_low" },
  { key: "ind_bodyPct", label: "prev_body_pct" },
  { key: "ind_upperWickPct", label: "prev_upper_wick_pct" },
  { key: "ind_lowerWickPct", label: "prev_lower_wick_pct" },
  { key: "ind_failedBreakoutUp", label: "failed_breakout_up" },
  { key: "ind_failedBreakoutDown", label: "failed_breakout_down" },
  { key: "ind_choppy", label: "choppy" },
  { key: "ob_enabled", label: "ob_enabled" },
  { key: "ob_samples_taken", label: "ob_samples_taken" },
  { key: "ob_sample_span_ms", label: "ob_sample_span_ms" },
  { key: "ob_mid_price", label: "ob_mid_price" },
  { key: "ob_mid_price_drift", label: "ob_mid_price_drift" },
  { key: "ob_obi_30s", label: "ob_obi_30s" },
  { key: "ob_obi_2m", label: "ob_obi_2m" },
  { key: "ob_obi_5m", label: "ob_obi_5m" },
  { key: "ob_obi_2m_avg", label: "ob_obi_2m_avg" },
  { key: "ob_obi_2m_trend", label: "ob_obi_2m_trend" },
  { key: "ob_delta_1m", label: "ob_delta_1m" },
  { key: "ob_delta_3m", label: "ob_delta_3m" },
  { key: "ob_delta_15m", label: "ob_delta_15m" },
  { key: "ob_bid_wall_near_support", label: "ob_bid_wall_near_support" },
  { key: "ob_ask_wall_near_resistance", label: "ob_ask_wall_near_resistance" },
  { key: "ob_bid_liquidity_pulling", label: "ob_bid_liquidity_pulling" },
  { key: "ob_ask_liquidity_pulling", label: "ob_ask_liquidity_pulling" },
  { key: "ob_absorption_signal", label: "ob_absorption_signal" },
  { key: "ob_orderbook_pressure", label: "ob_orderbook_pressure" },
  { key: "ob_orderbook_momentum", label: "ob_orderbook_momentum" },
  { key: "ob_confidence_effect", label: "ob_confidence_effect" },
  { key: "ob_fetch_error", label: "ob_fetch_error" },
  { key: "reasoning_summary", label: "reasoning_summary" },
  { key: "notes", label: "notes" },
  // Partial-candle logging columns (persisted on predictions row) — v1.0 spec
  { key: "partial_snapshot_present", label: "partial_snapshot_present" },
  { key: "partial_snapshot_failure_reason", label: "partial_snapshot_failure_reason" },
  { key: "partial_completeness", label: "partial_completeness" },
  { key: "partial_direction", label: "partial_direction" },
  { key: "partial_close_position_pct", label: "partial_close_position_pct" },
  { key: "partial_range_vs_atr", label: "partial_range_vs_atr" },
  { key: "partial_vwap_event", label: "partial_vwap_event" },
  { key: "partial_agreement", label: "partial_agreement" },
  { key: "partial_module_bull_pts", label: "partial_module_bull_pts" },
  { key: "partial_module_bear_pts", label: "partial_module_bear_pts" },
  { key: "partial_veto_active", label: "partial_veto_active" },
  { key: "partial_veto_tier", label: "partial_veto_tier" },
  { key: "partial_veto_direction", label: "partial_veto_direction" },
  { key: "partial_hard_override_fired", label: "partial_hard_override_fired" },
  { key: "conflict_downgrade_applied", label: "conflict_downgrade_applied" },
  { key: "degraded_mode", label: "degraded_mode" },
  { key: "feed_mismatch", label: "feed_mismatch" },
  { key: "partial_fetch_source", label: "partial_fetch_source" },
  { key: "config_hash", label: "config_hash" },
  { key: "agreement_gate_applied", label: "agreement_gate_applied" },
  { key: "agreement_gate_reason", label: "agreement_gate_reason" },
  { key: "final_trade_status", label: "final_trade_status" },
  // Model 6 deterministic engine columns
  { key: "engine_version_hash", label: "engine_version_hash" },
  { key: "units", label: "units" },
  { key: "conviction_active", label: "conviction_active" },
  { key: "conviction_direction", label: "conviction_direction" },
  { key: "conviction_aligned", label: "conviction_aligned" },
  { key: "conviction_reasons_json", label: "conviction_reasons_json" },
  { key: "base_bullish_score", label: "base_bullish_score" },
  { key: "base_bearish_score", label: "base_bearish_score" },
  { key: "bullish_score", label: "m6_bullish_score" },
  { key: "bearish_score", label: "m6_bearish_score" },
  { key: "score_margin", label: "m6_score_margin" },
  { key: "score_sum_mismatch", label: "score_sum_mismatch" },
  { key: "changed_by_partial", label: "changed_by_partial" },
  { key: "change_reason", label: "change_reason" },
  { key: "original_prediction_before_partial", label: "original_prediction_before_partial" },
  { key: "module_points_json", label: "module_points_json" },
];



// Dig the parsed AI JSON out of the raw OpenAI Responses payload.
function extractAiJson(full: unknown): Record<string, unknown> | null {
  if (!full || typeof full !== "object") return null;
  const f = full as Record<string, unknown>;
  const tryParse = (s: unknown): Record<string, unknown> | null => {
    if (typeof s !== "string") return null;
    try {
      const v = JSON.parse(s);
      return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    } catch { return null; }
  };
  const direct = tryParse(f.output_text);
  if (direct) return direct;
  const output = f.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const content = (item as { content?: unknown })?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          const parsed = tryParse((c as { text?: unknown })?.text);
          if (parsed) return parsed;
        }
      }
    }
  }
  return null;
}


const FIFTEEN_MIN_MS = 15 * 60 * 1000;

function fmtMT(iso: string | null | undefined) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("sv-SE", { timeZone: MT_TZ }).replace(" ", "T");
  } catch { return ""; }
}

type PredRow = Record<string, unknown>;

function enrich(p: PredRow): PredRow {
  const open = Number(p.actual_next_candle_open);
  const high = Number(p.actual_next_candle_high);
  const low = Number(p.actual_next_candle_low);
  const close = Number(p.actual_next_candle_close);
  const hasActual = Number.isFinite(open) && Number.isFinite(close);
  const range = hasActual ? high - low : NaN;
  const body = hasActual ? Math.abs(close - open) : NaN;
  const upperWick = hasActual ? high - Math.max(open, close) : NaN;
  const lowerWick = hasActual ? Math.min(open, close) - low : NaN;
  const actualDir = p.actual_direction ?? (hasActual ? (close > open ? "GREEN" : close < open ? "RED" : "DOJI") : "");
  const changeAbs = hasActual ? close - open : NaN;
  const changePct = hasActual && open ? (changeAbs / open) * 100 : NaN;

  const conf = Number(p.confidence) || 0;
  const bucket =
    conf < 40 ? "0-39" : conf < 60 ? "40-59" : conf < 70 ? "60-69" : conf < 80 ? "70-79" : "80+";

  const correct = p.status === "win" ? 1 : p.status === "loss" ? 0 : "";
  const candleTs = String(p.candle_ts);
  const candleEnds = new Date(new Date(candleTs).getTime() + FIFTEEN_MIN_MS).toISOString();
  const secondsToResolve =
    p.resolved_at && p.candle_ts
      ? Math.round((new Date(String(p.resolved_at)).getTime() - new Date(candleTs).getTime()) / 1000)
      : "";

  const ind = (p.indicators ?? {}) as Record<string, unknown>;
  const ai = extractAiJson(p.full_ai_response) ?? {};
  const ob = (p.orderbook ?? {}) as Record<string, unknown>;

  const enriched: PredRow = {
    ...p,
    created_at_mt: fmtMT(String(p.created_at)),
    candle_ts_mt: fmtMT(candleTs),
    input_candle_ts_mt: fmtMT(typeof p.input_candle_ts === "string" ? p.input_candle_ts : null),
    candle_ends_at: candleEnds,
    seconds_to_resolve: secondsToResolve,
    confidence_bucket: bucket,
    correct,
    actual_direction: actualDir,
    current_partial_snapshot_json: p.current_partial_snapshot ? JSON.stringify(p.current_partial_snapshot) : "",
    // Flat partial-snapshot fields for easy CSV analysis
    partial_snapshot_present: p.current_partial_snapshot ? 1 : 0,
    partial_start_ts: (p.current_partial_snapshot as Record<string, unknown> | null)?.start_ts ?? "",
    partial_minutes_elapsed: p.current_partial_minutes_elapsed ?? (p.current_partial_snapshot as Record<string, unknown> | null)?.minutes_elapsed ?? "",
    partial_open: (p.current_partial_snapshot as Record<string, unknown> | null)?.open ?? "",
    partial_high: (p.current_partial_snapshot as Record<string, unknown> | null)?.high ?? "",
    partial_low: (p.current_partial_snapshot as Record<string, unknown> | null)?.low ?? "",
    partial_close: (p.current_partial_snapshot as Record<string, unknown> | null)?.close ?? "",
    partial_volume: (p.current_partial_snapshot as Record<string, unknown> | null)?.volume ?? "",
    partial_source: (p.current_partial_snapshot as Record<string, unknown> | null)?.source ?? "",
    // Derived module features + provenance (persisted in full_ai_response)
    partial_source_path: (ai.partial_candle_source_path as string) ?? "",
    partial_synthesized: ai.partial_candle_synthesized === true ? 1 : ai.partial_candle_synthesized === false ? 0 : "",
    partial_completeness: p.partial_completeness ?? (ai.partial_candle_module_context as Record<string, unknown> | undefined)?.completeness ?? "",
    partial_trust_tier: (ai.partial_candle_module_context as Record<string, unknown> | undefined)?.trust_tier ?? "",
    partial_direction: p.partial_direction ?? (ai.partial_candle_module_context as Record<string, unknown> | undefined)?.partial_direction ?? "",
    partial_close_position_pct: p.partial_close_position_pct ?? (ai.partial_candle_module_context as Record<string, unknown> | undefined)?.partial_close_position_pct ?? "",
    partial_range_vs_atr: p.partial_range_vs_atr ?? (ai.partial_candle_module_context as Record<string, unknown> | undefined)?.partial_range_vs_atr ?? "",
    partial_body_strength: (ai.partial_candle_module_context as Record<string, unknown> | undefined)?.partial_body_strength ?? "",
    partial_upper_wick_pct: (ai.partial_candle_module_context as Record<string, unknown> | undefined)?.upper_wick_pct ?? "",
    partial_lower_wick_pct: (ai.partial_candle_module_context as Record<string, unknown> | undefined)?.lower_wick_pct ?? "",
    partial_vwap_event: p.partial_vwap_event ?? (ai.partial_candle_module_context as Record<string, unknown> | undefined)?.partial_vwap_event ?? "",
    partial_vwap_at_snapshot: (ai.partial_candle_module_context as Record<string, unknown> | undefined)?.vwap_at_snapshot ?? "",
    partial_atr_14: (ai.partial_candle_module_context as Record<string, unknown> | undefined)?.atr_14 ?? "",
    partial_feed_mismatch: p.feed_mismatch ?? (ai.partial_candle_module_context as Record<string, unknown> | undefined)?.feed_mismatch ?? "",
    partial_degraded_mode: p.degraded_mode ?? (ai.partial_candle_module_context as Record<string, unknown> | undefined)?.degraded_mode ?? "",

    partial_attempts_json: ai.partial_candle_attempts ? JSON.stringify(ai.partial_candle_attempts) : "",
    fetch_source: p.fetch_source ?? "",
    advance_check_passed: p.advance_check_passed ?? "",
    freshness_action: p.freshness_action ?? "",
    price_change_abs: hasActual ? changeAbs.toFixed(2) : "",
    price_change_pct: hasActual ? changePct.toFixed(4) : "",
    candle_range: hasActual ? range.toFixed(2) : "",
    body_size: hasActual ? body.toFixed(2) : "",
    body_pct_of_range: hasActual && range ? (body / range).toFixed(4) : "",
    upper_wick: hasActual ? upperWick.toFixed(2) : "",
    lower_wick: hasActual ? lowerWick.toFixed(2) : "",
    upper_wick_pct: hasActual && range ? (upperWick / range).toFixed(4) : "",
    lower_wick_pct: hasActual && range ? (lowerWick / range).toFixed(4) : "",
    ind_ema9: ind.ema9 ?? "",
    ind_ema21: ind.ema21 ?? "",
    ind_ema50: ind.ema50 ?? "",
    ind_trend: ind.trend ?? "",
    ind_volumeExpansion: ind.volumeExpansion ?? "",
    ind_range20High: ind.range20High ?? "",
    ind_range20Low: ind.range20Low ?? "",
    ind_bodyPct: ind.bodyPct ?? "",
    ind_upperWickPct: ind.upperWickPct ?? "",
    ind_lowerWickPct: ind.lowerWickPct ?? "",
    ind_failedBreakoutUp: ind.failedBreakoutUp ?? "",
    ind_failedBreakoutDown: ind.failedBreakoutDown ?? "",
    ind_choppy: ind.choppy ?? "",
    ai_trade_status: ai.trade_status ?? "",
    ai_total_score: ai.total_score ?? "",
    ai_bullish_score: ai.bullish_score ?? "",
    ai_bearish_score: ai.bearish_score ?? "",
    ai_flip_level: ai.flip_level ?? "",
    ai_confirmation_level: ai.confirmation_level ?? "",
    ai_channel_fib_zone: ai.channel_fib_zone ?? "",
    ai_channel_position: ai.channel_position ?? "",
    ai_price_vs_vwap: ai.price_vs_vwap ?? "",
    ai_vwap_distance_atr: ai.vwap_distance_atr ?? "",
    ai_range_expansion_ratio: ai.range_expansion_ratio ?? "",
    ai_expansion_state: ai.expansion_state ?? "",
    ai_score_margin: ai.score_margin ?? "",
    ai_directional_fallback_used: ai.directional_fallback_used ?? "",
    ai_bullish_fallback_lockout_active: ai.bullish_fallback_lockout_active ?? "",
    ai_bearish_fallback_lockout_active: ai.bearish_fallback_lockout_active ?? "",
    ai_choppy_fallback_filter_active: ai.choppy_fallback_filter_active ?? "",
    ai_fallback_whipsaw_guard_active: ai.fallback_whipsaw_guard_active ?? "",
    ai_fallback_block_reason: ai.fallback_block_reason ?? "",
    ai_original_prediction_before_2_4_1: ai.original_prediction_before_2_4_1 ?? "",
    ai_final_prediction_after_2_4_1: ai.final_prediction_after_2_4_1 ?? "",
    ai_blocked_prediction: ai.blocked_prediction ?? "",
    ai_would_have_been_result: ai.would_have_been_result ?? "",
    ob_enabled: ob.enabled ?? "",
    ob_samples_taken: ob.samples_taken ?? "",
    ob_sample_span_ms: ob.sample_span_ms ?? "",
    ob_mid_price: ob.mid_price ?? "",
    ob_mid_price_drift: ob.mid_price_drift ?? "",
    ob_obi_30s: ob.obi_30s ?? "",
    ob_obi_2m: ob.obi_2m ?? "",
    ob_obi_5m: ob.obi_5m ?? "",
    ob_obi_2m_avg: ob.obi_2m_avg ?? "",
    ob_obi_2m_trend: ob.obi_2m_trend ?? "",
    ob_delta_1m: ob.delta_1m ?? "",
    ob_delta_3m: ob.delta_3m ?? "",
    ob_delta_15m: ob.delta_15m ?? "",
    ob_bid_wall_near_support: ob.bid_wall_near_support ?? "",
    ob_ask_wall_near_resistance: ob.ask_wall_near_resistance ?? "",
    ob_bid_liquidity_pulling: ob.bid_liquidity_pulling ?? "",
    ob_ask_liquidity_pulling: ob.ask_liquidity_pulling ?? "",
    ob_absorption_signal: ob.absorption_signal ?? "",
    ob_orderbook_pressure: ob.orderbook_pressure ?? "",
    ob_orderbook_momentum: ob.orderbook_momentum ?? "",
    ob_confidence_effect: ob.confidence_effect ?? "",
    ob_fetch_error: ob.fetch_error ?? "",
    // Model 6 JSON-serialized fields
    module_points_json: p.module_points ? JSON.stringify(p.module_points) : "",
    conviction_reasons_json: Array.isArray(p.conviction_reasons)
      ? JSON.stringify(p.conviction_reasons)
      : (p.conviction_reasons ? JSON.stringify(p.conviction_reasons) : ""),
  };



  // Flatten per-indicator score/weight/weighted/direction into columns.
  const breakdown = ai.indicator_breakdown;
  if (Array.isArray(breakdown)) {
    for (const item of breakdown) {
      const it = item as Record<string, unknown>;
      const name = String(it.indicator ?? "").trim();
      if (!name) continue;
      enriched[`bd_${name}_weight`] = it.weight ?? "";
      enriched[`bd_${name}_score`] = it.score ?? "";
      enriched[`bd_${name}_weighted`] = it.weighted_score ?? "";
      enriched[`bd_${name}_direction`] = it.direction ?? "";
    }
  }
  return enriched;
}

function csvEscape(v: unknown) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function columnsForRows(rows: PredRow[]): { key: string; label: string }[] {
  const seen = new Set<string>();
  const extras: { key: string; label: string }[] = [];
  const indicatorNames = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!k.startsWith("bd_")) continue;
      // bd_<name>_(weight|score|weighted|direction)
      const m = k.match(/^bd_(.+)_(weight|score|weighted|direction)$/);
      if (m) indicatorNames.add(m[1]);
    }
  }
  const sortedNames = Array.from(indicatorNames).sort();
  for (const name of sortedNames) {
    for (const suffix of ["weight", "score", "weighted", "direction"] as const) {
      const key = `bd_${name}_${suffix}`;
      if (seen.has(key)) continue;
      seen.add(key);
      extras.push({ key, label: `${name}_${suffix}` });
    }
  }
  return [...BASE_COLUMNS, ...extras];
}

function toCsv(rows: PredRow[], columns: { key: string; label: string }[]) {
  const header = columns.map((c) => c.label).join(",");
  const body = rows
    .map((r) => columns.map((c) => csvEscape((r as Record<string, unknown>)[c.key])).join(","))
    .join("\n");
  return `${header}\n${body}\n`;
}

type ModelGroup = {
  model: string;
  rows: PredRow[];
  columns: { key: string; label: string }[];
  firstTs: number;
  lastTs: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
};


function downloadJsonRowsAsCsv(rows: Array<Record<string, unknown>>, baseName: string) {
  if (!rows || rows.length === 0) { alert("No data to export."); return; }
  const headerSet = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) headerSet.add(k);
  const headers = Array.from(headerSet);
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = `${headers.join(",")}\n${rows.map((r) => headers.map((h) => escape((r as Record<string, unknown>)[h])).join(",")).join("\n")}\n`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `${baseName}_${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function CsvDataPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAllPredictionsForHistory);
  const listQ = useQuery({ queryKey: ["predictions-history-all"], queryFn: () => listFn() });
  const exportTd1 = useServerFn(exportTd1RcShadow);
  const exportAas96 = useServerFn(exportAas96Shadow);
  const exportA96 = useServerFn(exportA96Csv);
  const [buildingUniversal, setBuildingUniversal] = useState(false);

  useEffect(() => {
    const ch = supabase
      .channel("csv-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "predictions" }, () => {
        qc.invalidateQueries({ queryKey: ["predictions-list"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const groups = useMemo<ModelGroup[]>(() => {
    const map = new Map<string, PredRow[]>();
    (listQ.data ?? []).forEach((p: PredRow) => {
      const key = (p.model_version as string) || "unknown";
      // Keep only Model 6 variants; TD1-RC / a96 have dedicated buttons below.
      if (!/^6/i.test(key) && !/model[_\s-]?6/i.test(key)) return;
      const arr = map.get(key) ?? [];
      arr.push(enrich(p as PredRow));
      map.set(key, arr);
    });
    return Array.from(map.entries())
      .map(([model, rows]) => {
        const times = rows.map((r) => new Date(String(r.candle_ts)).getTime()).filter(Number.isFinite);
        return {
          model,
          rows,
          columns: columnsForRows(rows),
          firstTs: Math.min(...times),
          lastTs: Math.max(...times),
          wins: rows.filter((r) => r.status === "win").length,
          losses: rows.filter((r) => r.status === "loss").length,
          pushes: rows.filter((r) => r.status === "push").length,
          pending: rows.filter((r) => r.status === "pending" || r.status === "manual_review").length,
        };
      })
      .sort((a, b) => b.lastTs - a.lastTs);
  }, [listQ.data]);

  const downloadModel = (g: ModelGroup) => {
    const csv = toCsv(g.rows, g.columns);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = g.model.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const from = fmtDate(g.firstTs);
    const to = fmtDate(g.lastTs);
    a.href = url;
    a.download = `btc15m_${safe}_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadUniversal = async () => {
    try {
      setBuildingUniversal(true);
      const [predRows, td1Rows, aasRows, a96Rows] = await Promise.all([
        Promise.resolve(listQ.data ?? []),
        exportTd1().catch(() => [] as any[]),
        exportAas96().catch(() => [] as any[]),
        exportA96().catch(() => [] as any[]),
      ]);

      const bucket = (ts: unknown): string => {
        if (!ts) return "";
        const d = new Date(String(ts));
        if (!Number.isFinite(d.getTime())) return "";
        return d.toISOString();
      };

      // Base rows come from `predictions` (Model 6+ core CSV). Enrich each so
      // every historical Model 6 data point is present per candle.
      const merged = new Map<string, Record<string, unknown>>();
      for (const p of predRows as PredRow[]) {
        const e = enrich(p);
        const key = bucket(e.candle_ts);
        if (!key) continue;
        // Normalize candle_ts to bucketed ISO so downstream sorts/labels agree.
        e.candle_ts = key;
        merged.set(key, { ...e });
      }

      const attach = (rows: any[], prefix: string, tsKeys: string[]) => {
        for (const r of rows ?? []) {
          let key = "";
          for (const k of tsKeys) { if (r?.[k]) { key = bucket(r[k]); if (key) break; } }
          if (!key) continue;
          const base = merged.get(key) ?? { candle_ts: key };
          for (const [k, v] of Object.entries(r)) {
            if (v && typeof v === "object") {
              base[`${prefix}${k}`] = JSON.stringify(v);
            } else {
              base[`${prefix}${k}`] = v as unknown;
            }
          }
          merged.set(key, base);
        }
      };
      attach(td1Rows as any[], "td1_", ["candle_ts", "target_candle_ts"]);
      attach(aasRows as any[], "aas96_", ["target_candle_ts", "candle_ts"]);
      attach(a96Rows as any[], "a96_", ["target_candle_ts", "candle_ts"]);

      const rows = Array.from(merged.values()).sort((a, b) => {
        const ta = new Date(String(a.candle_ts)).getTime();
        const tb = new Date(String(b.candle_ts)).getTime();
        return tb - ta;
      });
      if (rows.length === 0) { alert("No data to export."); return; }

      // Build headers: preserve the exact Model 6 column ORDER and friendly
      // LABELS from BASE_COLUMNS + dynamic indicator breakdown, then append
      // any additional keys (td1_/aas96_/a96_ prefixed, or straggler fields).
      const baseCols = columnsForRows(rows as PredRow[]);
      const orderedHeaders: { key: string; label: string }[] = [];
      const seenKeys = new Set<string>();
      for (const c of baseCols) {
        if (seenKeys.has(c.key)) continue;
        seenKeys.add(c.key);
        orderedHeaders.push(c);
      }
      // Add every extra key discovered on merged rows, in a stable order.
      const extraKeys: string[] = [];
      for (const r of rows) {
        for (const k of Object.keys(r)) {
          if (seenKeys.has(k)) continue;
          seenKeys.add(k);
          extraKeys.push(k);
        }
      }
      extraKeys.sort();
      for (const k of extraKeys) orderedHeaders.push({ key: k, label: k });

      const header = orderedHeaders.map((c) => c.label).join(",");
      const body = rows
        .map((r) => orderedHeaders.map((c) => csvEscape((r as Record<string, unknown>)[c.key])).join(","))
        .join("\n");
      const csv = `${header}\n${body}\n`;

      const times = rows.map((r) => new Date(String(r.candle_ts)).getTime()).filter(Number.isFinite);
      const from = fmtDate(Math.min(...times));
      const to = fmtDate(Math.max(...times));
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `btc15m_universal_${from}_to_${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBuildingUniversal(false);
    }
  };


  return (
    <div className="px-4 sm:px-6 py-5 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">CSV Training Data</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Universal CSV merges every tracked field across the core engine, TD1-RC, AAS96, and a96 — one row per candle. Model 6, TD1-RC, and a96 per-model exports are available below.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="lg" className="gap-2" onClick={downloadUniversal} disabled={buildingUniversal || listQ.isLoading}>
            <Download className="size-4" />
            {buildingUniversal ? "Building…" : "Download Universal CSV"}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            className="gap-2"
            onClick={async () => {
              const rows = (await exportTd1().catch(() => [])) as any[];
              downloadJsonRowsAsCsv(rows, "btc15m_td1_rc");
            }}
          >
            <Download className="size-4" /> TD1-RC CSV
          </Button>
          <Button
            size="lg"
            variant="secondary"
            className="gap-2"
            onClick={async () => {
              const rows = (await exportA96().catch(() => [])) as any[];
              downloadJsonRowsAsCsv(rows, "btc15m_a96");
            }}
          >
            <Download className="size-4" /> a96 CSV
          </Button>
        </div>
      </div>


      {groups.length === 0 && (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          {listQ.isLoading ? "Loading…" : "No predictions yet."}
        </CardContent></Card>
      )}

      <div className="space-y-3">
        {groups.map((g) => {
          const wr = g.wins + g.losses > 0 ? ((g.wins / (g.wins + g.losses)) * 100).toFixed(1) : "—";
          return (
            <details key={g.model} className="group rounded-lg border border-border bg-card">
              <summary className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 cursor-pointer list-none">
                <div className="flex flex-col">
                  <span className="font-mono font-semibold">{g.model}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {fmtDate(g.firstTs)} → {fmtDate(g.lastTs)} · {g.rows.length} rows
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs font-mono">
                  <span className="text-bull">{g.wins}W</span>
                  <span className="text-bear">{g.losses}L</span>
                  <span className="text-muted-foreground">{g.pushes}P</span>
                  <span className="text-muted-foreground">{g.pending} pending</span>
                  <span>WR {wr}{wr === "—" ? "" : "%"}</span>
                  <Button
                    size="sm"
                    className="gap-2"
                    onClick={(e) => { e.preventDefault(); downloadModel(g); }}
                  >
                    <Download className="size-4" /> CSV
                  </Button>
                  <span className="text-muted-foreground transition-transform group-open:rotate-180">▾</span>
                </div>
              </summary>
              <div className="border-t border-border overflow-x-auto max-h-[60vh]">
                <table className="w-full text-xs font-mono">
                  <thead className="text-[10px] uppercase text-muted-foreground border-b border-border sticky top-0 bg-card">
                    <tr>
                      {g.columns.map((c) => (
                        <th key={c.key} className="text-left px-2 py-2 whitespace-nowrap">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.slice(0, 50).map((r, i) => (
                      <tr key={String(r.id) + i} className="border-b border-border/40 hover:bg-muted/20">
                        {g.columns.map((c) => {
                          const v = (r as Record<string, unknown>)[c.key];
                          const s = v === null || v === undefined ? "" : String(v);
                          return (
                            <td key={c.key} className="px-2 py-1.5 whitespace-nowrap max-w-[220px] truncate" title={s}>
                              {s}
                            </td>
                          );
                        })}

                      </tr>
                    ))}
                  </tbody>
                </table>
                {g.rows.length > 50 && (
                  <div className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border">
                    Preview limited to 50 rows — full {g.rows.length} rows in CSV.
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function fmtDate(ts: number) {
  if (!Number.isFinite(ts)) return "n-a";
  return new Date(ts).toISOString().slice(0, 10);
}

