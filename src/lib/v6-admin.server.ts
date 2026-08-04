// V6 admin operations — manual warmup initialization.
//
// This module never writes historical rows into v6_predictions and never marks
// v6_warmup_state READY by hand. It only resets readiness to NOT_STARTED,
// reports the confirmed contiguous canonical history, and lets the normal
// runV6 -> ensureV6Warm path perform the canonical replay at a real boundary.

import type { SupabaseClient } from "@supabase/supabase-js";

import { V6_CANDLE_STREAM, V6_LATE_GRACE_S } from "./v6/config";
import { fetchWarmupCandles, markV6NotReady, setV6WarmupNextTarget } from "./v6/warmup";
import { V6_WARMUP_MIN_CANDLES } from "./v6/warmupCore";

const TF_MS = 15 * 60 * 1000;

export interface V6InitResult {
  ok: boolean;
  next_target_ts: string;
  contiguous_candles: number;
  required_candles: number;
  sufficient_history: boolean;
  first_candle_ts: string | null;
  last_candle_ts: string | null;
  stream: string;
  error: string | null;
}

export interface V6BoundaryRunResult {
  invoked: boolean;
  reason: string;
  target_candle_ts: string | null;
  next_target_ts: string;
}

/** The next 15m boundary that has not opened yet. */
export function nextV6TargetBoundary(now: Date = new Date()): Date {
  return new Date(Math.floor(now.getTime() / TF_MS) * TF_MS + TF_MS);
}

/** The 15m boundary that is currently open. */
export function currentV6Boundary(now: Date = new Date()): Date {
  return new Date(Math.floor(now.getTime() / TF_MS) * TF_MS);
}

/**
 * Step 1-4: reset readiness to NOT_STARTED, record the next boundary, and
 * report how much confirmed contiguous canonical history is available.
 * The replay itself happens inside ensureV6Warm at that boundary.
 */
export async function initV6WarmupServer(sb: SupabaseClient): Promise<V6InitResult> {
  const target = nextV6TargetBoundary();
  const stream = `${V6_CANDLE_STREAM.symbol} ${V6_CANDLE_STREAM.timeframe} ${V6_CANDLE_STREAM.provider}`;

  await markV6NotReady(sb, "manual_init_requested", "NOT_STARTED");
  await setV6WarmupNextTarget(sb, target);

  try {
    // Confirmed candles only, ending at T-15m: never warms on a partial candle.
    const candles = await fetchWarmupCandles(sb, target);
    return {
      ok: candles.length >= V6_WARMUP_MIN_CANDLES,
      next_target_ts: target.toISOString(),
      contiguous_candles: candles.length,
      required_candles: V6_WARMUP_MIN_CANDLES,
      sufficient_history: candles.length >= V6_WARMUP_MIN_CANDLES,
      first_candle_ts: candles[0]?.candle_ts ?? null,
      last_candle_ts: candles[candles.length - 1]?.candle_ts ?? null,
      stream,
      error: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await markV6NotReady(sb, msg);
    return {
      ok: false,
      next_target_ts: target.toISOString(),
      contiguous_candles: 0,
      required_candles: V6_WARMUP_MIN_CANDLES,
      sufficient_history: false,
      first_candle_ts: null,
      last_candle_ts: null,
      stream,
      error: msg,
    };
  }
}

/**
 * Step 5-6: invoke runV6 for the boundary that just opened, but only inside the
 * existing grace window. runV6 stays idempotent per target candle and performs
 * the warmup gate, leakage checks, and OP_FAIL handling exactly as in live runs.
 */
export async function runV6AtBoundaryServer(sb: SupabaseClient): Promise<V6BoundaryRunResult> {
  const now = new Date();
  const target = currentV6Boundary(now);
  const latenessS = (now.getTime() - target.getTime()) / 1000;
  const next = nextV6TargetBoundary(now).toISOString();

  if (latenessS > V6_LATE_GRACE_S) {
    return {
      invoked: false,
      reason: `outside_grace_window:${Math.round(latenessS)}s`,
      target_candle_ts: null,
      next_target_ts: next,
    };
  }

  const { runV6 } = await import("./v6/orchestrator");
  await runV6(sb, target);
  return {
    invoked: true,
    reason: `invoked:${Math.round(latenessS)}s_after_open`,
    target_candle_ts: target.toISOString(),
    next_target_ts: next,
  };
}
