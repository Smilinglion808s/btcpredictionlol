// a96 orchestrator: runs after AAS96 shadow writes its row. Reuses the
// existing AAS Layer A/B directions + internal base selector from that row,
// then applies the a96-r1 engine and writes to a96_predictions.
//
// Also handles resolution via the transactional resolve_a96_prediction RPC.
//
// External-model inputs (TD1/A2/router/model6 prediction) are explicitly
// rejected — a96 consumes AAS Layer A/B and candle OHLC only.

import type { SupabaseClient } from "@supabase/supabase-js";
import { a96Decide } from "./engine";
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

export async function runA96(sb: SupabaseClient, predictionId: string): Promise<void> {
  try {
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
    const fitState = await getOrMintFitEpisode(sb, artifactFitId);
    const priorCandles = await fetchPriorCandles(sb, targetTs);

    const engineInput = {
      layerADirection: a as "GREEN" | "RED",
      layerBDirection: b as "GREEN" | "RED",
      baseSelectedLayer: base as Layer,
      fitState,
      targetTimestamp: targetTs,
      targetOpen,
      priorCandles,
    };
    // Runtime guard.
    rejectExternalModelInputs(engineInput);

    const decision = a96Decide(engineInput);

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
      distance_from_4_candle_low_bps: decision.feature_values.distance_from_4_candle_low_bps,
      mean_2_candle_body_to_range: decision.feature_values.mean_2_candle_body_to_range,
      distance_veto_condition: decision.feature_values.distance_veto_condition,
      body_ratio_veto_condition: decision.feature_values.body_ratio_veto_condition,
      target_open: targetOpen,
      fit_resolved_count_at_prediction: fitState.comparable_resolved_count,
      layer_a_net_at_prediction: fitState.layer_a_net,
      layer_b_net_at_prediction: fitState.layer_b_net,
    } as never, { onConflict: "prediction_id" });
    if (upsertError) throw upsertError;
  } catch (e) {
    try {
      await sb.from("api_runs").insert({
        run_type: "a96-error",
        response_payload: { error: e instanceof Error ? e.message : String(e), prediction_id: predictionId },
        success: false,
        error_message: e instanceof Error ? e.message : String(e),
      });
    } catch { /* ignore */ }
  }
}

export async function resolveA96(sb: SupabaseClient, predictionId: string): Promise<void> {
  try {
    const { data: row } = await sb
      .from("a96_predictions").select("prediction_id, resolved_at").eq("prediction_id", predictionId).maybeSingle();
    if (!row) return;
    if ((row as Record<string, unknown>).resolved_at) return;

    const { data: pred } = await sb
      .from("predictions")
      .select("actual_next_candle_open, actual_next_candle_close")
      .eq("id", predictionId).maybeSingle();
    if (!pred) return;
    const p = pred as Record<string, unknown>;
    const open = p.actual_next_candle_open == null ? null : Number(p.actual_next_candle_open);
    const close = p.actual_next_candle_close == null ? null : Number(p.actual_next_candle_close);
    if (open == null || close == null || !isFinite(open) || !isFinite(close)) return;

    const { error } = await sb.rpc("resolve_a96_prediction", {
      p_prediction_id: predictionId,
      p_actual_open: open,
      p_actual_close: close,
    });
    if (error) throw error;
  } catch (e) {
    try {
      await sb.from("api_runs").insert({
        run_type: "a96-resolve-error",
        response_payload: { error: e instanceof Error ? e.message : String(e), prediction_id: predictionId },
        success: false,
        error_message: e instanceof Error ? e.message : String(e),
      });
    } catch { /* ignore */ }
  }
}
