// V6 warmup — database-backed readiness gate.
//
// Reconstructs historical state only. Publication is blocked until status READY.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RawCandle } from "./technical";
import type { Direction } from "./inference";
import {
  V6_ARTIFACT_SHA256,
  V6_CANDLE_STREAM,
  V6_FEATURE_SCHEMA_VERSION,
  V6_FIT_ID,
  V6_MODEL_VERSION,
  V6_WARMUP_CANDLES,
} from "./config";
import {
  canResumePersistedState,
  replayWarmup,
  V6_WARMUP_BASE_PREDICTIONS,
  V6_WARMUP_MIN_CANDLES,
  type PersistedWarmupState,
  type V6WarmupFailure,
  type V6WarmupStatus,
  type WarmupBaseDecision,
} from "./warmupCore";

const TF_MS = 15 * 60 * 1000;
const TABLE = "v6_warmup_state";

export interface V6Readiness {
  ready: boolean;
  status: V6WarmupStatus;
  failureReason: V6WarmupFailure | null;
  error: string | null;
  priorBasePredictions: Direction[];
  baseDecisions: WarmupBaseDecision[];
  resumed: boolean;
  candleCount: number;
}

async function readState(sb: SupabaseClient): Promise<PersistedWarmupState | null> {
  const { data } = await sb
    .from(TABLE)
    .select("*")
    .eq("model_version", V6_MODEL_VERSION)
    .maybeSingle();
  return (data as PersistedWarmupState | null) ?? null;
}

async function writeState(sb: SupabaseClient, patch: Record<string, unknown>): Promise<void> {
  await sb
    .from(TABLE)
    .upsert(
      {
        model_version: V6_MODEL_VERSION,
        fit_id: V6_FIT_ID,
        model_artifact_sha256: V6_ARTIFACT_SHA256,
        feature_schema_version: V6_FEATURE_SCHEMA_VERSION,
        ...patch,
      } as never,
      { onConflict: "model_version" },
    );
}

/** Confirmed canonical candles, deduped, longest contiguous tail ending at T-15m. */
async function fetchWarmupCandles(sb: SupabaseClient, targetTs: Date): Promise<RawCandle[]> {
  const lastTs = new Date(targetTs.getTime() - TF_MS);
  const firstTs = new Date(lastTs.getTime() - V6_WARMUP_CANDLES * TF_MS);
  const { data, error } = await sb
    .from("candles")
    .select("candle_ts, open, high, low, close, volume")
    .eq("symbol", V6_CANDLE_STREAM.symbol)
    .eq("timeframe", V6_CANDLE_STREAM.timeframe)
    .eq("fetch_source", V6_CANDLE_STREAM.provider)
    .eq("confirm", true)
    .gte("candle_ts", firstTs.toISOString())
    .lte("candle_ts", lastTs.toISOString())
    .order("candle_ts", { ascending: true });
  if (error) throw new Error(`candle_query_failed:${error.message}`);

  const seen = new Set<string>();
  const rows: RawCandle[] = [];
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const iso = new Date(String(r.candle_ts)).toISOString();
    if (seen.has(iso)) continue;
    seen.add(iso);
    rows.push({
      candle_ts: iso,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume ?? 0),
    });
  }
  if (rows.length === 0) return rows;
  // Longest contiguous tail; older gaps are outside the required sequence.
  let start = rows.length - 1;
  while (
    start > 0 &&
    new Date(rows[start].candle_ts).getTime() - new Date(rows[start - 1].candle_ts).getTime() === TF_MS
  ) start -= 1;
  return rows.slice(start);
}

/** Mark V6 not ready and clear the persisted saturation history. */
export async function markV6NotReady(sb: SupabaseClient, reason: string): Promise<void> {
  await writeState(sb, {
    v6_warmup_status: "FAILED",
    warmup_completed_at: null,
    warmup_continuity_valid: false,
    warmup_feature_valid: false,
    warmup_base_predictions_count: 0,
    warmup_base_predictions_json: [],
    warmup_error: reason,
  });
}

/**
 * Ensure V6 is fully warm for `targetTs`. Resumes verified persisted state, and
 * otherwise performs a full >=200-candle replay plus 7-base-prediction rebuild.
 */
export async function ensureV6Warm(sb: SupabaseClient, targetTs: Date): Promise<V6Readiness> {
  const notReady = (
    status: V6WarmupStatus,
    failureReason: V6WarmupFailure,
    error: string,
    candleCount = 0,
  ): V6Readiness => ({
    ready: false, status, failureReason, error,
    priorBasePredictions: [], baseDecisions: [], resumed: false, candleCount,
  });

  try {
    const existing = await readState(sb);

    // 6. Persistence across normal restarts — verify before trusting.
    if (
      canResumePersistedState(existing, {
        targetTs,
        fitId: V6_FIT_ID,
        artifactSha256: V6_ARTIFACT_SHA256,
        featureSchemaVersion: V6_FEATURE_SCHEMA_VERSION,
      })
    ) {
      const inputIso = new Date(targetTs.getTime() - TF_MS).toISOString();
      const { data: anchor } = await sb
        .from("candles")
        .select("candle_ts")
        .eq("symbol", V6_CANDLE_STREAM.symbol)
        .eq("timeframe", V6_CANDLE_STREAM.timeframe)
        .eq("fetch_source", V6_CANDLE_STREAM.provider)
        .eq("confirm", true)
        .eq("candle_ts", inputIso)
        .maybeSingle();
      if (anchor) {
        const decisions = (existing?.warmup_base_predictions_json ?? []) as WarmupBaseDecision[];
        return {
          ready: true,
          status: "READY",
          failureReason: null,
          error: null,
          priorBasePredictions: decisions.map((d) => d.base_v6_prediction),
          baseDecisions: decisions,
          resumed: true,
          candleCount: V6_WARMUP_MIN_CANDLES,
        };
      }
    }

    const startedAt = new Date().toISOString();
    await writeState(sb, {
      v6_warmup_status: "FETCHING_HISTORY",
      warmup_started_at: startedAt,
      warmup_completed_at: null,
      warmup_next_target_ts: targetTs.toISOString(),
      warmup_error: null,
    });

    let candles: RawCandle[];
    try {
      candles = await fetchWarmupCandles(sb, targetTs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await markV6NotReady(sb, msg);
      return notReady("FAILED", "V6_WARMUP_HISTORY_MISSING", msg);
    }

    const result = replayWarmup(candles, targetTs);

    await writeState(sb, {
      v6_warmup_status: result.status,
      warmup_started_at: startedAt,
      warmup_completed_at: result.status === "READY" ? new Date().toISOString() : null,
      warmup_candle_count: result.candleCount,
      warmup_first_candle_ts: result.firstCandleTs,
      warmup_last_candle_ts: result.lastCandleTs,
      warmup_next_target_ts: result.nextTargetTs,
      warmup_continuity_valid: result.continuityValid,
      warmup_feature_valid: result.featureValid,
      warmup_base_predictions_count: result.priorBasePredictions.length,
      warmup_base_predictions_json: result.baseDecisions,
      warmup_error: result.error,
    });

    if (result.status !== "READY") {
      return notReady(
        "FAILED",
        result.failureReason ?? "V6_WARMUP_NOT_READY",
        result.error ?? "warmup_failed",
        result.candleCount,
      );
    }

    return {
      ready: true,
      status: "READY",
      failureReason: null,
      error: null,
      priorBasePredictions: result.priorBasePredictions,
      baseDecisions: result.baseDecisions,
      resumed: false,
      candleCount: result.candleCount,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try { await markV6NotReady(sb, msg); } catch { /* ignore */ }
    return notReady("FAILED", "V6_WARMUP_NOT_READY", msg);
  }
}

/**
 * Advance persisted warmup state after a live prediction for `targetTs`.
 *
 * Without this, the next boundary would find `warmup_last_candle_ts` stale and
 * force a full history replay every 15 minutes. Idempotent and monotonic: a
 * repeated or out-of-order call never regresses state.
 */
export async function advanceV6Warm(
  sb: SupabaseClient,
  targetTs: Date,
  inputCandleTs: string,
  basePrediction: Direction,
): Promise<{ advanced: boolean; reason: string | null }> {
  try {
    const state = await readState(sb);
    if (!state || state.v6_warmup_status !== "READY") return { advanced: false, reason: "not_ready" };

    const lastIso = state.warmup_last_candle_ts
      ? new Date(state.warmup_last_candle_ts).toISOString()
      : null;
    // Already advanced past (or to) this target — nothing to do.
    if (lastIso && new Date(lastIso).getTime() >= targetTs.getTime()) {
      return { advanced: false, reason: "already_advanced" };
    }

    const decisions = Array.isArray(state.warmup_base_predictions_json)
      ? (state.warmup_base_predictions_json as WarmupBaseDecision[])
      : [];
    const rolled = rollWarmupWindow(decisions, targetTs, inputCandleTs, basePrediction);
    if (!rolled) return { advanced: false, reason: "window_mismatch" };

    await writeState(sb, {
      v6_warmup_status: "READY",
      warmup_last_candle_ts: targetTs.toISOString(),
      warmup_next_target_ts: new Date(targetTs.getTime() + TF_MS).toISOString(),
      warmup_base_predictions_count: rolled.length,
      warmup_base_predictions_json: rolled,
      warmup_error: null,
    });
    return { advanced: true, reason: null };
  } catch (e) {
    return { advanced: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export { V6_WARMUP_BASE_PREDICTIONS, V6_WARMUP_MIN_CANDLES };
