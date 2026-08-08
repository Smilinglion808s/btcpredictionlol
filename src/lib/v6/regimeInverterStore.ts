// V6 Regime Inverter — persistence, integrity verification, and warm start.
//
// State lives in `v6_regime_inverter_state`. It is only ever trusted when the
// revision, artifact hash, feature schema and stored entries all validate;
// otherwise it is cleared and rebuilt by chronological replay of resolved
// canonical V6 rows. Replay never inserts prediction rows.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  V6_ARTIFACT_SHA256,
  V6_FEATURE_SCHEMA_VERSION,
  V6_FIT_ID,
  V6_MODEL_VERSION,
} from "./config";
import {
  appendShadowEntry,
  buildShadowHistory,
  summarizeShadow,
  toShadowEntry,
  V6_REGIME_INVERTER_STATE_REVISION,
  V6_REGIME_INVERTER_THRESHOLD,
  V6_REGIME_INVERTER_WINDOW,
  type ShadowCandidate,
  type ShadowEntry,
  type ShadowSummary,
} from "./regimeInverter";

const TABLE = "v6_regime_inverter_state";

export interface InverterState {
  history: ShadowEntry[];
  summary: ShadowSummary;
  lastResolvedTargetTs: string | null;
  rebuilt: boolean;
}

/** Structural validation of persisted entries (no stale or corrupt state). */
export function validateHistory(value: unknown): ShadowEntry[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > V6_REGIME_INVERTER_WINDOW) return null;
  const seen = new Set<string>();
  const out: ShadowEntry[] = [];
  for (const raw of value) {
    const e = raw as Partial<ShadowEntry>;
    if (typeof e?.target_candle_ts !== "string") return null;
    const ts = new Date(e.target_candle_ts).toISOString();
    if (seen.has(ts)) return null;
    seen.add(ts);
    if (e.original_v6_base_prediction !== "GREEN" && e.original_v6_base_prediction !== "RED") return null;
    if (e.actual_direction !== "GREEN" && e.actual_direction !== "RED") return null;
    const correct = e.original_v6_base_prediction === e.actual_direction;
    const expectedAdj = correct ? 0.8 : -1;
    const expectedRaw = correct ? 1 : -1;
    if (Number(e.original_v6_shadow_adjusted_score) !== expectedAdj) return null;
    if (Number(e.original_v6_shadow_raw_score) !== expectedRaw) return null;
    out.push({
      target_candle_ts: ts,
      original_v6_base_prediction: e.original_v6_base_prediction,
      actual_direction: e.actual_direction,
      original_v6_shadow_raw_score: expectedRaw,
      original_v6_shadow_adjusted_score: expectedAdj,
    });
  }
  return out.sort((a, b) => a.target_candle_ts.localeCompare(b.target_candle_ts));
}

function rowToCandidate(r: Record<string, unknown>): ShadowCandidate {
  return {
    target_candle_ts: String(r.target_candle_ts),
    // Original base source wins: under V6-r4 the published `prediction_source`
    // becomes ABSTAIN when the structure gate vetoes, but the underlying
    // V6_BASE signal must still be graded by the inverter shadow.
    prediction_source:
      (r.original_v6_base_source as string | null) ??
      (r.pre_structure_source as string | null) ??
      (r.prediction_source as string | null) ??
      null,
    // Legacy rows predate `original_v6_base_prediction`; the base decision is
    // the original uninverted V6 direction for those rows by construction.
    original_v6_base_prediction:
      (r.original_v6_base_prediction as string | null) ??
      (r.base_v6_prediction as string | null) ??
      null,
    operational_status: (r.operational_status as string | null) ?? null,
    canonical_ground_truth_valid: (r.canonical_ground_truth_valid as boolean | null) ?? null,
    actual_direction: (r.canonical_actual_direction as string | null) ?? null,
  };
}

const SELECT =
  "target_candle_ts, prediction_source, original_v6_base_source, pre_structure_source, original_v6_base_prediction, base_v6_prediction, operational_status, canonical_ground_truth_valid, canonical_actual_direction, pre_weak_red_veto_prediction";

/** Latest eligible resolved ORIGINAL V6_BASE signals, oldest → newest. */
export async function replayShadowHistory(
  sb: SupabaseClient,
  beforeTs?: Date,
): Promise<ShadowEntry[]> {
  let q = sb
    .from("v6_predictions")
    .select(SELECT)
    .eq("model_version", V6_MODEL_VERSION)
    .or(
      "original_v6_base_source.eq.V6_BASE," +
        "and(original_v6_base_source.is.null,pre_structure_source.eq.V6_BASE)," +
        "and(original_v6_base_source.is.null,pre_structure_source.is.null,prediction_source.eq.V6_BASE)",
    )
    .eq("operational_status", "OK")
    .eq("canonical_ground_truth_valid", true)
    .in("canonical_actual_direction", ["GREEN", "RED"])
    .not("resolution_timestamp", "is", null);
  if (beforeTs) q = q.lt("target_candle_ts", beforeTs.toISOString());
  const { data } = await q
    .order("target_candle_ts", { ascending: false })
    .limit(V6_REGIME_INVERTER_WINDOW * 4);

  const rows = ((data ?? []) as unknown as Array<Record<string, unknown>>).map(rowToCandidate);
  return buildShadowHistory(rows);
}

async function persist(
  sb: SupabaseClient,
  history: ShadowEntry[],
  summary: ShadowSummary,
): Promise<void> {
  await sb.from(TABLE).upsert(
    {
      model_version: V6_MODEL_VERSION,
      regime_inverter_model_revision: V6_REGIME_INVERTER_STATE_REVISION,
      fit_id: V6_FIT_ID,
      model_artifact_sha256: V6_ARTIFACT_SHA256,
      feature_schema_version: V6_FEATURE_SCHEMA_VERSION,
      regime_inverter_history_json: history,
      regime_inverter_history_count: history.length,
      regime_inverter_last_resolved_target_ts:
        history.length > 0 ? history[history.length - 1].target_candle_ts : null,
      regime_inverter_ready: summary.ready,
      regime_inverter_active: summary.active,
      regime_inverter_last20_wins: summary.wins,
      regime_inverter_last20_losses: summary.losses,
      regime_inverter_last20_adjusted_net: summary.adjustedNet,
      regime_inverter_activation_threshold: V6_REGIME_INVERTER_THRESHOLD,
      regime_inverter_state_updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "model_version" },
  );
}

/**
 * Warm start: resume verified persisted state, otherwise rebuild by replay.
 * Always returns a summary safe to gate publication on.
 */
export async function ensureInverterState(
  sb: SupabaseClient,
  targetTs?: Date,
): Promise<InverterState> {
  const { data } = await sb.from(TABLE).select("*").eq("model_version", V6_MODEL_VERSION).maybeSingle();
  const state = (data as Record<string, unknown> | null) ?? null;

  const valid =
    state !== null &&
    (state.regime_inverter_model_revision === V6_REGIME_INVERTER_STATE_REVISION ||
      state.regime_inverter_model_revision === "V6-r2-regime-inverter-red-recovery") &&
    state.model_artifact_sha256 === V6_ARTIFACT_SHA256 &&
    state.feature_schema_version === V6_FEATURE_SCHEMA_VERSION;

  const history = valid ? validateHistory(state?.regime_inverter_history_json) : null;

  if (history) {
    const summary = summarizeShadow(history);
    return {
      history,
      summary,
      lastResolvedTargetTs:
        history.length > 0 ? history[history.length - 1].target_candle_ts : null,
      rebuilt: false,
    };
  }

  const rebuilt = await replayShadowHistory(sb, targetTs);
  const summary = summarizeShadow(rebuilt);
  await persist(sb, rebuilt, summary);
  return {
    history: rebuilt,
    summary,
    lastResolvedTargetTs:
      rebuilt.length > 0 ? rebuilt[rebuilt.length - 1].target_candle_ts : null,
    rebuilt: true,
  };
}

/**
 * Record a newly resolved row into the rolling history. Idempotent: replaying
 * the same target timestamp never mutates the window twice.
 */
export async function recordResolvedShadowSignal(
  sb: SupabaseClient,
  candidate: ShadowCandidate,
): Promise<ShadowSummary> {
  const current = await ensureInverterState(sb);
  const entry = toShadowEntry(candidate);
  if (!entry) return current.summary;
  const next = appendShadowEntry(current.history, entry);
  const summary = summarizeShadow(next);
  await persist(sb, next, summary);
  return summary;
}

/** Force a full rebuild from canonical resolved history. */
export async function rebuildInverterState(sb: SupabaseClient): Promise<InverterState> {
  const rebuilt = await replayShadowHistory(sb);
  const summary = summarizeShadow(rebuilt);
  await persist(sb, rebuilt, summary);
  return {
    history: rebuilt,
    summary,
    lastResolvedTargetTs:
      rebuilt.length > 0 ? rebuilt[rebuilt.length - 1].target_candle_ts : null,
    rebuilt: true,
  };
}
