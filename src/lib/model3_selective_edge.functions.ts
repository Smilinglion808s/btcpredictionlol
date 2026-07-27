// Server functions for Model 3 — Selective Edge R1.
import { createServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

type Row = Record<string, string | number | boolean | null>;

function toSerializable(r: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(r)) {
    if (v === null || v === undefined) out[k] = null;
    else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else out[k] = JSON.stringify(v);
  }
  return out;
}

export const getM3SeStats = createServerFn({ method: "GET" }).handler(async () => {
  const { data: rows } = await supabase
    .from("model3_se_predictions")
    .select("published_prediction, published_result, raw_result, resolved_at, selector_net_effect, raw_would_win, abstained_winner, abstained_loser")
    .order("target_candle_ts", { ascending: false })
    .limit(5000);
  const r = (rows ?? []) as Array<Record<string, unknown>>;
  const resolved = r.filter((x) => x.resolved_at);
  const pending = r.length - resolved.length;
  const pub = resolved.filter((x) => x.published_prediction !== "ABSTAIN");
  const pubWins = pub.filter((x) => x.published_result === "WIN").length;
  const pubLoss = pub.filter((x) => x.published_result === "LOSS").length;
  const pubPush = pub.filter((x) => x.published_result === "PUSH").length;
  const abstains = resolved.length - pub.length;
  const rawWins = resolved.filter((x) => x.raw_result === "WIN").length;
  const rawLoss = resolved.filter((x) => x.raw_result === "LOSS").length;
  const rawPush = resolved.filter((x) => x.raw_result === "PUSH").length;
  const totalPub = pubWins + pubLoss;
  const totalRaw = rawWins + rawLoss;
  const abstainedWinners = resolved.filter((x) => x.abstained_winner === true).length;
  const abstainedLosers = resolved.filter((x) => x.abstained_loser === true).length;
  return {
    resolved_count: resolved.length,
    pending,
    published: {
      wins: pubWins, losses: pubLoss, pushes: pubPush, total: pub.length,
      win_rate: totalPub > 0 ? +(pubWins / totalPub * 100).toFixed(2) : 0,
    },
    raw: {
      wins: rawWins, losses: rawLoss, pushes: rawPush,
      win_rate: totalRaw > 0 ? +(rawWins / totalRaw * 100).toFixed(2) : 0,
    },
    abstains,
    coverage: resolved.length ? +(pub.length / resolved.length).toFixed(3) : 0,
    selector_abstained_winners: abstainedWinners,
    selector_abstained_losers: abstainedLosers,
    selector_net: abstainedLosers - abstainedWinners,
  };
});

export const getM3SePending = createServerFn({ method: "GET" }).handler(async () => {
  const { data } = await supabase
    .from("model3_se_predictions")
    .select("target_candle_ts, published_prediction, raw_prediction, abstain_reason, abstain_category, abstain_detail, selector_margin, p_correct_calibrated, p_green_stacked_calibrated, selection_threshold")
    .order("target_candle_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Row | null) ?? null;
});

export const exportM3SePredictionsCsv = createServerFn({ method: "GET" }).handler(async (): Promise<Row[]> => {
  const PAGE = 1000;
  const all: Row[] = [];
  for (let off = 0; off < 25_000; off += PAGE) {
    const { data, error } = await supabase
      .from("model3_se_predictions")
      .select("*")
      .order("target_candle_ts", { ascending: false })
      .range(off, off + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as Array<Record<string, unknown>>;
    for (const r of batch) all.push(toSerializable(r));
    if (batch.length < PAGE) break;
  }
  return all;
});

export const exportM3SeFitsCsv = createServerFn({ method: "GET" }).handler(async (): Promise<Row[]> => {
  const { data } = await supabase
    .from("model3_se_fits")
    .select("fit_id, model_version, feature_schema_version, feature_schema_hash, artifact_hash, status, failure_reason, fitted_at, activated_at, retired_at, slow_training_start, slow_training_end, slow_training_rows, fast_training_start, fast_training_end, fast_training_rows, oof_start, oof_end, oof_rows, oof_block_size, calibration_start, calibration_end, calibration_rows, slow_lambda, fast_lambda, stacker_lambda, selector_lambda, selection_threshold, target_coverage, estimated_coverage, oof_direction_accuracy, oof_direction_brier, oof_direction_log_loss, calibration_direction_accuracy, calibration_direction_brier, calibration_direction_log_loss, selector_roc_auc, selector_pr_auc, selector_brier, selector_log_loss")
    .order("fitted_at", { ascending: false });
  return ((data ?? []) as Array<Record<string, unknown>>).map(toSerializable);
});

export const exportM3SeBlocksCsv = createServerFn({ method: "GET" }).handler(async (): Promise<Row[]> => {
  const { data } = await supabase
    .from("model3_se_blocks")
    .select("*")
    .order("block_end_ts", { ascending: false });
  return ((data ?? []) as Array<Record<string, unknown>>).map(toSerializable);
});
