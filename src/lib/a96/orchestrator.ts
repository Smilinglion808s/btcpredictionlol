// a96 orchestrator: runs after AAS96 shadow writes its row. Reuses the
// existing AAS Layer A/B directions + internal base selector from that row,
// then applies the a96-r1 engine and writes to a96_predictions.
//
// Resolution is handled by the transactional resolve_a96_prediction RPC and
// always uses OHLC from the `candles` table for the target candle timestamp
// (never any upstream/exported direction label). Every prediction generation
// first runs a catch-up resolver so fit state is fresh.
//
// External-model inputs (TD1/A2/router/model6) are rejected at runtime.

import type { SupabaseClient } from "@supabase/supabase-js";
import { a96Decide } from "./engine";
import { agreementFeatures, CandleHistoryError } from "./features";
import type { Candle, FitState, Layer } from "./types";
import { A96_MODEL_NAME, A96_MODEL_VERSION } from "./config";

const FORBIDDEN_KEY_TOKENS = ["td1", "a2_", "router", "model6_prediction", "external_final_decision", "opposite_model"];
function rejectExternalModelInputs(obj: unknown, path = ""): void {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const kl = k.toLowerCase();
      if (FORBIDDEN_KEY_TOKENS.some((t) => kl.includes(t))) {
        throw new Error(`a96 forbids external-model inputs: ${path ? path + "." : ""}${k}`);
      }
      rejectExternalModelInputs(v, path ? `${path}.${k}` : k);
    }
  }
}

async function logApiError(sb: SupabaseClient, runType: string, payload: Record<string, unknown>, err: unknown): Promise<void> {
  try {
    await sb.from("api_runs").insert({
      run_type: runType,
      response_payload: { ...payload, error: err instanceof Error ? err.message : String(err) },
      success: false,
      error_message: err instanceof Error ? err.message : String(err),
    });
  } catch { /* ignore */ }
}

async function getOrMintFitEpisode(sb: SupabaseClient, artifactFitId: string): Promise<FitState> {
  const { data, error } = await sb.rpc("get_or_mint_a96_fit_episode", { p_artifact_fit_id: artifactFitId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("get_or_mint_a96_fit_episode returned no row");
  const s = row as Record<string, unknown>;
  return {
    fit_episode_id: String(s.fit_episode_id),
    artifact_fit_id: String(s.artifact_fit_id),
    comparable_resolved_count: Number(s.comparable_resolved_count ?? 0),
    layer_a_wins: Number(s.layer_a_wins ?? 0),
    layer_a_losses: Number(s.layer_a_losses ?? 0),
    layer_a_net: Number(s.layer_a_net ?? 0),
    layer_b_wins: Number(s.layer_b_wins ?? 0),
    layer_b_losses: Number(s.layer_b_losses ?? 0),
    layer_b_net: Number(s.layer_b_net ?? 0),
  };
}

async function fetchPriorCandles(sb: SupabaseClient, targetTs: Date): Promise<Candle[]> {
  const { data } = await sb
    .from("candles")
    .select("candle_ts, open, high, low, close")
    .eq("symbol", "BTC-USDT")
    .eq("timeframe", "15m")
    .lt("candle_ts", targetTs.toISOString())
    .order("candle_ts", { ascending: false })
    .limit(4);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    timestamp: new Date(String(r.candle_ts)),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
  })).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

async function fetchTargetCandle(sb: SupabaseClient, targetTs: Date): Promise<
  { open: number; high: number; low: number; close: number; volume: number | null } | null
> {
  const { data } = await sb
    .from("candles")
    .select("open, high, low, close, volume, confirm")
    .eq("symbol", "BTC-USDT")
    .eq("timeframe", "15m")
    .eq("candle_ts", targetTs.toISOString())
    .maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  const confirm = r.confirm as boolean | null;
  if (confirm === false) return null;
  const open = Number(r.open), high = Number(r.high), low = Number(r.low), close = Number(r.close);
  if (![open, high, low, close].every((n) => isFinite(n) && n > 0)) return null;
  const volRaw = r.volume;
  const volume = volRaw == null ? null : Number(volRaw);
  return { open, high, low, close, volume: volume != null && isFinite(volume) ? volume : null };
}

/**
 * Resolve every unresolved a96 prediction whose target candle is at least 15
 * minutes old. Uses candles-table OHLC as ground truth. Idempotent per row
 * (the RPC no-ops if resolved_at is set). Errors per row are logged, not thrown.
 */
export async function resolveDueA96Predictions(sb: SupabaseClient): Promise<{ attempted: number; resolved: number; failed: number }> {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data } = await sb
    .from("a96_predictions")
    .select("prediction_id, target_candle_ts, fit_episode_id")
    .is("resolved_at", null)
    .lte("target_candle_ts", cutoff)
    .order("target_candle_ts", { ascending: true })
    .limit(200);
  const rows = (data ?? []) as Array<{ prediction_id: string; target_candle_ts: string; fit_episode_id: string }>;
  let resolved = 0, failed = 0;
  for (const row of rows) {
    const ok = await resolveA96Once(sb, row.prediction_id);
    if (ok) resolved += 1; else failed += 1;
  }
  return { attempted: rows.length, resolved, failed };
}

async function resolveA96Once(sb: SupabaseClient, predictionId: string): Promise<boolean> {
  try {
    const { data: row } = await sb
      .from("a96_predictions")
      .select("prediction_id, target_candle_ts, resolved_at, fit_episode_id")
      .eq("prediction_id", predictionId)
      .maybeSingle();
    if (!row) return false;
    const r = row as Record<string, unknown>;
    if (r.resolved_at) return true;
    const targetTs = new Date(String(r.target_candle_ts));
    if (Date.now() < targetTs.getTime() + 15 * 60 * 1000) return false; // not due yet
    const ohlc = await fetchTargetCandle(sb, targetTs);
    if (!ohlc) {
      await sb.from("a96_predictions").update({
        resolution_attempt_count: undefined, // handled by RPC path; but log via api_runs
      } as never).eq("prediction_id", predictionId);
      await logApiError(sb, "a96-resolve-missing-candle", {
        prediction_id: predictionId, target_candle_ts: targetTs.toISOString(), fit_episode_id: r.fit_episode_id,
      }, new Error("target candle not confirmed / not in candles table"));
      // Still stamp last_resolution_error so it shows up in the CSV.
      await sb.from("a96_predictions").update({
        last_resolution_error: "target_candle_unavailable",
        last_resolution_attempt_at: new Date().toISOString(),
      } as never).eq("prediction_id", predictionId);
      return false;
    }
    const { data: rpc, error } = await sb.rpc("resolve_a96_prediction", {
      p_prediction_id: predictionId,
      p_actual_open: ohlc.open,
      p_actual_close: ohlc.close,
      p_actual_high: ohlc.high,
      p_actual_low: ohlc.low,
      p_actual_volume: ohlc.volume,
    });
    if (error) throw error;
    const rpcRow = (Array.isArray(rpc) ? rpc[0] : rpc) as Record<string, unknown> | null;
    if (rpcRow && rpcRow.ok === false) {
      await logApiError(sb, "a96-resolve-rpc-reject", {
        prediction_id: predictionId, target_candle_ts: targetTs.toISOString(), fit_episode_id: r.fit_episode_id,
        reason: rpcRow.reason,
      }, new Error(String(rpcRow.reason ?? "rpc rejected")));
      return false;
    }
    return true;
  } catch (e) {
    await logApiError(sb, "a96-resolve-error", { prediction_id: predictionId }, e);
    try {
      await sb.from("a96_predictions").update({
        last_resolution_error: e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500),
        last_resolution_attempt_at: new Date().toISOString(),
      } as never).eq("prediction_id", predictionId);
    } catch { /* ignore */ }
    return false;
  }
}

/** Public wrapper — kept for external callers (called by shadow.ts on production resolve). */
export async function resolveA96(sb: SupabaseClient, predictionId: string): Promise<void> {
  await resolveA96Once(sb, predictionId);
}

export async function runA96(sb: SupabaseClient, predictionId: string): Promise<void> {
  try {
    // Catch up on any due predictions BEFORE reading current fit state, so the
    // snapshot we persist reflects reality.
    try { await resolveDueA96Predictions(sb); } catch (e) { await logApiError(sb, "a96-catchup-error", {}, e); }

    // Load AAS shadow row for this prediction (Layer A/B directions + base selector).
    const { data: shadow } = await sb
      .from("model7_aas96_shadow")
      .select("layer_a_final_direction, layer_b_final_direction, selector_pre_override_selected_layer, eligibility_passed")
      .eq("prediction_id", predictionId)
      .maybeSingle();
    if (!shadow) return;
    const s = shadow as Record<string, unknown>;
    const a = s.layer_a_final_direction as string | null;
    const b = s.layer_b_final_direction as string | null;
    const base = s.selector_pre_override_selected_layer as string | null;
    if ((a !== "GREEN" && a !== "RED") || (b !== "GREEN" && b !== "RED")) return;
    if (base !== "A" && base !== "B") return;

    // Load prediction (for target ts + target_open proxy).
    const { data: pred } = await sb
      .from("predictions")
      .select("id, candle_ts, btc_price_at_prediction")
      .eq("id", predictionId)
      .maybeSingle();
    if (!pred) return;
    const targetTs = new Date(String((pred as Record<string, unknown>).candle_ts));
    const targetOpen = Number((pred as Record<string, unknown>).btc_price_at_prediction);
    if (!isFinite(targetOpen) || targetOpen <= 0) return;

    // Active AAS fit id.
    const { data: fit } = await sb
      .from("model7_aas96_fits").select("fit_id")
      .eq("active", true).order("fitted_at", { ascending: false }).limit(1).maybeSingle();
    if (!fit) return;
    const artifactFitId = String((fit as Record<string, unknown>).fit_id);

    // Freshly load fit-episode state AFTER catch-up resolution.
    const fitState = await getOrMintFitEpisode(sb, artifactFitId);
    const priorCandles = await fetchPriorCandles(sb, targetTs);

    // Always compute agreement candle features + snapshot (regardless of agreement branch).
    let feature_history_valid = true;
    let feature_history_error: string | null = null;
    let features: { distance_from_4_candle_low_bps: number; mean_2_candle_body_to_range: number } | null = null;
    try {
      features = agreementFeatures({ priorCandles, targetTimestamp: targetTs, targetOpen });
    } catch (e) {
      feature_history_valid = false;
      feature_history_error = e instanceof CandleHistoryError ? e.message : (e instanceof Error ? e.message : String(e));
    }
    const priorSnapshot = priorCandles.map((c) => ({
      timestamp: c.timestamp.toISOString(), open: c.open, high: c.high, low: c.low, close: c.close,
    }));

    const engineInput = {
      layerADirection: a as "GREEN" | "RED",
      layerBDirection: b as "GREEN" | "RED",
      baseSelectedLayer: base as Layer,
      fitState,
      targetTimestamp: targetTs,
      targetOpen,
      priorCandles,
    };
    rejectExternalModelInputs(engineInput);
    const decision = a96Decide(engineInput);

    // Feature values: prefer engine-produced (agreement branch); otherwise use raw computed features.
    const distanceBps = decision.feature_values.distance_from_4_candle_low_bps
      ?? (features ? features.distance_from_4_candle_low_bps : null);
    const meanBody = decision.feature_values.mean_2_candle_body_to_range
      ?? (features ? features.mean_2_candle_body_to_range : null);

    const { error: upsertError } = await sb.from("a96_predictions").upsert({
      prediction_id: predictionId,
      source_prediction_id: predictionId,
      model_name: A96_MODEL_NAME,
      model_version: A96_MODEL_VERSION,
      fit_episode_id: fitState.fit_episode_id,
      artifact_fit_id: artifactFitId,
      target_candle_ts: targetTs.toISOString(),
      layer_a_direction: a,
      layer_b_direction: b,
      base_selected_layer: base,
      selected_layer: decision.selected_layer,
      final_prediction: decision.prediction,
      decision_reason: decision.reason,
      fit_selector_override_fired: decision.fit_selector_override_fired,
      agreement_veto_fired: decision.agreement_veto_fired,
      distance_from_4_candle_low_bps: distanceBps,
      mean_2_candle_body_to_range: meanBody,
      distance_veto_condition: decision.feature_values.distance_veto_condition,
      body_ratio_veto_condition: decision.feature_values.body_ratio_veto_condition,
      target_open: targetOpen,
      fit_resolved_count_at_prediction: fitState.comparable_resolved_count,
      layer_a_net_at_prediction: fitState.layer_a_net,
      layer_b_net_at_prediction: fitState.layer_b_net,
      feature_history_valid,
      feature_history_error,
      prior_candles_snapshot: priorSnapshot,
    } as never, { onConflict: "prediction_id" });
    if (upsertError) throw upsertError;
  } catch (e) {
    await logApiError(sb, "a96-error", { prediction_id: predictionId }, e);
  }
}
