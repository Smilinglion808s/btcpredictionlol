// Orchestrator for m3-se-r2: called from the shared shadow trigger with a
// target candle timestamp. Fully wrapped so failures never break siblings.
// R1 rows already in the DB are preserved; R2 rows are tagged model_version=m3-se-r2.

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
  M3SE_MIN_LABELED_ROWS,
  M3SE_CODE_VERSION,
  M3SE_FAST_HALF_LIFE,
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

type ActiveFit = {
  fit_id: string;
  artifact: M3SEArtifact;
  activated_at: string | null;
  estimated_coverage: number | null;
  target_coverage: number | null;
  calibration_direction_accuracy: number | null;
  oof_direction_accuracy: number | null;
  selector_roc_auc: number | null;
  selector_pr_auc: number | null;
  selector_brier: number | null;
  green_class_weight: number | null;
  red_class_weight: number | null;
};

async function loadActiveFit(sb: SupabaseClient): Promise<ActiveFit | null> {
  const { data } = await sb
    .from("model3_se_fits")
    .select("fit_id, artifact, activated_at, calibration_estimated_coverage, estimated_coverage, target_coverage, calibration_direction_accuracy, oof_direction_accuracy, selector_roc_auc, selector_pr_auc, selector_brier, green_class_weight, red_class_weight")
    .eq("model_version", M3SE_MODEL_VERSION)
    .eq("status", "active")
    .order("activated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const d = data as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : v == null ? null : Number(v));
  return {
    fit_id: String(d.fit_id),
    artifact: d.artifact as M3SEArtifact,
    activated_at: (d.activated_at as string | null) ?? null,
    estimated_coverage: num(d.calibration_estimated_coverage) ?? num(d.estimated_coverage),
    target_coverage: num(d.target_coverage),
    calibration_direction_accuracy: num(d.calibration_direction_accuracy),
    oof_direction_accuracy: num(d.oof_direction_accuracy),
    selector_roc_auc: num(d.selector_roc_auc),
    selector_pr_auc: num(d.selector_pr_auc),
    selector_brier: num(d.selector_brier),
    green_class_weight: num(d.green_class_weight),
    red_class_weight: num(d.red_class_weight),
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

async function predictionsForFit(sb: SupabaseClient, fitId: string): Promise<number> {
  const { count } = await sb
    .from("model3_se_predictions")
    .select("prediction_id", { count: "exact", head: true })
    .eq("fit_id", fitId);
  return count ?? 0;
}

async function trainAndStoreNewFit(sb: SupabaseClient, candles: Candle[]): Promise<
  { ok: true; fit_id: string } | { ok: false; reason: string }
> {
  const { X, y, rowTimestamps } = buildTrainingMatrix(candles);
  const trained = trainM3SE(X, y, rowTimestamps);
  if (!trained.ok) {
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

  // Retire prior active fits AFTER we know we have a valid replacement.
  await sb.from("model3_se_fits")
    .update({ status: "retired", retired_at: new Date().toISOString() })
    .eq("model_version", M3SE_MODEL_VERSION)
    .eq("status", "active");

  const now = new Date().toISOString();
  const d = trained.diagnostics;
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
    slow_lambda: d.slow_lambda,
    fast_lambda: d.fast_lambda,
    stacker_lambda: d.stacker_lambda,
    selector_lambda: d.selector_lambda,
    selection_threshold: trained.artifact.selection_threshold,
    target_coverage: d.target_coverage,
    estimated_coverage: d.calibration_estimated_coverage,
    calibration_estimated_coverage: d.calibration_estimated_coverage,
    oof_direction_accuracy: d.oof_direction_accuracy,
    oof_direction_brier: d.oof_direction_brier,
    oof_direction_log_loss: d.oof_direction_log_loss,
    oof_balanced_accuracy: d.oof_direction_balanced_accuracy,
    calibration_direction_accuracy: d.calibration_direction_accuracy,
    calibration_direction_brier: d.calibration_direction_brier,
    calibration_direction_log_loss: d.calibration_direction_log_loss,
    calibration_balanced_accuracy: d.calibration_direction_balanced_accuracy,
    predicted_green_share: d.predicted_green_share,
    predicted_red_share: d.predicted_red_share,
    selector_roc_auc: d.selector_roc_auc,
    selector_pr_auc: d.selector_pr_auc,
    selector_brier: d.selector_brier,
    selector_log_loss: d.selector_log_loss,
    selector_top20_accuracy: d.selector_top20_accuracy,
    selector_top40_accuracy: d.selector_top40_accuracy,
    selector_top60_accuracy: d.selector_top60_accuracy,
    selector_bottom40_accuracy: d.selector_bottom40_accuracy,
    selector_top60_lift_vs_raw: d.selector_top60_lift_vs_raw,
    selector_top60_lift_vs_bottom40: d.selector_top60_lift_vs_bottom40,
    selector_lambda_search: d.selector_lambda_search,
    selector_score_calibration_min: d.selector_score_calibration_min,
    selector_score_calibration_median: d.selector_score_calibration_median,
    selector_score_calibration_p40: d.selector_score_calibration_p40,
    selector_score_calibration_p60: d.selector_score_calibration_p60,
    selector_score_calibration_max: d.selector_score_calibration_max,
    training_green_count: d.training_green_count,
    training_red_count: d.training_red_count,
    green_class_weight: d.green_class_weight,
    red_class_weight: d.red_class_weight,
    fast_recency_half_life: d.fast_half_life,
    artifact: trained.artifact,
  });
  if (error) return { ok: false, reason: `insert_error:${error.message}` };
  return { ok: true, fit_id: trained.fit_id };
}

/** Emit the m3-se-r2 outbound webhook. Never throws. */
async function emitM3SeWebhook(sb: SupabaseClient, row: Record<string, unknown>): Promise<void> {
  try {
    const { deliverWebhook, buildM3SeWebhookPayload } = await import("../webhooks.server");
    await deliverWebhook(sb, "prediction.created", buildM3SeWebhookPayload({ row }));
  } catch {
    /* never block the pipeline on webhook failure */
  }
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

    const historyResult = await waitForFinalizedHistory(sb, targetTs);
    const { candles, ready } = historyResult;
    const priorAttempts = historyResult.attempts;

    let active = await loadActiveFit(sb);
    const dqReasons: string[] = [];
    if (!ready) dqReasons.push("prior_candle_missing");
    if (candles.length < 100) dqReasons.push(`insufficient_history:${candles.length}`);
    const belowMin = candles.length < M3SE_MIN_LABELED_ROWS;
    if (belowMin) dqReasons.push(`below_min_labeled_rows:${candles.length}/${M3SE_MIN_LABELED_ROWS}`);
    const dataQualityValid = ready && candles.length >= 100;

    let retrainedThisRun = false;
    let retrainReason: string | null = null;
    let resolvedSince: number | null = null;

    if (active) {
      resolvedSince = await resolvedRowsSince(sb, active.fit_id, active.activated_at);
      const cadence = resolvedSince >= M3SE_RETRAIN_EVERY_RESOLVED_ROWS;
      const coverageTooLow = (active.estimated_coverage ?? M3SE_TARGET_COVERAGE) < M3SE_TARGET_COVERAGE * 0.8;
      // Retain-prior-fit rule (spec §2): don't try to activate a smaller
      // replacement if history is insufficient.
      if ((cadence || coverageTooLow) && !belowMin) {
        retrainReason = cadence
          ? `cadence:${resolvedSince}>=${M3SE_RETRAIN_EVERY_RESOLVED_ROWS}`
          : `coverage_low:${active.estimated_coverage}<${M3SE_TARGET_COVERAGE * 0.8}`;
        const t = await trainAndStoreNewFit(sb, candles);
        retrainedThisRun = t.ok;
        if (!t.ok) retrainReason += `|train_failed:${t.reason}`;
        if (t.ok) active = await loadActiveFit(sb);
      } else if ((cadence || coverageTooLow) && belowMin) {
        retrainReason = `retain_prior_fit:below_min_labeled_rows:${candles.length}/${M3SE_MIN_LABELED_ROWS}`;
      }
    } else if (!belowMin) {
      retrainReason = "bootstrap";
      const t = await trainAndStoreNewFit(sb, candles);
      retrainedThisRun = t.ok;
      if (!t.ok) retrainReason += `|train_failed:${t.reason}`;
      if (t.ok) active = await loadActiveFit(sb);
    } else {
      retrainReason = `bootstrap_deferred:below_min_labeled_rows:${candles.length}/${M3SE_MIN_LABELED_ROWS}`;
    }

    if (!active) {
      const noFitRow = {
        fit_id: null,
        model_version: M3SE_MODEL_VERSION,
        feature_schema_version: M3SE_FEATURE_SCHEMA_VERSION,
        code_version: M3SE_CODE_VERSION,
        symbol: M3SE_STREAM.symbol,
        timeframe: M3SE_STREAM.timeframe,
        provider: M3SE_STREAM.provider,
        target_candle_ts: targetIso,
        data_quality_valid: false,
        data_quality_reasons: [...dqReasons, "no_active_fit"],
        published_prediction: "ABSTAIN",
        abstain_reason: "no_active_fit",
        abstain_category: "no_active_fit",
        abstain_detail: retrainReason ?? "no fit available and (re)train did not produce one",
        prior_candle_ready: ready,
        prior_candle_poll_attempts: priorAttempts,
        history_rows_used: candles.length,
        min_labeled_rows_required: M3SE_MIN_LABELED_ROWS,
        retrained_this_run: retrainedThisRun,
        retrain_reason: retrainReason,
        resolved_rows_since_fit: resolvedSince,
        fast_recency_half_life: M3SE_FAST_HALF_LIFE,
        publish_gates: {
          data_quality_valid: false,
          dq_reasons: dqReasons,
          has_active_fit: false,
          retrain_attempted: !belowMin,
          retrain_reason: retrainReason,
        },
      };
      await sb.from("model3_se_predictions").insert(noFitRow);
      await emitM3SeWebhook(sb, noFitRow);
      return;
    }

    const { targetFeatureRow } = buildTrainingMatrix(candles);
    const targetOpen = candles.length ? candles[candles.length - 1].close : null;
    const scored = scoreM3SE(targetFeatureRow, active.artifact);

    const featureNanCount = targetFeatureRow.reduce((n, v) => n + (Number.isFinite(v) ? 0 : 1), 0);
    const featureRowValid = featureNanCount === 0;

    const threshold = active.artifact.selection_threshold;
    const selectorMargin = scored.selectorScoreRaw - threshold;
    const directionConfidenceGap = Math.abs(scored.pStackedCalibrated - 0.5);

    let published: "GREEN" | "RED" | "ABSTAIN" = scored.rawDir;
    let abstainReason: string | null = null;
    let abstainCategory: string | null = null;
    let abstainDetail: string | null = null;
    if (!dataQualityValid) {
      published = "ABSTAIN";
      abstainReason = "invalid_data";
      abstainCategory = "invalid_data";
      abstainDetail = `data quality invalid: ${dqReasons.join(", ") || "unspecified"}`;
    } else if (!featureRowValid) {
      published = "ABSTAIN";
      abstainReason = "invalid_data";
      abstainCategory = "invalid_features";
      abstainDetail = `feature row has ${featureNanCount} non-finite value(s)`;
    } else if (scored.selectorScoreRaw < threshold) {
      published = "ABSTAIN";
      abstainReason = "below_selector_rank";
      abstainCategory = "below_selector_rank";
      abstainDetail =
        `selector_score_raw=${scored.selectorScoreRaw.toFixed(4)} < ` +
        `selection_threshold=${threshold.toFixed(4)} ` +
        `(margin=${selectorMargin.toFixed(4)}; pct=${(scored.selectorScorePercentile * 100).toFixed(1)}; ` +
        `raw_dir=${scored.rawDir}; p_green_cal=${scored.pStackedCalibrated.toFixed(4)}; ` +
        `agreement=${scored.consensus.expertAgreement}; ` +
        `signed_consensus=${scored.consensus.signedConsensus.toFixed(3)}; ` +
        `stacker_margin=${scored.consensus.stackerLogitMargin.toFixed(3)}; ` +
        `fit_est_coverage=${active.estimated_coverage ?? "n/a"}; ` +
        `fit_target_coverage=${active.target_coverage ?? M3SE_TARGET_COVERAGE})`;
    }

    const fitAge = await predictionsForFit(sb, active.fit_id);

    const publishGates = {
      data_quality_valid: dataQualityValid,
      dq_reasons: dqReasons,
      feature_row_valid: featureRowValid,
      feature_nan_count: featureNanCount,
      selector_pass: scored.selectorScoreRaw >= threshold,
      selector_score_raw: scored.selectorScoreRaw,
      selector_score_percentile: scored.selectorScorePercentile,
      selector_margin: selectorMargin,
      selection_threshold: threshold,
      p_correct_calibrated: scored.pCorrectCalibrated,
      p_correct_raw: scored.pCorrectRaw,
      p_green_stacked_calibrated: scored.pStackedCalibrated,
      direction_confidence_gap: directionConfidenceGap,
      raw_dir: scored.rawDir,
      raw_confidence: scored.rawConfidence,
      consensus: scored.consensus,
      fit_id: active.fit_id,
      fit_activated_at: active.activated_at,
      fit_estimated_coverage: active.estimated_coverage,
      fit_target_coverage: active.target_coverage,
      retrained_this_run: retrainedThisRun,
      retrain_reason: retrainReason,
    };

    const featCols: Record<string, number> = {};
    for (let i = 0; i < M3SE_FEATURE_NAMES.length; i++) {
      const v = targetFeatureRow[i];
      featCols[M3SE_FEATURE_NAMES[i]] = Number.isFinite(v) ? v : 0;
    }

    const predRow = {
      fit_id: active.fit_id,
      model_version: M3SE_MODEL_VERSION,
      feature_schema_version: M3SE_FEATURE_SCHEMA_VERSION,
      code_version: M3SE_CODE_VERSION,
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
      // R2 selector fields
      selector_score_raw: scored.selectorScoreRaw,
      selector_score_percentile: scored.selectorScorePercentile,
      p_correct_raw: scored.pCorrectRaw,
      p_correct_calibrated: scored.pCorrectCalibrated,
      selection_threshold: threshold,
      // Consensus features
      signed_consensus: scored.consensus.signedConsensus,
      consensus_strength: scored.consensus.consensusStrength,
      expert_agreement: scored.consensus.expertAgreement,
      expert_disagreement: scored.consensus.expertDisagreement,
      minimum_expert_strength: scored.consensus.minimumExpertStrength,
      stacker_logit_margin: scored.consensus.stackerLogitMargin,
      // Publication
      published_prediction: published,
      abstain_reason: abstainReason,
      abstain_category: abstainCategory,
      abstain_detail: abstainDetail,
      selector_margin: selectorMargin,
      direction_confidence_gap: directionConfidenceGap,
      publish_gates: publishGates,
      // Fit provenance
      fit_estimated_coverage: active.estimated_coverage,
      fit_target_coverage: active.target_coverage,
      fit_calibration_direction_accuracy: active.calibration_direction_accuracy,
      fit_oof_direction_accuracy: active.oof_direction_accuracy,
      fit_selector_roc_auc: active.selector_roc_auc,
      fit_selector_pr_auc: active.selector_pr_auc,
      fit_selector_brier: active.selector_brier,
      fit_activated_at: active.activated_at,
      green_class_weight: active.green_class_weight,
      red_class_weight: active.red_class_weight,
      fast_recency_half_life: M3SE_FAST_HALF_LIFE,
      fit_age_predictions: fitAge,
      // Pipeline audit
      prior_candle_ready: ready,
      prior_candle_poll_attempts: priorAttempts,
      history_rows_used: candles.length,
      min_labeled_rows_required: M3SE_MIN_LABELED_ROWS,
      retrained_this_run: retrainedThisRun,
      retrain_reason: retrainReason,
      resolved_rows_since_fit: resolvedSince,
      feature_row_valid: featureRowValid,
      feature_nan_count: featureNanCount,
    });
  } catch {
    /* swallow: never block sibling models */
  }
}

/** Resolve any m3-se-r2 predictions whose target candle has since closed. */
export async function resolveDueM3SeR1(sb: SupabaseClient): Promise<void> {
  try {
    const { data: pending } = await sb
      .from("model3_se_predictions")
      .select("prediction_id, target_candle_ts, published_prediction, raw_prediction")
      .eq("model_version", M3SE_MODEL_VERSION)
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
