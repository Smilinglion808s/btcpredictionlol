// V6-r3 BROAD_RED Reliability Governor — persistence, validation, warm start.
//
// State lives in `v6_broad_red_state`. It is only trusted when the revision,
// artifact hash, feature schema and stored entries all validate; otherwise it
// is rebuilt by chronological replay of resolved canonical V6 rows. Replay
// never inserts prediction rows and never reads target-candle data before the
// prediction it belongs to.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  V6_ARTIFACT_SHA256,
  V6_FEATURE_SCHEMA_VERSION,
  V6_FIT_ID,
  V6_MODEL_VERSION,
} from "./config";
import {
  appendBroadRedEntry,
  buildBroadRedHistory,
  summarizeBroadRed,
  toBroadRedEntry,
  BROAD_RED_RELIABILITY_THRESHOLD,
  BROAD_RED_RELIABILITY_WINDOW,
  V6_R3_MODEL_REVISION,
  type BroadRedCandidate,
  type BroadRedEntry,
  type BroadRedSummary,
} from "./r3";

const TABLE = "v6_broad_red_state";

export interface BroadRedState {
  history: BroadRedEntry[];
  summary: BroadRedSummary;
  lastResolvedTargetTs: string | null;
  rebuilt: boolean;
}

/** Structural validation of persisted entries (no stale, duplicated or corrupt state). */
export function validateBroadRedHistory(value: unknown): BroadRedEntry[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > BROAD_RED_RELIABILITY_WINDOW) return null;
  const seen = new Set<string>();
  const out: BroadRedEntry[] = [];
  for (const raw of value) {
    const e = raw as Partial<BroadRedEntry>;
    if (typeof e?.target_candle_ts !== "string") return null;
    const ts = new Date(e.target_candle_ts).toISOString();
    if (seen.has(ts)) return null;
    seen.add(ts);
    // Every history row must be an ORIGINAL broad-selected RED signal.
    if (e.broad_red_shadow_prediction !== "RED") return null;
    if (e.actual_direction !== "GREEN" && e.actual_direction !== "RED") return null;
    const correct = e.actual_direction === "RED";
    const expectedAdj = correct ? 0.8 : -1;
    const expectedRaw = correct ? 1 : -1;
    if (Number(e.broad_red_shadow_adjusted_score) !== expectedAdj) return null;
    if (Number(e.broad_red_shadow_raw_score) !== expectedRaw) return null;
    out.push({
      target_candle_ts: ts,
      broad_red_shadow_prediction: "RED",
      actual_direction: e.actual_direction,
      broad_red_shadow_raw_score: expectedRaw,
      broad_red_shadow_adjusted_score: expectedAdj,
    });
  }
  return out.sort((a, b) => a.target_candle_ts.localeCompare(b.target_candle_ts));
}

const SELECT =
  "target_candle_ts, selected_component, base_v6_prediction, original_v6_base_source, prediction_source, operational_status, canonical_ground_truth_valid, canonical_actual_direction, broad_percentile, anchor_percentile";

function rowToCandidate(r: Record<string, unknown>): BroadRedCandidate {
  // Rows written before r3 have no persisted `selected_component`; the frozen
  // tie rule reproduces it exactly from the stored percentiles.
  let component = (r.selected_component as string | null) ?? null;
  if (!component) {
    const broad = Number(r.broad_percentile);
    const anchor = Number(r.anchor_percentile);
    component =
      Number.isFinite(broad) && Number.isFinite(anchor)
        ? Math.abs(broad - 0.5) >= Math.abs(anchor - 0.5)
          ? "BROAD"
          : "ANCHOR"
        : "NONE";
  }
  return {
    target_candle_ts: String(r.target_candle_ts),
    selected_component: component,
    base_v6_prediction: (r.base_v6_prediction as string | null) ?? null,
    base_v6_prediction_source:
      (r.original_v6_base_source as string | null) ??
      (r.prediction_source as string | null) ??
      null,
    operational_status: (r.operational_status as string | null) ?? null,
    canonical_ground_truth_valid: (r.canonical_ground_truth_valid as boolean | null) ?? null,
    actual_direction: (r.canonical_actual_direction as string | null) ?? null,
  };
}

/** Latest eligible resolved ORIGINAL BROAD_RED signals, oldest → newest. */
export async function replayBroadRedHistory(
  sb: SupabaseClient,
  beforeTs?: Date,
): Promise<BroadRedEntry[]> {
  let q = sb
    .from("v6_predictions")
    .select(SELECT)
    .eq("model_version", V6_MODEL_VERSION)
    .eq("operational_status", "OK")
    .eq("canonical_ground_truth_valid", true)
    .eq("base_v6_prediction", "RED")
    .in("canonical_actual_direction", ["GREEN", "RED"])
    .not("resolution_timestamp", "is", null);
  if (beforeTs) q = q.lt("target_candle_ts", beforeTs.toISOString());
  const { data } = await q
    .order("target_candle_ts", { ascending: false })
    .limit(BROAD_RED_RELIABILITY_WINDOW * 20);

  const rows = ((data ?? []) as unknown as Array<Record<string, unknown>>).map(rowToCandidate);
  return buildBroadRedHistory(rows);
}

async function persist(
  sb: SupabaseClient,
  history: BroadRedEntry[],
  summary: BroadRedSummary,
): Promise<void> {
  await sb.from(TABLE).upsert(
    {
      model_version: V6_MODEL_VERSION,
      model_revision: V6_R3_MODEL_REVISION,
      fit_id: V6_FIT_ID,
      model_artifact_sha256: V6_ARTIFACT_SHA256,
      feature_schema_version: V6_FEATURE_SCHEMA_VERSION,
      broad_red_history_json: history,
      broad_red_history_count: history.length,
      broad_red_last_resolved_target_ts:
        history.length > 0 ? history[history.length - 1].target_candle_ts : null,
      broad_red_last12_wins: summary.wins,
      broad_red_last12_losses: summary.losses,
      broad_red_last12_adjusted_net: summary.adjustedNet,
      broad_red_reliability_ready: summary.ready,
      broad_red_reliability_veto_active: summary.active,
      broad_red_reliability_threshold: BROAD_RED_RELIABILITY_THRESHOLD,
      broad_red_state_updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "model_version" },
  );
}

/** Warm start: resume verified persisted state, otherwise rebuild by replay. */
export async function ensureBroadRedState(
  sb: SupabaseClient,
  targetTs?: Date,
): Promise<BroadRedState> {
  const { data } = await sb
    .from(TABLE)
    .select("*")
    .eq("model_version", V6_MODEL_VERSION)
    .maybeSingle();
  const state = (data as Record<string, unknown> | null) ?? null;

  const valid =
    state !== null &&
    state.model_revision === V6_R3_MODEL_REVISION &&
    state.model_artifact_sha256 === V6_ARTIFACT_SHA256 &&
    state.feature_schema_version === V6_FEATURE_SCHEMA_VERSION;

  const history = valid ? validateBroadRedHistory(state?.broad_red_history_json) : null;

  if (history) {
    return {
      history,
      summary: summarizeBroadRed(history),
      lastResolvedTargetTs:
        history.length > 0 ? history[history.length - 1].target_candle_ts : null,
      rebuilt: false,
    };
  }

  const rebuilt = await replayBroadRedHistory(sb, targetTs);
  const summary = summarizeBroadRed(rebuilt);
  await persist(sb, rebuilt, summary);
  return {
    history: rebuilt,
    summary,
    lastResolvedTargetTs:
      rebuilt.length > 0 ? rebuilt[rebuilt.length - 1].target_candle_ts : null,
    rebuilt: true,
  };
}

/** Record a newly resolved BROAD_RED outcome. Idempotent per target timestamp. */
export async function recordResolvedBroadRedSignal(
  sb: SupabaseClient,
  candidate: BroadRedCandidate,
): Promise<BroadRedSummary> {
  const current = await ensureBroadRedState(sb);
  const entry = toBroadRedEntry(candidate);
  if (!entry) return current.summary;
  const next = appendBroadRedEntry(current.history, entry);
  const summary = summarizeBroadRed(next);
  await persist(sb, next, summary);
  return summary;
}

/** Force a full rebuild from canonical resolved history. */
export async function rebuildBroadRedState(sb: SupabaseClient): Promise<BroadRedState> {
  const rebuilt = await replayBroadRedHistory(sb);
  const summary = summarizeBroadRed(rebuilt);
  await persist(sb, rebuilt, summary);
  return {
    history: rebuilt,
    summary,
    lastResolvedTargetTs:
      rebuilt.length > 0 ? rebuilt[rebuilt.length - 1].target_candle_ts : null,
    rebuilt: true,
  };
}
