// B4x4-ES1 Binance Order-Book R1 — missing-boundary watchdog (server only).
//
// Shortly after every target T, both SPOT and USD_M_PERP must own a boundary
// feature row. When one is missing the watchdog writes an explicit failure row
// — never fabricated feature values, never a retroactive direction.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BINANCE_OB_COLLECTOR_VERSION,
  BINANCE_OB_IMPLEMENTATION_REVISION,
  BINANCE_OB_SYMBOL,
  BINANCE_OB_VENUE,
  BINANCE_OB_VERSION,
  EXPECTED_OBSERVATIONS,
  TF_MS,
  binanceObConfigHash,
  binanceObFeatureSchemaHash,
  floorTarget,
  isExactBoundary,
  type CaptureStatus,
  type MarketKind,
} from "./config";
import { featureCutoffTs } from "./timing";
import {
  auditBinanceOb,
  getBoundaryFeature,
  insertBoundaryFeature,
  loadObservations,
} from "./store.server";

const MARKETS: MarketKind[] = ["SPOT", "USD_M_PERP"];

/** Grace period after T before a missing row counts as a failure. */
export const WATCHDOG_GRACE_MS = 90_000;

export interface WatchdogMarketResult {
  targetTs: string;
  marketKind: MarketKind;
  created: boolean;
  captureStatus: CaptureStatus;
  failureReason: string | null;
}

export interface WatchdogResult {
  checkedTargets: string[];
  created: WatchdogMarketResult[];
  alreadyPresent: number;
}

/**
 * Failure row for one (target, market) with no feature row.
 * Only provenance and counters are written; no feature value is invented.
 */
function failureRow(
  targetTs: string,
  marketKind: MarketKind,
  captureStatus: CaptureStatus,
  failureReason: string,
  observationCount: number,
): Record<string, unknown> {
  return {
    target_ts: targetTs,
    market_kind: marketKind,
    venue: BINANCE_OB_VENUE,
    symbol: BINANCE_OB_SYMBOL,
    feature_cutoff_ts: featureCutoffTs(targetTs),
    capture_status: captureStatus,

    ready: false,
    ready_reason: failureReason,
    history_ready: false,
    history_ready_reason: "HISTORY_NOT_EVALUATED_WATCHDOG_FAILURE",
    history_valid_count: 0,
    observation_count_60s: observationCount,
    expected_observation_count_60s: EXPECTED_OBSERVATIONS,
    sequence_ok: false,
    book_complete_10bps: false,
    resync_generation: 0,

    watchdog_created: true,
    failure_reason: failureReason,

    feature_version: BINANCE_OB_VERSION,
    collector_version: BINANCE_OB_COLLECTOR_VERSION,
    implementation_revision: BINANCE_OB_IMPLEMENTATION_REVISION,
    config_hash: binanceObConfigHash(),
    feature_schema_hash: binanceObFeatureSchemaHash(),
    finalized_at: new Date().toISOString(),
  };
}

/** Classify why a boundary is missing, using whatever observations survive. */
export function classifyMissingBoundary(observationCount: number): {
  captureStatus: CaptureStatus;
  failureReason: string;
} {
  if (observationCount === 0) {
    return { captureStatus: "NO_DATA", failureReason: "WATCHDOG_NO_OBSERVATIONS" };
  }
  return { captureStatus: "STALE", failureReason: "WATCHDOG_FINALIZATION_MISSING" };
}

/**
 * Idempotent sweep over recently elapsed targets.
 * Existing rows (including previous watchdog rows) are never rewritten.
 */
export async function runBinanceObWatchdog(
  sb: SupabaseClient,
  lookbackTargets = 8,
  now: number = Date.now(),
): Promise<WatchdogResult> {
  const latest = floorTarget(now);
  const checkedTargets: string[] = [];
  const created: WatchdogMarketResult[] = [];
  let alreadyPresent = 0;

  for (let i = 0; i < lookbackTargets; i++) {
    const targetMs = latest - i * TF_MS;
    if (now - targetMs < WATCHDOG_GRACE_MS) continue;
    const targetTs = new Date(targetMs).toISOString();
    if (!isExactBoundary(targetTs)) continue;
    checkedTargets.push(targetTs);

    for (const marketKind of MARKETS) {
      const existing = await getBoundaryFeature(sb, targetTs, marketKind);
      if (existing) {
        alreadyPresent++;
        continue;
      }
      let observationCount = 0;
      try {
        observationCount = (await loadObservations(sb, targetTs, marketKind)).length;
      } catch (err) {
        await auditBinanceOb(
          sb,
          "database-failure",
          { target_ts: targetTs, market_kind: marketKind, error: String(err) },
          false,
        );
      }
      const { captureStatus, failureReason } = classifyMissingBoundary(observationCount);
      try {
        await insertBoundaryFeature(
          sb,
          failureRow(targetTs, marketKind, captureStatus, failureReason, observationCount),
        );
        created.push({ targetTs, marketKind, created: true, captureStatus, failureReason });
        await auditBinanceOb(sb, "watchdog-missing-boundary", {
          target_ts: targetTs,
          market_kind: marketKind,
          capture_status: captureStatus,
          failure_reason: failureReason,
          observation_count: observationCount,
        });
      } catch (err) {
        await auditBinanceOb(
          sb,
          "database-failure",
          { target_ts: targetTs, market_kind: marketKind, error: String(err) },
          false,
        );
      }
    }
  }

  await auditBinanceOb(sb, "watchdog-run", {
    checked: checkedTargets.length,
    created: created.length,
    already_present: alreadyPresent,
  });
  return { checkedTargets, created, alreadyPresent };
}
