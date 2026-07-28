// Server functions for Model 3 — Selective Edge R2.
import { createServerFn } from "@tanstack/react-start";
import { M3SE_MODEL_VERSION } from "@/lib/model3_selective_edge/config";

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

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

/** Live stats for the active model version (R2). R1 rows are excluded. */
export const getM3SeStats = createServerFn({ method: "GET" }).handler(async () => {
  const { data: rows } = await (await getAdmin())
    .from("model3_se_predictions")
    .select("published_prediction, published_result, raw_result, resolved_at, selector_net_effect, raw_would_win, abstained_winner, abstained_loser")
    .eq("model_version", M3SE_MODEL_VERSION)
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
    model_version: M3SE_MODEL_VERSION,
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

/** Most recent pending prediction for the active version. */
export const getM3SePending = createServerFn({ method: "GET" }).handler(async () => {
  const { data } = await (await getAdmin())
    .from("model3_se_predictions")
    .select("target_candle_ts, published_prediction, raw_prediction, abstain_reason, abstain_category, abstain_detail, selector_margin, selector_score_raw, selector_score_percentile, p_correct_calibrated, p_green_stacked_calibrated, selection_threshold, signed_consensus, expert_agreement, expert_disagreement, stacker_logit_margin")
    .eq("model_version", M3SE_MODEL_VERSION)
    .order("target_candle_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Row | null) ?? null;
});

/** 96-row rolling summary for the active R2 version. */
export const getM3SeR2Summary = createServerFn({ method: "GET" }).handler(async () => {
  const { data } = await (await getAdmin())
    .from("model3_se_predictions")
    .select("published_prediction, published_result, raw_prediction, raw_result, actual_direction, selector_score_raw, expert_agreement, resolved_at")
    .eq("model_version", M3SE_MODEL_VERSION)
    .not("resolved_at", "is", null)
    .neq("actual_direction", "PUSH")
    .order("resolved_at", { ascending: false })
    .limit(96);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const n = rows.length;
  if (n === 0) {
    return { window_size: 0 };
  }
  const pubDirectional = rows.filter((r) => r.published_prediction !== "ABSTAIN");
  const rawWin = rows.filter((r) => r.raw_result === "WIN").length;
  const pubWin = pubDirectional.filter((r) => r.published_result === "WIN").length;
  const pubLoss = pubDirectional.filter((r) => r.published_result === "LOSS").length;
  const greenPreds = rows.filter((r) => r.raw_prediction === "GREEN");
  const redPreds = rows.filter((r) => r.raw_prediction === "RED");
  const greenAcc = greenPreds.length
    ? greenPreds.filter((r) => r.raw_result === "WIN").length / greenPreds.length : 0;
  const redAcc = redPreds.length
    ? redPreds.filter((r) => r.raw_result === "WIN").length / redPreds.length : 0;
  const agree = rows.filter((r) => Number(r.expert_agreement) === 1);
  const disagree = rows.filter((r) => Number(r.expert_agreement) === 0);
  const agreeAcc = agree.length
    ? agree.filter((r) => r.raw_result === "WIN").length / agree.length : 0;
  const disagreeAcc = disagree.length
    ? disagree.filter((r) => r.raw_result === "WIN").length / disagree.length : 0;
  const scored = rows
    .filter((r) => typeof r.selector_score_raw === "number")
    .map((r) => ({ score: Number(r.selector_score_raw), win: r.raw_result === "WIN" ? 1 : 0 }))
    .sort((a, b) => b.score - a.score);
  const band = (topFrac: number, bottom = false) => {
    if (scored.length === 0) return 0;
    const k = Math.max(1, Math.round(scored.length * topFrac));
    const arr = bottom ? scored.slice(-k) : scored.slice(0, k);
    return arr.reduce((s, x) => s + x.win, 0) / arr.length;
  };
  const rawAcc = scored.length ? scored.reduce((s, x) => s + x.win, 0) / scored.length : 0;
  return {
    window_size: n,
    actual_coverage: n ? pubDirectional.length / n : 0,
    raw_accuracy: n ? rawWin / n : 0,
    published_accuracy: (pubWin + pubLoss) ? pubWin / (pubWin + pubLoss) : 0,
    selector_lift_vs_raw: band(0.60) - rawAcc,
    published_net: pubWin - pubLoss,
    green_prediction_share: n ? greenPreds.length / n : 0,
    red_prediction_share: n ? redPreds.length / n : 0,
    green_accuracy: greenAcc,
    red_accuracy: redAcc,
    expert_agreement_accuracy: agreeAcc,
    expert_disagreement_accuracy: disagreeAcc,
    top_20_percent_score_accuracy: band(0.20),
    top_40_percent_score_accuracy: band(0.40),
    top_60_percent_score_accuracy: band(0.60),
    bottom_40_percent_score_accuracy: band(0.40, true),
  };
});

/** Full R2 prediction CSV (R1 rows excluded — they remain in the DB). */
export const exportM3SePredictionsCsv = createServerFn({ method: "GET" }).handler(async (): Promise<Row[]> => {
  const PAGE = 1000;
  const all: Row[] = [];
  for (let off = 0; off < 25_000; off += PAGE) {
    const { data, error } = await (await getAdmin())
      .from("model3_se_predictions")
      .select("*")
      .eq("model_version", M3SE_MODEL_VERSION)
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
  const { data } = await (await getAdmin())
    .from("model3_se_fits")
    .select("*")
    .eq("model_version", M3SE_MODEL_VERSION)
    .order("fitted_at", { ascending: false });
  return ((data ?? []) as Array<Record<string, unknown>>).map(toSerializable);
});

export const exportM3SeBlocksCsv = createServerFn({ method: "GET" }).handler(async (): Promise<Row[]> => {
  const { data } = await (await getAdmin())
    .from("model3_se_blocks")
    .select("*")
    .order("block_end_ts", { ascending: false });
  return ((data ?? []) as Array<Record<string, unknown>>).map(toSerializable);
});
