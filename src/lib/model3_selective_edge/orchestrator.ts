// Orchestrator for m3-se-r1: called from the shared shadow trigger with a
// target candle timestamp. Fully wrapped so failures never break siblings.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  M3SE_MODEL_VERSION,
  M3SE_FEATURE_SCHEMA_VERSION,
  M3SE_STREAM,
  M3SE_TIMEFRAME_SEC,
  M3SE_MAX_HISTORY_ROWS,
  M3SE_PRIOR_POLL_ATTEMPTS,
  M3SE_PRIOR_POLL_INTERVAL_MS,
  M3SE_RETRAIN_EVERY_RESOLVED_ROWS,
  M3SE_TARGET_COVERAGE,
} from "./config";
import { buildTrainingMatrix, M3SE_FEATURE_NAMES, type Candle } from "./features";
import { trainM3SE, scoreM3SE, type M3SEArtifact } from "./train";

const TF_MS = M3SE_TIMEFRAME_SEC * 1000;

async function ingestRefresh(sb: SupabaseClient): Promise<void> {
  if (process.env.VITEST) return;
  try {
    const { fetchAndUpsertCandles } = await import("@/lib/okx.server");
    await fetchAndUpsertCandles(sb);
  } catch { /* best-effort */ }
}

async function fetchRecentCandles(sb: SupabaseClient, beforeTs: Date, limit: number): Promise<Candle[]> {
  const PAGE = 1000;
  const rows: Array<Record<string, unknown>> = [];
  for (let off = 0; off < limit; off += PAGE) {
    const take = Math.min(PAGE, limit - off);
    const { data, error } = await sb
      .from("candles")
      .select("candle_ts, open, high, low, close, volume")
      .eq("symbol", M3SE_STREAM.symbol)
      .eq("timeframe", M3SE_STREAM.timeframe)
      .eq("fetch_source", M3SE_STREAM.provider)
      .eq("confirm", true)
      .lt("candle_ts", beforeTs.toISOString())
      .order("candle_ts", { ascending: false })
      .range(off, off + take - 1);
    if (error) throw error;
    const batch = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...batch);
    if (batch.length < take) break;
  }
  return rows
    .map((r) => ({
      ts: new Date(String(r.candle_ts)).toISOString(),
      open: Number(r.open), high: Number(r.high), low: Number(r.low),
      close: Number(r.close), volume: Number(r.volume ?? 0),
    }))
    .reverse();
}

async function waitForFinalizedHistory(sb: SupabaseClient, targetTs: Date): Promise<{ candles: Candle[]; ready: boolean; attempts: number }> {
  const requiredPriorIso = new Date(targetTs.getTime() - TF_MS).toISOString();
  let candles: Candle[] = [];
  let attempts = 0;
  for (let i = 0; i < M3SE_PRIOR_POLL_ATTEMPTS; i++) {
    attempts = i + 1;
    if (i > 0) await ingestRefresh(sb);
    candles = await fetchRecentCandles(sb, targetTs, M3SE_MAX_HISTORY_ROWS);
    if (candles.length && candles[candles.length - 1].ts === requiredPriorIso) {
      return { candles, ready: true, attempts };
    }
    if (i < M3SE_PRIOR_POLL_ATTEMPTS - 1) await new Promise((r) => setTimeout(r, M3SE_PRIOR_POLL_INTERVAL_MS));
  }
  return { candles, ready: false, attempts };
}

async function loadActiveFit(sb: SupabaseClient): Promise<
  { fit_id: string; artifact: M3SEArtifact; activated_at: string | null; estimated_coverage: number | null } | null
> {
  const { data } = await sb
    .from("model3_se_fits")
    .select("fit_id, artifact, activated_at, estimated_coverage")
    .eq("model_version", M3SE_MODEL_VERSION)
    .eq("status", "active")
    .order("activated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const d = data as Record<string, unknown>;
  return {
    fit_id: String(d.fit_id),
    artifact: d.artifact as M3SEArtifact,
    activated_at: (d.activated_at as string | null) ?? null,
    estimated_coverage: typeof d.estimated_coverage === "number" ? d.estimated_coverage : d.estimated_coverage == null ? null : Number(d.estimated_coverage),
  };
}

async function resolvedRowsSince(sb: SupabaseClient, fitId: string, activatedAt: string | null): Promise<number> {
  if (!activatedAt) return Number.POSITIVE_INFINITY;
  const { count } = await sb
    .from("model3_se_predictions")
    .select("prediction_id", { count: "exact", head: true })
    .eq("fit_id", fitId)
    .not("resolved_at", "is", null)
    .neq("actual_direction", "PUSH")
    .gte("resolved_at", activatedAt);
  return count ?? 0;
}

async function trainAndStoreNewFit(sb: SupabaseClient, candles: Candle[]): Promise<
  { ok: true; fit_id: string } | { ok: false; reason: string }
> {
  const { X, y, rowTimestamps } = buildTrainingMatrix(candles);
  const trained = trainM3SE(X, y, rowTimestamps);
  if (!trained.ok) {
    // Log the failure as a rejected fit so it shows up in diagnostics.
    try {
      await sb.from("model3_se_fits").insert({
        fit_id: `rejected_${Date.now()}`,
        model_version: M3SE_MODEL_VERSION,
        feature_schema_version: M3SE_FEATURE_SCHEMA_VERSION,
        feature_schema_hash: "n/a",
        artifact_hash: "n/a",
        status: "rejected",
        failure_reason: trained.reason,
        artifact: {},
      });
    } catch { /* ignore */ }
    return { ok: false, reason: trained.reason };
  }

  // Retire prior active fits (advisory: no locking, but only run from cron).
  await sb.from("model3_se_fits")
    .update({ status: "retired", retired_at: new Date().toISOString() })
    .eq("model_version", M3SE_MODEL_VERSION)
    .eq("status", "active");

  const now = new Date().toISOString();
  const { error } = await sb.from("model3_se_fits").insert({
    fit_id: trained.fit_id,
    model_version: M3SE_MODEL_VERSION,
    feature_schema_version: M3SE_FEATURE_SCHEMA_VERSION,
    feature_schema_hash: trained.hashes.feature_schema_hash,
    artifact_hash: trained.hashes.artifact_hash,
    status: "active",
    fitted_at: now,
    activated_at: now,
    slow_training_start: trained.windows.slow_start_ts || null,
    slow_training_end: trained.windows.slow_end_ts || null,
    slow_training_rows: trained.windows.slow_rows,
    fast_training_start: trained.windows.fast_start_ts || null,
    fast_training_end: trained.windows.fast_end_ts || null,
    fast_training_rows: trained.windows.fast_rows,
    oof_start: trained.windows.oof_start_ts || null,
    oof_end: trained.windows.oof_end_ts || null,
    oof_rows: trained.windows.oof_rows,
    oof_block_size: trained.windows.oof_block_size,
    calibration_start: trained.windows.calibration_start_ts || null,
    calibration_end: trained.windows.calibration_end_ts || null,
    calibration_rows: trained.windows.calibration_rows,
    slow_lambda: trained.diagnostics.slow_lambda,
    fast_lambda: trained.diagnostics.fast_lambda,
    stacker_lambda: trained.diagnostics.stacker_lambda,
    selector_lambda: trained.diagnostics.selector_lambda,
    selection_threshold: trained.artifact.selection_threshold,
    target_coverage: trained.diagnostics.target_coverage,
    estimated_coverage: trained.diagnostics.estimated_coverage,
    oof_direction_accuracy: trained.diagnostics.oof_direction_accuracy,
    oof_direction_brier: trained.diagnostics.oof_direction_brier,
    oof_direction_log_loss: trained.diagnostics.oof_direction_log_loss,
    calibration_direction_accuracy: trained.diagnostics.calibration_direction_accuracy,
    calibration_direction_brier: trained.diagnostics.calibration_direction_brier,
    calibration_direction_log_loss: trained.diagnostics.calibration_direction_log_loss,
    selector_roc_auc: trained.diagnostics.selector_roc_auc,
    selector_pr_auc: trained.diagnostics.selector_pr_auc,
    selector_brier: trained.diagnostics.selector_brier,
    selector_log_loss: trained.diagnostics.selector_log_loss,
    artifact: trained.artifact,
  });
  if (error) return { ok: false, reason: `insert_error:${error.message}` };
  return { ok: true, fit_id: trained.fit_id };
}

/** Public: run per-candle prediction pipeline. */
export async function runM3SeR1(sb: SupabaseClient, opts: { targetCandleTs: Date }): Promise<void> {
  const targetTs = opts.targetCandleTs;
  const targetIso = targetTs.toISOString();
  try {
    // Idempotent guard.
    const { data: existing } = await sb
      .from("model3_se_predictions")
      .select("prediction_id")
      .eq("model_version", M3SE_MODEL_VERSION)
      .eq("symbol", M3SE_STREAM.symbol)
      .eq("timeframe", M3SE_STREAM.timeframe)
      .eq("target_candle_ts", targetIso)
      .maybeSingle();
    if (existing) return;

    // Ensure history includes the immediately-prior confirmed candle.
    const { candles, ready } = await waitForFinalizedHistory(sb, targetTs);

    // Load or (re)train fit.
    let active = await loadActiveFit(sb);
    let dataQualityValid = ready && candles.length >= 100;
    const dqReasons: string[] = [];
    if (!ready) dqReasons.push("prior_candle_missing");
    if (candles.length < 100) dqReasons.push(`insufficient_history:${candles.length}`);

    if (active) {
      const resolved = await resolvedRowsSince(sb, active.fit_id, active.activated_at);
      const coverageTooLow = (active.estimated_coverage ?? M3SE_TARGET_COVERAGE) < M3SE_TARGET_COVERAGE * 0.8;
      if (resolved >= M3SE_RETRAIN_EVERY_RESOLVED_ROWS || coverageTooLow) {
        const t = await trainAndStoreNewFit(sb, candles);
        if (t.ok) active = await loadActiveFit(sb);
      }
    } else {
      const t = await trainAndStoreNewFit(sb, candles);
      if (t.ok) active = await loadActiveFit(sb);
    }

    if (!active) {
      // Bootstrap failure: still record an ABSTAIN row for auditability.
      await sb.from("model3_se_predictions").insert({
        fit_id: null,
        model_version: M3SE_MODEL_VERSION,
        feature_schema_version: M3SE_FEATURE_SCHEMA_VERSION,
        symbol: M3SE_STREAM.symbol,
        timeframe: M3SE_STREAM.timeframe,
        provider: M3SE_STREAM.provider,
        target_candle_ts: targetIso,
        data_quality_valid: false,
        data_quality_reasons: ["no_active_fit"],
        published_prediction: "ABSTAIN",
        abstain_reason: "invalid_data",
      }).select(); // will fail FK-wise; ignore.
      return;
    }

    const { targetFeatureRow } = buildTrainingMatrix(candles);
    const targetOpen = candles.length ? candles[candles.length - 1].close : null;
    const scored = scoreM3SE(targetFeatureRow, active.artifact);

    let published: "GREEN" | "RED" | "ABSTAIN" = scored.rawDir;
    let abstainReason: string | null = null;
    if (!dataQualityValid) {
      published = "ABSTAIN";
      abstainReason = "invalid_data";
    } else if (scored.pCorrectCalibrated < active.artifact.selection_threshold) {
      published = "ABSTAIN";
      abstainReason = "below_correctness_rank";
    }

    const featCols: Record<string, number> = {};
    for (let i = 0; i < M3SE_FEATURE_NAMES.length; i++) {
      const v = targetFeatureRow[i];
      featCols[M3SE_FEATURE_NAMES[i]] = Number.isFinite(v) ? v : 0;
    }
    const [
      a_r1, a_r2, a_r4, a_r8, a_body, a_ema9_21, a_ema21_50, a_rsi, a_te32, a_rv,
    ] = scored.alignedRow;

    await sb.from("model3_se_predictions").insert({
      fit_id: active.fit_id,
      model_version: M3SE_MODEL_VERSION,
      feature_schema_version: M3SE_FEATURE_SCHEMA_VERSION,
      symbol: M3SE_STREAM.symbol,
      timeframe: M3SE_STREAM.timeframe,
      provider: M3SE_STREAM.provider,
      target_candle_ts: targetIso,
      target_open: targetOpen,
      data_quality_valid: dataQualityValid,
      data_quality_reasons: dqReasons.length ? dqReasons : null,
      ...featCols,
      p_green_slow: scored.pSlow,
      p_green_fast: scored.pFast,
      slow_logit: scored.slowLogit,
      fast_logit: scored.fastLogit,
      p_green_stacked_raw: scored.pStackedRaw,
      p_green_stacked_calibrated: scored.pStackedCalibrated,
      raw_prediction: scored.rawDir,
      raw_confidence: scored.rawConfidence,
      aligned_ret_log_1: a_r1,
      aligned_ret_log_2: a_r2,
      aligned_ret_log_4: a_r4,
      aligned_ret_log_8: a_r8,
      aligned_body_to_atr: a_body,
      aligned_ema9_minus_ema21_to_atr: a_ema9_21,
      aligned_ema21_minus_ema50_to_atr: a_ema21_50,
      aligned_rsi14_centered: a_rsi,
      aligned_trend_efficiency_32: a_te32,
      aligned_realized_volatility_8_to_32: a_rv,
      p_correct_raw: scored.pCorrectRaw,
      p_correct_calibrated: scored.pCorrectCalibrated,
      selection_threshold: active.artifact.selection_threshold,
      published_prediction: published,
      abstain_reason: abstainReason,
    });
  } catch {
    /* swallow: never block sibling models */
  }
}

/** Resolve any m3-se-r1 predictions whose target candle has since closed. */
export async function resolveDueM3SeR1(sb: SupabaseClient): Promise<void> {
  try {
    const { data: pending } = await sb
      .from("model3_se_predictions")
      .select("prediction_id, target_candle_ts, published_prediction, raw_prediction")
      .is("resolved_at", null)
      .lte("target_candle_ts", new Date(Date.now() - TF_MS).toISOString())
      .order("target_candle_ts", { ascending: true })
      .limit(50);
    for (const row of (pending ?? []) as Array<Record<string, unknown>>) {
      const ts = String(row.target_candle_ts);
      const { data: candle } = await sb
        .from("candles")
        .select("open, high, low, close, volume")
        .eq("symbol", M3SE_STREAM.symbol)
        .eq("timeframe", M3SE_STREAM.timeframe)
        .eq("fetch_source", M3SE_STREAM.provider)
        .eq("confirm", true)
        .eq("candle_ts", ts)
        .maybeSingle();
      if (!candle) continue;
      const c = candle as Record<string, unknown>;
      const o = Number(c.open), cl = Number(c.close);
      const actualDir = cl > o ? "GREEN" : cl < o ? "RED" : "PUSH";

      const raw = String(row.raw_prediction);
      const pub = String(row.published_prediction);
      const rawResult = actualDir === "PUSH" ? "PUSH" : raw === actualDir ? "WIN" : "LOSS";
      const pubResult = pub === "ABSTAIN"
        ? "ABSTAIN"
        : actualDir === "PUSH" ? "PUSH" : pub === actualDir ? "WIN" : "LOSS";
      const rawNet = rawResult === "WIN" ? 1 : rawResult === "LOSS" ? -1 : 0;
      const pubNet = pubResult === "WIN" ? 1 : pubResult === "LOSS" ? -1 : 0;
      const rawWouldWin = rawResult === "WIN";
      const abstainedWinner = pub === "ABSTAIN" && rawWouldWin;
      const abstainedLoser = pub === "ABSTAIN" && rawResult === "LOSS";
      const selectorNet = pub === "ABSTAIN" ? (rawWouldWin ? -1 : rawResult === "LOSS" ? 1 : 0) : 0;

      await sb.from("model3_se_predictions").update({
        actual_open: o, actual_high: Number(c.high), actual_low: Number(c.low),
        actual_close: cl, actual_volume: Number(c.volume ?? 0),
        actual_direction: actualDir,
        raw_result: rawResult, published_result: pubResult,
        raw_net: rawNet, published_net: pubNet,
        raw_would_win: rawWouldWin,
        abstained_winner: abstainedWinner,
        abstained_loser: abstainedLoser,
        selector_net_effect: selectorNet,
        resolved_at: new Date().toISOString(),
      }).eq("prediction_id", row.prediction_id);
    }
  } catch { /* swallow */ }
}
