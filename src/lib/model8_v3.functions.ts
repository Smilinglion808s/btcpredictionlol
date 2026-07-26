import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Pending candidate fit awaiting manual review, if any. Includes the pre-computed report. */
export const getModel8V3PendingCandidate = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data } = await sb
    .from("model8_v3_fits")
    .select("fit_id, model_version, fitted_at, review_requested_at, prior_active_fit_id, review_report, training_metrics, calibration_metrics, config_snapshot")
    .eq("status", "pending_review")
    .order("review_requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
});

/** Historical review decisions (approved / rejected / continued). */
export const listModel8V3Reviews = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data } = await sb
    .from("model8_v3_fit_reviews")
    .select("review_id, candidate_fit_id, active_fit_id, requested_at, reviewed_at, reviewed_by, decision, notes")
    .order("requested_at", { ascending: false })
    .limit(50);
  return data ?? [];
});

/** Approve a candidate fit → atomic swap; takes effect on next unopened candle. */
export const approveModel8V3Candidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { fit_id: string; notes?: string }) => data)
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const { data: res, error } = await sb.rpc("activate_model8_v3_fit", {
      p_fit_id: data.fit_id,
      p_reviewed_by: context.userId ?? "unknown",
      p_notes: data.notes ?? "",
    });
    if (error) throw new Error(error.message);
    return { ok: true, result: JSON.stringify(res ?? {}) };
  });

/** Reject a candidate, or explicitly continue the current active fit. */
export const rejectModel8V3Candidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { fit_id: string; decision?: "reject" | "continue"; notes?: string }) => data)
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const { data: res, error } = await sb.rpc("reject_model8_v3_fit", {
      p_fit_id: data.fit_id,
      p_reviewed_by: context.userId ?? "unknown",
      p_notes: data.notes ?? "",
      p_decision: data.decision ?? "reject",
    });
    if (error) throw new Error(error.message);
    return { ok: true, result: JSON.stringify(res ?? {}) };
  });


async function fetchAllModel8V3Rows() {
  const sb = await admin();
  const PAGE = 1000;
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("model8_v3_predictions")
      .select("*")
      .order("target_candle_ts", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...batch);
    if (batch.length < PAGE) break;
    if (from > 100_000) break;
  }
  return rows;
}

function scoreTrack(rows: Array<Record<string, unknown>>, key: "raw_result" | "qualified_result") {
  let wins = 0, losses = 0, pushes = 0, abstains = 0, pending = 0;
  for (const r of rows) {
    const v = r[key] as string | null;
    if (v === "WIN") wins++;
    else if (v === "LOSS") losses++;
    else if (v === "PUSH") pushes++;
    else if (v === "ABSTAIN") abstains++;
    else if (r.resolved_at == null) pending++;
  }
  const decided = wins + losses;
  const winRate = decided === 0 ? 0 : Math.round((wins / decided) * 10000) / 100;
  return { wins, losses, pushes, abstains, pending, trades: decided, win_rate: winRate };
}

function brierAndLogLoss(rows: Array<Record<string, unknown>>) {
  let brierSum = 0, llSum = 0, n = 0;
  for (const r of rows) {
    const p = r.calibrated_probability_green as number | null;
    const dir = r.actual_direction as string | null;
    if (p == null || (dir !== "GREEN" && dir !== "RED")) continue;
    const y = dir === "GREEN" ? 1 : 0;
    brierSum += (p - y) ** 2;
    const clamped = Math.min(0.9999, Math.max(0.0001, p));
    llSum += -(y * Math.log(clamped) + (1 - y) * Math.log(1 - clamped));
    n++;
  }
  return {
    brier: n ? Math.round((brierSum / n) * 10000) / 10000 : 0,
    log_loss: n ? Math.round((llSum / n) * 10000) / 10000 : 0,
    scored: n,
  };
}

function greenRedAccuracy(rows: Array<Record<string, unknown>>, track: "raw_prediction" | "qualified_prediction", resultKey: "raw_result" | "qualified_result") {
  let gW = 0, gT = 0, rW = 0, rT = 0;
  for (const r of rows) {
    const pred = r[track] as string | null;
    const res = r[resultKey] as string | null;
    if (res !== "WIN" && res !== "LOSS") continue;
    if (pred === "GREEN") { gT++; if (res === "WIN") gW++; }
    else if (pred === "RED") { rT++; if (res === "WIN") rW++; }
  }
  return {
    green_win_rate: gT === 0 ? 0 : Math.round((gW / gT) * 10000) / 100,
    green_total: gT,
    red_win_rate: rT === 0 ? 0 : Math.round((rW / rT) * 10000) / 100,
    red_total: rT,
  };
}

function calibrationBuckets(rows: Array<Record<string, unknown>>) {
  const buckets = ["0.00-0.20", "0.20-0.40", "0.40-0.60", "0.60-0.80", "0.80-1.00"];
  const out: Record<string, { n: number; avg_pred: number; empirical: number }> = {};
  for (const b of buckets) out[b] = { n: 0, avg_pred: 0, empirical: 0 };
  const totals: Record<string, { sumP: number; wins: number; n: number }> = {};
  for (const b of buckets) totals[b] = { sumP: 0, wins: 0, n: 0 };
  for (const r of rows) {
    const p = r.calibrated_probability_green as number | null;
    const dir = r.actual_direction as string | null;
    if (p == null || (dir !== "GREEN" && dir !== "RED")) continue;
    const b = p < 0.2 ? buckets[0] : p < 0.4 ? buckets[1] : p < 0.6 ? buckets[2] : p < 0.8 ? buckets[3] : buckets[4];
    totals[b].sumP += p;
    totals[b].wins += dir === "GREEN" ? 1 : 0;
    totals[b].n++;
  }
  for (const b of buckets) {
    const t = totals[b];
    out[b] = {
      n: t.n,
      avg_pred: t.n ? Math.round((t.sumP / t.n) * 10000) / 10000 : 0,
      empirical: t.n ? Math.round((t.wins / t.n) * 10000) / 10000 : 0,
    };
  }
  return out;
}

function drawdownAndStreak(rows: Array<Record<string, unknown>>, resultKey: "raw_result" | "qualified_result") {
  // Chronological ascending
  const ordered = rows
    .filter((r) => r[resultKey] === "WIN" || r[resultKey] === "LOSS")
    .sort((a, b) => String(a.resolved_at).localeCompare(String(b.resolved_at)));
  let running = 0, peak = 0, maxDD = 0, streak = 0, worstStreak = 0;
  for (const r of ordered) {
    if (r[resultKey] === "WIN") { running += 1; streak = 0; }
    else { running -= 1; streak += 1; if (streak > worstStreak) worstStreak = streak; }
    if (running > peak) peak = running;
    if (peak - running > maxDD) maxDD = peak - running;
  }
  return { max_drawdown: maxDD, longest_losing_streak: worstStreak };
}

/** Rich v3.0.0 stats split by episode + dual-track. */
export const getModel8V3Stats = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await fetchAllModel8V3Rows();
  const official = rows.filter((r) => r.official_forward_test_row === true && r.episode_type === "official_v3_forward_test");
  const shakedown = rows.filter((r) => r.episode_type === "engineering_shakedown");

  const rawOfficial = scoreTrack(official, "raw_result");
  const qualOfficial = scoreTrack(official, "qualified_result");
  const totalDecided = qualOfficial.trades + qualOfficial.abstains;
  const coverage = totalDecided === 0 ? 0 : Math.round((qualOfficial.trades / totalDecided) * 10000) / 100;

  // Abstained-raw accuracy: raw graded on rows where qualified was ABSTAIN.
  const abstainedRows = official.filter((r) => r.qualified_result === "ABSTAIN" && (r.raw_result === "WIN" || r.raw_result === "LOSS"));
  const abstainedRaw = scoreTrack(abstainedRows, "raw_result");

  // Active fit id/version — take newest resolved or predicted row.
  const newest = official[0] ?? shakedown[0];
  const active_fit_id = (newest?.fit_id as string) ?? null;
  const active_model_version = (newest?.model_version as string) ?? null;

  return {
    total_rows: rows.length,
    official_rows: official.length,
    shakedown_rows: shakedown.length,
    active_model_version,
    active_fit_id,
    coverage_pct: coverage,
    raw: rawOfficial,
    qualified: qualOfficial,
    abstained_raw: abstainedRaw,
    raw_brier_logloss: brierAndLogLoss(official),
    raw_green_red: greenRedAccuracy(official, "raw_prediction", "raw_result"),
    qualified_green_red: greenRedAccuracy(official, "qualified_prediction", "qualified_result"),
    calibration: calibrationBuckets(official),
    drawdown: drawdownAndStreak(official, "qualified_result"),
  };
});

/** Newest row (pending or resolved) for the current-prediction card. */
export const getModel8V3Pending = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("model8_v3_predictions")
    .select("prediction_id, target_candle_ts, qualified_prediction, raw_prediction, calibrated_probability_green, raw_probability_green, calibrated_probability_movement, abstain_reason, resolved_at, qualified_result, raw_result, actual_direction, data_quality_valid, feature_history_valid, official_forward_test_row, fit_id, model_version, episode_type")
    .order("target_candle_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
});

/** Operational diagnostics for the Model 3 FWD scheduler. */
export const getModel8V3Diagnostics = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const TF_MS = 15 * 60 * 1000;
  const nowMs = Date.now();
  const rem = nowMs % TF_MS;
  const nextExpectedTarget = new Date(rem > 0 && rem <= 180_000 ? nowMs - rem : nowMs + (TF_MS - rem));

  const [{ data: fit }, { data: latestPred }, { data: runs }] = await Promise.all([
    sb.from("model8_v3_fits").select("fit_id, status, activated_at, training_metrics, calibration_metrics")
      .eq("status", "active").order("activated_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("model8_v3_predictions").select("target_candle_ts, abstain_reason, qualified_prediction, fit_id, resolved_at")
      .order("target_candle_ts", { ascending: false }).limit(1).maybeSingle(),
    sb.from("api_runs").select("created_at, success, error_message, response_payload")
      .eq("run_type", "model8_v3_run").order("created_at", { ascending: false }).limit(1),
  ]);
  const lastRun = (runs ?? [])[0] as Record<string, unknown> | undefined;
  const activeFit = fit as Record<string, unknown> | null;
  return {
    last_invocation_ts: (lastRun?.created_at as string | undefined) ?? null,
    last_execution_error: (lastRun?.error_message as string | null | undefined) ?? null,
    last_prediction_target_ts: (latestPred as { target_candle_ts?: string } | null)?.target_candle_ts ?? null,
    last_abstain_reason: (latestPred as { abstain_reason?: string | null } | null)?.abstain_reason ?? null,
    next_expected_target_ts: nextExpectedTarget.toISOString(),
    active_fit_id: (activeFit?.fit_id as string | undefined) ?? null,
    active_fit_status: (activeFit?.status as string | undefined) ?? null,
    active_fit_activated_at: (activeFit?.activated_at as string | undefined) ?? null,
    training_metrics: activeFit?.training_metrics ?? null,
    calibration_metrics: activeFit?.calibration_metrics ?? null,
  };
});

/** Verification bundle for the audit: active fit + latest 20 preds + latest 20 runs. */
export const getModel8V3Verification = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const [{ data: fit }, { data: preds }, { data: runs }] = await Promise.all([
    sb.from("model8_v3_fits").select("fit_id, status, activated_at, training_metrics, calibration_metrics, config_snapshot")
      .eq("status", "active").order("activated_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("model8_v3_predictions")
      .select("target_candle_ts, qualified_prediction, abstain_reason, fit_id, resolved_at, prediction_created_before_target")
      .order("target_candle_ts", { ascending: false }).limit(20),
    sb.from("api_runs").select("created_at, success, error_message, response_payload")
      .eq("run_type", "model8_v3_run").order("created_at", { ascending: false }).limit(20),
  ]);
  const targets = (preds ?? []).map((p) => new Date((p as { target_candle_ts: string }).target_candle_ts).getTime()).sort((a, b) => a - b);
  let contiguous = targets.length > 1;
  for (let i = 1; i < targets.length; i++) if (targets[i] - targets[i - 1] !== 15 * 60 * 1000) { contiguous = false; break; }
  return {
    active_fit: fit ?? null,
    latest_predictions: preds ?? [],
    latest_api_runs: runs ?? [],
    targets_advance_15m: contiguous,
    initial_fit_auto_activated: !!fit && (fit as { status?: string }).status === "active",
  };
});

/** CSV export — every column, JSON blobs stringified. */
export const exportModel8V3Csv = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await fetchAllModel8V3Rows();
  return rows.map((r) => ({
    ...r,
    feature_values: r.feature_values ? JSON.stringify(r.feature_values) : "",
    fit_snapshot: r.fit_snapshot ? JSON.stringify(r.fit_snapshot) : "",
  }));
});

