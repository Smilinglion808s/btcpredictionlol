// V6-r5.1 Route Drawdown Brake — persistence, warm start, idempotent updates.
//
// State lives in `v6_r5_route_brake_state`, one independent row per route.
// It is only trusted when the revision matches; otherwise it is rebuilt by a
// chronological replay of RESOLVED r5 candidate history. Replay never inserts
// prediction rows and never consults the unresolved current target.

import type { SupabaseClient } from "@supabase/supabase-js";

import { V6_MODEL_VERSION } from "./config";
import {
  applyShadowOutcome,
  emptyRouteBrakeState,
  R5_ROUTE_ANCHOR_RED,
  R5_ROUTE_GREEN,
  V6_R5_1_MODEL_REVISION,
  type RouteBrakeState,
  type ShadowResult,
} from "./routeBrake";

const TABLE = "v6_r5_route_brake_state";
const PAGE = 1000;
const MAX_PAGES = 20;

export interface RouteBrakeStates {
  green: RouteBrakeState;
  anchorRed: RouteBrakeState;
  rebuilt: boolean;
}

function normalizeResult(value: unknown): ShadowResult {
  return value === "WIN" || value === "LOSS" || value === "PUSH" ? value : null;
}

function rowToState(routeKey: string, r: Record<string, unknown> | null): RouteBrakeState {
  if (!r) return emptyRouteBrakeState(routeKey);
  const losses = Number(r.consecutive_shadow_losses);
  return {
    routeKey,
    pauseActive: Boolean(r.pause_active),
    consecutiveShadowLosses: Number.isFinite(losses) && losses >= 0 ? Math.trunc(losses) : 0,
    lastShadowResult: normalizeResult(r.last_shadow_result),
    lastShadowTargetTs: r.last_shadow_target_ts ? new Date(String(r.last_shadow_target_ts)).toISOString() : null,
    lastShadowPrediction: (r.last_shadow_prediction as string | null) ?? null,
  };
}

async function persist(sb: SupabaseClient, state: RouteBrakeState): Promise<void> {
  await sb.from(TABLE).upsert(
    {
      route_key: state.routeKey,
      model_version: V6_MODEL_VERSION,
      model_revision: V6_R5_1_MODEL_REVISION,
      pause_active: state.pauseActive,
      consecutive_shadow_losses: state.consecutiveShadowLosses,
      last_shadow_result: state.lastShadowResult,
      last_shadow_target_ts: state.lastShadowTargetTs,
      last_shadow_prediction: state.lastShadowPrediction,
      state_updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "model_revision,route_key" },
  );
}

/** Chronological replay of resolved r5 candidate history for both routes. */
export async function replayRouteBrakeStates(
  sb: SupabaseClient,
  beforeTs?: Date,
): Promise<{ green: RouteBrakeState; anchorRed: RouteBrakeState }> {
  let green = emptyRouteBrakeState(R5_ROUTE_GREEN);
  let anchorRed = emptyRouteBrakeState(R5_ROUTE_ANCHOR_RED);

  for (let page = 0; page < MAX_PAGES; page += 1) {
    let q = sb
      .from("v6_predictions")
      .select(
        "target_candle_ts, operational_status, r5_green_candidate, r5_green_shadow_result, r5_red_anchor_candidate, r5_red_anchor_shadow_result",
      )
      .eq("model_version", V6_MODEL_VERSION)
      .not("resolution_timestamp", "is", null);
    if (beforeTs) q = q.lt("target_candle_ts", beforeTs.toISOString());
    const { data } = await q
      .order("target_candle_ts", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);

    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    for (const r of rows) {
      if (String(r.operational_status) !== "OK") continue;
      const ts = new Date(String(r.target_candle_ts)).toISOString();
      if (r.r5_green_candidate) {
        green = applyShadowOutcome(green, normalizeResult(r.r5_green_shadow_result), ts, "GREEN");
      }
      if (r.r5_red_anchor_candidate) {
        anchorRed = applyShadowOutcome(
          anchorRed,
          normalizeResult(r.r5_red_anchor_shadow_result),
          ts,
          "RED",
        );
      }
    }
    if (rows.length < PAGE) break;
  }

  return { green, anchorRed };
}

/** Warm start: resume verified persisted state, otherwise rebuild by replay. */
export async function ensureRouteBrakeStates(
  sb: SupabaseClient,
  targetTs?: Date,
): Promise<RouteBrakeStates> {
  const { data } = await sb
    .from(TABLE)
    .select("*")
    .eq("model_revision", V6_R5_1_MODEL_REVISION);
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const greenRow = rows.find((r) => r.route_key === R5_ROUTE_GREEN) ?? null;
  const anchorRow = rows.find((r) => r.route_key === R5_ROUTE_ANCHOR_RED) ?? null;

  if (greenRow && anchorRow) {
    return {
      green: rowToState(R5_ROUTE_GREEN, greenRow),
      anchorRed: rowToState(R5_ROUTE_ANCHOR_RED, anchorRow),
      rebuilt: false,
    };
  }

  const replayed = await replayRouteBrakeStates(sb, targetTs);
  await persist(sb, replayed.green);
  await persist(sb, replayed.anchorRed);
  return { ...replayed, rebuilt: true };
}

/**
 * Record one resolved eligible shadow outcome for a route.
 * Idempotent: a target timestamp at or before the last processed one is ignored,
 * so resolving the same candle twice can never move the streak twice.
 */
export async function recordResolvedRouteOutcome(
  sb: SupabaseClient,
  routeKey: string,
  outcome: ShadowResult,
  targetTs: string,
  prediction: string,
): Promise<{ before: RouteBrakeState; after: RouteBrakeState }> {
  const states = await ensureRouteBrakeStates(sb);
  const before = routeKey === R5_ROUTE_GREEN ? states.green : states.anchorRed;
  const ts = new Date(targetTs).toISOString();
  if (before.lastShadowTargetTs && ts <= before.lastShadowTargetTs) {
    return { before, after: before };
  }
  const after = applyShadowOutcome(before, outcome, ts, prediction);
  if (after !== before) await persist(sb, after);
  return { before, after };
}

/** Force a full rebuild from canonical resolved history. */
export async function rebuildRouteBrakeStates(sb: SupabaseClient): Promise<RouteBrakeStates> {
  const replayed = await replayRouteBrakeStates(sb);
  await persist(sb, replayed.green);
  await persist(sb, replayed.anchorRed);
  return { ...replayed, rebuilt: true };
}
