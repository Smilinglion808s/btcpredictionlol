// B4x4-ES1 Binance Order-Book R1 — boundary finalization (server only).
//
// SHADOW ONLY. Nothing here may alter an ES1 decision, direction, confidence or
// webhook. Every call site must treat failures as non-fatal.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BINANCE_OB_COLLECTOR_VERSION,
  BINANCE_OB_IMPLEMENTATION_REVISION,
  BINANCE_OB_POLICY_VERSION,
  BINANCE_OB_PRIMARY_MARKET,
  BINANCE_OB_SYMBOL,
  BINANCE_OB_VENUE,
  BINANCE_OB_VERSION,
  EXPECTED_OBSERVATIONS,
  FEATURE_CUTOFF_OFFSET_MS,
  HEARTBEAT_STALE_MS,
  HISTORY_WINDOW,
  binanceObConfigHash,
  floorTarget,
  isExactBoundary,
  valuesHash,
  type CaptureStatus,
  type MarketKind,
} from "./config";
import { computeBoundaryFeatures } from "./features";
import { evaluateAllPolicies } from "./policies";
import {
  auditBinanceOb,
  getBoundaryFeature,
  insertBoundaryFeature,
  insertPolicyShadows,
  loadBoundaryHistory,
  loadObservations,
  readActivation,
  readCollectorHealth,
} from "./store.server";
import type { PolicyInputs } from "./types";

const MARKETS: MarketKind[] = ["SPOT", "USD_M_PERP"];

function derivedCaptureStatus(
  obs: { capture_status: CaptureStatus; sequence_ok: boolean }[],
  finalPresent: boolean,
): CaptureStatus {
  if (obs.length === 0) return "NO_DATA";
  if (!finalPresent) return "STALE";
  const worst = obs.find((o) => o.capture_status !== "FRESH");
  return worst ? worst.capture_status : "FRESH";
}

/**
 * Build (once) the immutable boundary feature row for one market.
 * Existing rows are returned untouched.
 */
export async function finalizeBoundaryMarket(
  sb: SupabaseClient,
  targetTs: string,
  marketKind: MarketKind,
): Promise<Record<string, unknown> | null> {
  if (!isExactBoundary(targetTs)) return null;
  const existing = await getBoundaryFeature(sb, targetTs, marketKind);
  if (existing) return existing;

  const observations = await loadObservations(sb, targetTs, marketKind);
  const history = await loadBoundaryHistory(sb, targetTs, marketKind);
  const finalPresent = observations.some((o) => o.sample_offset_seconds === 2);
  const captureStatus = derivedCaptureStatus(
    observations.map((o) => ({ capture_status: o.capture_status, sequence_ok: o.sequence_ok })),
    finalPresent,
  );

  const { fields } = computeBoundaryFeatures({
    targetTs,
    observations,
    history,
    captureStatus,
  });

  const row = {
    ...fields,
    target_ts: targetTs,
    market_kind: marketKind,
    venue: BINANCE_OB_VENUE,
    symbol: BINANCE_OB_SYMBOL,
    feature_cutoff_ts: new Date(new Date(targetTs).getTime() - FEATURE_CUTOFF_OFFSET_MS).toISOString(),
    capture_status: captureStatus,
    feature_version: BINANCE_OB_VERSION,
    collector_version: BINANCE_OB_COLLECTOR_VERSION,
    implementation_revision: BINANCE_OB_IMPLEMENTATION_REVISION,
    config_hash: binanceObConfigHash(),
    expected_observation_count_60s: EXPECTED_OBSERVATIONS,
  };
  return insertBoundaryFeature(sb, row);
}

function toPolicyInputs(row: Record<string, unknown> | null): PolicyInputs | null {
  if (!row) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    finalImbalance10bps: num(row.final_imbalance_10bps),
    absPercentile96: num(row.abs_imbalance_percentile_96),
    signPersistence15s: num(row.sign_persistence_15s),
    ready: row.ready === true,
    historyReady: row.history_ready === true,
  };
}

export interface FinalizeResult {
  targetTs: string;
  spotReady: boolean;
  perpReady: boolean;
  captureStatus: CaptureStatus;
  policyCount: number;
  spotFeatureId: string | null;
  perpFeatureId: string | null;
}

/**
 * Finalize both markets and emit all six policy shadow rows for one target.
 * Safe to call repeatedly: all writes are ignore-duplicate.
 */
export async function finalizeBinanceObTarget(
  sb: SupabaseClient,
  targetTs: string,
  predictionId: string | null = null,
): Promise<FinalizeResult | null> {
  if (!isExactBoundary(targetTs)) return null;

  const [spot, perp] = await Promise.all(
    MARKETS.map((m) => finalizeBoundaryMarket(sb, targetTs, m)),
  );

  const spotInputs = toPolicyInputs(spot);
  const perpInputs = toPolicyInputs(perp);
  const evaluations = evaluateAllPolicies(spotInputs, perpInputs);

  const rows = evaluations.map((e) => ({
    ...e,
    target_ts: targetTs,
    prediction_id: predictionId,
    spot_feature_id: (spot?.id as string | undefined) ?? null,
    perp_feature_id: (perp?.id as string | undefined) ?? null,
    input_values_hash: valuesHash({
      spot: spotInputs,
      perp: perpInputs,
      policy: e.policy_name,
      version: BINANCE_OB_POLICY_VERSION,
    }),
    run_mode: (await readActivationMode(sb)) satisfies string,
    webhook_eligible: false,
    implementation_revision: BINANCE_OB_IMPLEMENTATION_REVISION,
    config_hash: binanceObConfigHash(),
  }));
  await insertPolicyShadows(sb, rows);

  const result: FinalizeResult = {
    targetTs,
    spotReady: spot?.ready === true,
    perpReady: perp?.ready === true,
    captureStatus: (spot?.capture_status as CaptureStatus) ?? "NO_DATA",
    policyCount: rows.length,
    spotFeatureId: (spot?.id as string | undefined) ?? null,
    perpFeatureId: (perp?.id as string | undefined) ?? null,
  };
  await auditBinanceOb(sb, "finalize", { ...result });
  return result;
}

let activationModeCache: { value: string; at: number } | null = null;
async function readActivationMode(sb: SupabaseClient): Promise<string> {
  if (activationModeCache && Date.now() - activationModeCache.at < 30_000) {
    return activationModeCache.value;
  }
  const activation = await readActivation(sb);
  activationModeCache = { value: activation.mode, at: Date.now() };
  return activation.mode;
}

/**
 * Attach the Binance OB audit columns to an existing ES1 prediction row.
 * Never blocks or mutates the ES1 decision; failures are swallowed.
 */
export async function linkBinanceObToPrediction(
  sb: SupabaseClient,
  predictionId: string,
  targetTs: string,
): Promise<void> {
  try {
    const result = await finalizeBinanceObTarget(sb, targetTs, predictionId);
    if (!result) return;
    const spot = await getBoundaryFeature(sb, targetTs, BINANCE_OB_PRIMARY_MARKET);
    await sb
      .from("b4x4_es1_predictions")
      .update({
        binance_ob_version: BINANCE_OB_VERSION,
        binance_ob_config_hash: binanceObConfigHash(),
        binance_ob_run_mode: await readActivationMode(sb),
        binance_ob_spot_feature_id: result.spotFeatureId,
        binance_ob_perp_feature_id: result.perpFeatureId,
        binance_ob_capture_status: result.captureStatus,
        binance_ob_ready: result.spotReady,
        binance_ob_ready_reason: (spot?.ready_reason as string | null) ?? null,
        binance_ob_history_ready: spot?.history_ready === true,
        binance_ob_final_imbalance_10bps: (spot?.final_imbalance_10bps as number | null) ?? null,
        binance_ob_abs_percentile_96: (spot?.abs_imbalance_percentile_96 as number | null) ?? null,
        binance_ob_sign_persistence_15s: (spot?.sign_persistence_15s as number | null) ?? null,
        binance_ob_influenced_decision: false,
      } as never)
      .eq("id", predictionId);
  } catch (err) {
    await auditBinanceOb(
      sb,
      "link-failed",
      { prediction_id: predictionId, target_ts: targetTs, error: String(err) },
      false,
    );
  }
}

/**
 * Watchdog: finalize any recent target that still has no feature row, so gaps
 * are recorded as explicit NO_DATA rather than silently disappearing.
 */
export async function backfillBinanceObTargets(
  sb: SupabaseClient,
  lookbackTargets = HISTORY_WINDOW,
): Promise<string[]> {
  const now = Date.now();
  const latest = floorTarget(now);
  const done: string[] = [];
  for (let i = 1; i <= lookbackTargets; i++) {
    const ts = new Date(latest - i * 15 * 60 * 1000).toISOString();
    const existing = await getBoundaryFeature(sb, ts, "SPOT");
    if (existing) continue;
    await finalizeBinanceObTarget(sb, ts);
    done.push(ts);
    if (done.length >= 8) break;
  }
  return done;
}

export interface CollectorHealthView {
  marketKind: MarketKind;
  alive: boolean;
  status: string;
  lastHeartbeatAt: string | null;
  staleMs: number | null;
  resyncCount: number;
  reconnectCount: number;
  lastError: string | null;
}

export async function binanceObHealth(sb: SupabaseClient): Promise<CollectorHealthView[]> {
  const rows = await readCollectorHealth(sb);
  const now = Date.now();
  return MARKETS.map((m) => {
    const r = rows.find((x) => x.market_kind === m);
    const hb = (r?.last_heartbeat_at as string | null) ?? null;
    const staleMs = hb ? now - new Date(hb).getTime() : null;
    return {
      marketKind: m,
      alive: staleMs != null && staleMs <= HEARTBEAT_STALE_MS,
      status: (r?.collector_status as string | undefined) ?? "UNKNOWN",
      lastHeartbeatAt: hb,
      staleMs,
      resyncCount: Number(r?.resync_count ?? 0),
      reconnectCount: Number(r?.reconnect_count ?? 0),
      lastError: (r?.last_error_message as string | null) ?? null,
    };
  });
}
