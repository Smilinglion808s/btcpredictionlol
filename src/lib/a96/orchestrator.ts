// a96 orchestrator: runs after AAS96 shadow writes its row. Reuses the
// existing AAS Layer A/B directions + internal base selector from that row,
// then applies the a96-r1 engine and writes to a96_predictions.
//
// Candle-data integrity (2026-07 pipeline-alignment fix):
//   - All candle reads are scoped to a single canonical stream
//     (symbol, timeframe, provider) from A96_CANDLE_STREAM and require
//     confirm=true. The database has a UNIQUE(symbol,timeframe,candle_ts,
//     fetch_source) index guaranteeing at most one authoritative row per
//     stream+boundary.
//   - The immediately-prior candle is retry-polled (bounded) if the
//     ingester has not finalized it at prediction time.
//   - Contiguity, count, and target_open-vs-prev-close consistency checks
//     run before the engine. Any failure yields ABSTAIN with
//     candle_data_valid=false and a diagnostic reason; snapshot + row IDs
//     are still persisted for audit.
//   - Once written, candle snapshots are immutable (upsert only fills
//     these on first insert; resolution never rewrites priors).
//   - At resolution time we re-query the target candle scoped to the same
//     stream, persist its row id, and compare actual_open to the stored
//     target_open. Beyond A96_RESOLUTION_OPEN_TOLERANCE_BPS the resolution
//     is flagged (resolution_data_invalid=true) but still recorded.
//
// Resolution is handled by the transactional resolve_a96_prediction RPC and
// always uses OHLC from the `candles` table for the target candle timestamp
// (never any upstream/exported direction label). Every prediction generation
// first runs a catch-up resolver so fit state is fresh.
//
// External-model inputs (TD1/A2/router/model6) are rejected at runtime.

import type { SupabaseClient } from "@supabase/supabase-js";
import { a96Decide, a96DecideR3Counterfactual } from "./engine";
import { agreementFeatures, CandleHistoryError, macdAtrFromSeries } from "./features";
import type { Candle, FitState, Layer } from "./types";
import {
  A96_MODEL_NAME,
  A96_MODEL_VERSION,
  A96_VARIANT,
  A96_CANDLE_STREAM,
  A96_TARGET_OPEN_TOLERANCE_BPS,
  A96_RESOLUTION_OPEN_TOLERANCE_BPS,
  A96_PRIOR_CANDLE_POLL_ATTEMPTS,
  A96_PRIOR_CANDLE_POLL_INTERVAL_MS,
  A96_CONFIG,
} from "./config";


const TF_MS = A96_CONFIG.expected_candle_seconds * 1000;

// Test-only override so unit tests can shrink the retry-poll window without
// mocking global timers (vitest fake timers do not intercept setTimeout in
// dynamically-imported modules reliably). Production leaves this null.
let __POLL_OVERRIDE: { attempts: number; intervalMs: number } | null = null;
export function __setA96PollForTests(v: { attempts: number; intervalMs: number } | null): void {
  __POLL_OVERRIDE = v;
}

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

interface PriorCandleRow {
  id: string;
  candle: Candle;
}

/**
 * Compute the four exact required prior-candle timestamps for a given target,
 * as ISO strings ordered oldest → newest: [T-60m, T-45m, T-30m, T-15m].
 */
function requiredPriorTimestamps(targetTs: Date): string[] {
  const need = A96_CONFIG.required_prior_candles;
  const out: string[] = [];
  for (let i = need; i >= 1; i--) {
    out.push(new Date(targetTs.getTime() - i * TF_MS).toISOString());
  }
  return out;
}

/**
 * Fetch exactly the four required prior candles by exact `candle_ts` match,
 * scoped to the canonical stream. Never substitutes older confirmed rows for
 * a missing exact timestamp. Returns the rows (oldest→newest) plus the list
 * of any missing timestamps.
 */
async function fetchExactPriorTimestamps(
  sb: SupabaseClient,
  targetTs: Date,
): Promise<{ rows: PriorCandleRow[]; missing: string[] }> {
  const expected = requiredPriorTimestamps(targetTs);
  const { data } = await sb
    .from("candles")
    .select("id, candle_ts, open, high, low, close, fetch_source, confirm")
    .eq("symbol", A96_CANDLE_STREAM.symbol)
    .eq("timeframe", A96_CANDLE_STREAM.timeframe)
    .eq("fetch_source", A96_CANDLE_STREAM.provider)
    .eq("confirm", true)
    .in("candle_ts", expected);
  const rowsRaw = (data ?? []) as Array<Record<string, unknown>>;
  const byTs = new Map<string, PriorCandleRow>();
  for (const r of rowsRaw) {
    const iso = new Date(String(r.candle_ts)).toISOString();
    if (!expected.includes(iso)) continue; // never substitute unrelated candles
    if (byTs.has(iso)) continue; // stream is UNIQUE(symbol,tf,ts,source); dedupe defensively
    byTs.set(iso, {
      id: String(r.id),
      candle: {
        timestamp: new Date(iso),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
      },
    });
  }
  const rows: PriorCandleRow[] = [];
  const missing: string[] = [];
  for (const ts of expected) {
    const row = byTs.get(ts);
    if (row) rows.push(row); else missing.push(ts);
  }
  return { rows, missing };
}

/**
 * Trigger a canonical OKX ingest refresh so the exact required T-15m row
 * becomes available in `public.candles`. Best-effort: network failures
 * are swallowed so the poll loop can retry. Skipped under Vitest to keep
 * the test suite hermetic.
 */
async function refreshCanonicalCandleIngest(sb: SupabaseClient): Promise<void> {
  if (process.env.VITEST) return;
  try {
    const { fetchAndUpsertCandles } = await import("@/lib/okx.server");
    await fetchAndUpsertCandles(sb);
  } catch { /* best-effort */ }
}

/**
 * Poll for the four exact prior candles, refreshing the OKX ingest between
 * attempts. Returns as soon as all four are present, otherwise after the
 * bounded window.
 */
async function pollExactPriorCandles(
  sb: SupabaseClient,
  targetTs: Date,
): Promise<{ rows: PriorCandleRow[]; missing: string[]; attempts: number }> {
  const attemptsMax = __POLL_OVERRIDE?.attempts ?? A96_PRIOR_CANDLE_POLL_ATTEMPTS;
  const intervalMs = __POLL_OVERRIDE?.intervalMs ?? A96_PRIOR_CANDLE_POLL_INTERVAL_MS;
  let last: { rows: PriorCandleRow[]; missing: string[] } = { rows: [], missing: requiredPriorTimestamps(targetTs) };
  for (let attempt = 0; attempt < attemptsMax; attempt++) {
    if (attempt > 0) await refreshCanonicalCandleIngest(sb);
    last = await fetchExactPriorTimestamps(sb, targetTs);
    if (last.missing.length === 0) return { ...last, attempts: attempt + 1 };
    if (attempt < attemptsMax - 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  return { ...last, attempts: attemptsMax };
}

interface CandleValidation {
  valid: boolean;
  reason: string | null;
  target_open_difference_bps: number | null;
}

function validatePriorCandleStream(args: {
  rows: PriorCandleRow[];
  missing: string[];
  targetTs: Date;
  targetOpen: number;
}): CandleValidation {
  const need = A96_CONFIG.required_prior_candles;
  if (args.missing.length > 0) {
    return {
      valid: false,
      reason: `missing_prior_timestamps:${args.missing.length}/${need}`,
      target_open_difference_bps: null,
    };
  }
  if (args.rows.length !== need) {
    return { valid: false, reason: `insufficient_prior_candles:${args.rows.length}/${need}`, target_open_difference_bps: null };
  }
  for (let i = 1; i < args.rows.length; i++) {
    const delta = (args.rows[i].candle.timestamp.getTime() - args.rows[i - 1].candle.timestamp.getTime()) / 1000;
    if (delta !== A96_CONFIG.expected_candle_seconds) {
      return { valid: false, reason: `non_contiguous_prior:${delta}s`, target_open_difference_bps: null };
    }
  }
  const last = args.rows[args.rows.length - 1];
  const finalDelta = (args.targetTs.getTime() - last.candle.timestamp.getTime()) / 1000;
  if (finalDelta !== A96_CONFIG.expected_candle_seconds) {
    return { valid: false, reason: `latest_prior_gap:${finalDelta}s`, target_open_difference_bps: null };
  }
  const prevClose = last.candle.close;
  if (!(prevClose > 0) || !(args.targetOpen > 0)) {
    return { valid: false, reason: "non_positive_price", target_open_difference_bps: null };
  }
  const diffBps = Math.abs((args.targetOpen - prevClose) / prevClose) * 10_000;
  if (diffBps > A96_TARGET_OPEN_TOLERANCE_BPS) {
    return { valid: false, reason: `target_open_vs_prev_close_${diffBps.toFixed(2)}bps`, target_open_difference_bps: diffBps };
  }
  return { valid: true, reason: null, target_open_difference_bps: diffBps };
}

async function fetchTargetCandle(sb: SupabaseClient, targetTs: Date): Promise<
  { id: string; provider: string; open: number; high: number; low: number; close: number; volume: number | null } | null
> {
  let q = sb
    .from("candles")
    .select("id, open, high, low, close, volume, confirm, fetch_source")
    .eq("symbol", A96_CANDLE_STREAM.symbol)
    .eq("timeframe", A96_CANDLE_STREAM.timeframe)
    .eq("candle_ts", targetTs.toISOString());
  q = q.eq("fetch_source", A96_CANDLE_STREAM.provider);
  const { data } = await q.maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  const confirm = r.confirm as boolean | null;
  if (confirm === false) return null;
  const open = Number(r.open), high = Number(r.high), low = Number(r.low), close = Number(r.close);
  if (![open, high, low, close].every((n) => isFinite(n) && n > 0)) return null;
  const volRaw = r.volume;
  const volume = volRaw == null ? null : Number(volRaw);
  return {
    id: String(r.id),
    provider: String(r.fetch_source ?? A96_CANDLE_STREAM.provider),
    open, high, low, close,
    volume: volume != null && isFinite(volume) ? volume : null,
  };
}

/**
 * r4 technical snapshot: MACD histogram + ATR14 computed from >= 200
 * contiguous, confirmed canonical candles ENDING EXACTLY at T-15m.
 * Returns null (with a reason) when the history is unusable. Never reads the
 * target candle.
 */
export interface A96Technical {
  macd_hist: number | null;
  atr14: number | null;
  source_ts: Date | null;
  source_row_id: string | null;
  error: string | null;
}

async function fetchTechnicalSnapshot(sb: SupabaseClient, targetTs: Date): Promise<A96Technical> {
  const empty = (error: string): A96Technical =>
    ({ macd_hist: null, atr14: null, source_ts: null, source_row_id: null, error });
  const lastTs = new Date(targetTs.getTime() - TF_MS);
  const need = A96_CONFIG.technical_min_history_candles;
  const firstTs = new Date(lastTs.getTime() - (need + 40) * TF_MS);
  const { data } = await sb
    .from("candles")
    .select("id, candle_ts, open, high, low, close")
    .eq("symbol", A96_CANDLE_STREAM.symbol)
    .eq("timeframe", A96_CANDLE_STREAM.timeframe)
    .eq("fetch_source", A96_CANDLE_STREAM.provider)
    .eq("confirm", true)
    .gte("candle_ts", firstTs.toISOString())
    .lte("candle_ts", lastTs.toISOString())
    .order("candle_ts", { ascending: true });
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length < need) return empty(`technical_history_short:${rows.length}/${need}`);

  const byTs = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const iso = new Date(String(r.candle_ts)).toISOString();
    if (byTs.has(iso)) return empty(`technical_duplicate_timestamp:${iso}`);
    byTs.set(iso, r);
  }
  // Walk backwards from T-15m building a strictly contiguous window.
  const series: Candle[] = [];
  let rowId: string | null = null;
  for (let i = 0; i < need; i++) {
    const ts = new Date(lastTs.getTime() - i * TF_MS).toISOString();
    const r = byTs.get(ts);
    if (!r) return empty(`technical_missing_candle:${ts}`);
    if (i === 0) rowId = String(r.id);
    series.unshift({
      timestamp: new Date(ts),
      open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close),
    });
  }
  const tech = macdAtrFromSeries(series);
  if (!tech) return empty("technical_calculation_invalid");
  return {
    macd_hist: tech.macd_hist,
    atr14: tech.atr14,
    source_ts: lastTs,
    source_row_id: rowId,
    error: null,
  };
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
      .select("prediction_id, target_candle_ts, resolved_at, fit_episode_id, target_open, candle_provider, r3_counterfactual_direction")
      .eq("prediction_id", predictionId)
      .maybeSingle();

    if (!row) return false;
    const r = row as Record<string, unknown>;
    if (r.resolved_at) return true;
    const targetTs = new Date(String(r.target_candle_ts));
    if (Date.now() < targetTs.getTime() + 15 * 60 * 1000) return false; // not due yet
    const ohlc = await fetchTargetCandle(sb, targetTs);
    if (!ohlc) {
      await logApiError(sb, "a96-resolve-missing-candle", {
        prediction_id: predictionId, target_candle_ts: targetTs.toISOString(), fit_episode_id: r.fit_episode_id,
      }, new Error("target candle not confirmed / not in canonical stream"));
      await sb.from("a96_predictions").update({
        last_resolution_error: "target_candle_unavailable",
        last_resolution_attempt_at: new Date().toISOString(),
      } as never).eq("prediction_id", predictionId);
      return false;
    }
    // Resolution-time consistency: actual_open vs stored target_open.
    // Always persist the numeric difference (even below threshold) so the
    // CSV always has open-vs-actual audit data.
    const storedTargetOpen = r.target_open == null ? null : Number(r.target_open);
    const storedProvider = r.candle_provider ? String(r.candle_provider) : A96_CANDLE_STREAM.provider;
    let resolution_data_invalid = false;
    let resolution_error: string | null = null;
    let target_open_difference_bps: number | null = null;
    if (storedProvider !== ohlc.provider) {
      resolution_data_invalid = true;
      resolution_error = `provider_mismatch:${storedProvider}->${ohlc.provider}`;
    }
    if (storedTargetOpen != null && storedTargetOpen > 0) {
      target_open_difference_bps = Math.abs((ohlc.open - storedTargetOpen) / storedTargetOpen) * 10_000;
      if (target_open_difference_bps > A96_RESOLUTION_OPEN_TOLERANCE_BPS) {
        resolution_data_invalid = true;
        resolution_error = `actual_open_vs_target_open_${target_open_difference_bps.toFixed(2)}bps`;
      }
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
    // Stamp resolution audit fields (RPC already set actual_*).
    // Always store target_open_difference_bps (numeric or null), and only
    // demote prospective_valid on resolution when resolution_data_invalid.
    // r3 counterfactual scoring (audit-only; never touches fit-state counters).
    const actualDir = ohlc.close > ohlc.open ? "GREEN" : ohlc.close < ohlc.open ? "RED" : "PUSH";
    const cfDir = r.r3_counterfactual_direction ? String(r.r3_counterfactual_direction) : null;
    const cfResult = cfDir == null
      ? "ABSTAIN"
      : actualDir === "PUSH" ? "PUSH" : cfDir === actualDir ? "WIN" : "LOSS";
    const cfScore = cfResult === "WIN" ? 1 : cfResult === "LOSS" ? -1 : 0;

    await sb.from("a96_predictions").update({
      target_candle_row_id: ohlc.id,
      resolution_candle_row_id: ohlc.id,
      resolution_data_invalid,
      target_open_difference_bps,
      r3_counterfactual_result: cfResult,
      r3_counterfactual_result_score: cfScore,
      ...(resolution_data_invalid ? {
        prospective_valid: false,
        prospective_invalid_reason: resolution_error ?? "RESOLUTION_DATA_INVALID",
      } : {}),
      ...(resolution_error ? { last_resolution_error: resolution_error.slice(0, 500) } : {}),
    } as never).eq("prediction_id", predictionId);

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

    // Load prediction first — need candle_ts + btc price for a potential SKIP webhook.
    const { data: pred } = await sb
      .from("predictions")
      .select("id, candle_ts, btc_price_at_prediction")
      .eq("id", predictionId)
      .maybeSingle();
    if (!pred) return;
    const targetTs = new Date(String((pred as Record<string, unknown>).candle_ts));
    const targetOpen = Number((pred as Record<string, unknown>).btc_price_at_prediction);

    // a96 webhooks are DISABLED. TD1-RC is the only outbound webhook source.
    // Upstream AAS96 skips are still surfaced in the UI (which reads the AAS96
    // shadow row directly); we just no longer notify the bot. Do not re-add a
    // deliverWebhook call here.
    const emitUpstreamSkip = async (_reason: string) => {
      /* no-op: a96 webhooks disabled */
    };


    // Load AAS shadow row for this prediction (Layer A/B directions + base selector).
    const { data: shadow } = await sb
      .from("model7_aas96_shadow")
      .select("layer_a_final_direction, layer_b_final_direction, selector_pre_override_selected_layer, eligibility_passed, skip_reason, layer_a_prob_mean")
      .eq("prediction_id", predictionId)
      .maybeSingle();

    if (!shadow) { await emitUpstreamSkip("AAS96_UPSTREAM_SKIP:shadow_row_missing"); return; }
    const s = shadow as Record<string, unknown>;
    const a = s.layer_a_final_direction as string | null;
    const b = s.layer_b_final_direction as string | null;
    const base = s.selector_pre_override_selected_layer as string | null;
    const aasSkipReason = (s.skip_reason as string | null) ?? "upstream_ineligible";
    const rawLayerAProb = s.layer_a_prob_mean;
    const layerAProbMean =
      typeof rawLayerAProb === "number" ? rawLayerAProb
      : rawLayerAProb == null ? null
      : Number(rawLayerAProb);

    if ((a !== "GREEN" && a !== "RED") || (b !== "GREEN" && b !== "RED")) {
      await emitUpstreamSkip(`AAS96_UPSTREAM_SKIP:${aasSkipReason}`);
      return;
    }
    if (base !== "A" && base !== "B") {
      await emitUpstreamSkip(`AAS96_UPSTREAM_SKIP:${aasSkipReason}`);
      return;
    }

    if (!isFinite(targetOpen) || targetOpen <= 0) return;

    // Active AAS fit id.
    const { data: fit } = await sb
      .from("model7_aas96_fits").select("fit_id")
      .eq("active", true).order("fitted_at", { ascending: false }).limit(1).maybeSingle();
    if (!fit) return;
    const artifactFitId = String((fit as Record<string, unknown>).fit_id);

    // Freshly load fit-episode state AFTER catch-up resolution.
    const fitState = await getOrMintFitEpisode(sb, artifactFitId);

    // Canonical-stream, exact-timestamp, finalized, retry-polled prior candles.
    // Poll refreshes OKX ingest between attempts so the exact required T-15m
    // row can be written to `public.candles` before we give up.
    const poll = await pollExactPriorCandles(sb, targetTs);
    const priorRows = poll.rows;
    const priorCandles: Candle[] = priorRows.map((r) => r.candle);
    const priorRowIds: string[] = priorRows.map((r) => r.id);
    const priorSnapshot = priorRows.map((r) => ({
      id: r.id,
      provider: A96_CANDLE_STREAM.provider,
      timestamp: r.candle.timestamp.toISOString(),
      open: r.candle.open, high: r.candle.high, low: r.candle.low, close: r.candle.close,
    }));

    const streamCheck = validatePriorCandleStream({ rows: priorRows, missing: poll.missing, targetTs, targetOpen });

    // Prospective-validity invariant. Only rows with fully consistent
    // prediction-time candle data may participate in the prospective
    // evaluation. Resolution-time drift can further demote a row.
    const prospectiveValid =
      streamCheck.valid === true &&
      priorRowIds.length === A96_CONFIG.required_prior_candles &&
      A96_CANDLE_STREAM.provider === "okx";
    const prospectiveInvalidReason = prospectiveValid
      ? null
      : (poll.missing.length > 0
          ? "FINALIZED_PRIOR_CANDLE_UNAVAILABLE"
          : (streamCheck.reason ?? "INVALID_CANDLE_DATA"));

    const streamAudit = {
      candle_symbol: A96_CANDLE_STREAM.symbol,
      candle_timeframe: A96_CANDLE_STREAM.timeframe,
      candle_provider: A96_CANDLE_STREAM.provider,
      prior_candle_row_ids: priorRowIds,
      candle_data_valid: streamCheck.valid,
      candle_data_invalid_reason: streamCheck.reason,
      target_open_difference_bps: streamCheck.target_open_difference_bps,
      prior_candles_snapshot: priorSnapshot,
      prospective_valid: prospectiveValid,
      prospective_invalid_reason: prospectiveInvalidReason,
    };

    // Fail-closed: if the exact prior candles are unavailable or the data
    // pipeline is inconsistent, ABSTAIN with the specific reason. Do not
    // touch the engine or fit-state counters. Rows with candle_data_valid
    // === false always have prospective_valid === false (invariant above).
    if (!streamCheck.valid) {
      const reason = poll.missing.length > 0
        ? "ABSTAIN_INVALID_CANDLE_DATA"
        : `INVALID_CANDLE_DATA:${streamCheck.reason ?? "unknown"}`;
      const { error: absErr } = await sb.from("a96_predictions").upsert({
        prediction_id: predictionId,
        source_prediction_id: predictionId,
        model_name: A96_MODEL_NAME,
        model_version: A96_MODEL_VERSION,
        variant: A96_VARIANT,
        fit_episode_id: fitState.fit_episode_id,
        artifact_fit_id: artifactFitId,
        target_candle_ts: targetTs.toISOString(),
        layer_a_direction: a,
        layer_b_direction: b,
        base_selected_layer: base,
        selected_layer: "NONE",
        final_prediction: "ABSTAIN",
        decision_reason: reason,
        fit_selector_override_fired: false,
        agreement_veto_fired: false,
        // Legacy margin band — recorded only, never gates r4.
        margin_veto_fired: false,
        layer_a_prob_mean: layerAProbMean,
        layer_a_prob_margin: layerAProbMean != null ? Math.abs(layerAProbMean - 0.5) : null,
        layer_a_probability_valid: layerAProbMean != null && Number.isFinite(layerAProbMean) && layerAProbMean >= 0 && layerAProbMean <= 1,
        margin_band_min: A96_CONFIG.legacy_margin_min_inclusive,
        margin_band_max: A96_CONFIG.legacy_margin_max_exclusive,
        margin_band_eligible: false,
        legacy_margin_condition: false,
        legacy_margin_outside_band: true,
        distance_from_4_candle_low_bps: null,
        mean_2_candle_body_to_range: null,
        distance_veto_condition: false,
        body_ratio_veto_condition: false,
        // r3 efficiency audit — not evaluated when candle data is invalid.
        four_candle_net_displacement: null,
        four_candle_total_body_path: null,
        four_candle_path_efficiency: null,
        efficiency_veto_min: A96_CONFIG.four_candle_efficiency_veto_min_inclusive,
        efficiency_veto_max: A96_CONFIG.four_candle_efficiency_veto_max_exclusive,
        efficiency_veto_condition: false,
        efficiency_veto_fired: false,
        // r4 audit — not evaluated when candle data is invalid.
        body_ratio_max: A96_CONFIG.mean_two_body_to_range_max,
        body_ratio_condition: false,
        body_ratio_veto_fired: false,
        four_candle_aligned_wick_pressure: null,
        wick_pressure_max: A96_CONFIG.four_candle_aligned_wick_pressure_max,
        wick_pressure_condition: false,
        wick_pressure_veto_fired: false,
        prior_macd_hist: null,
        prior_atr14: null,
        aligned_macd_hist_atr: null,
        macd_veto_max: A96_CONFIG.aligned_macd_hist_atr_max,
        macd_veto_condition: false,
        macd_veto_fired: false,
        r4_feature_history_valid: false,
        r4_feature_history_error: streamCheck.reason,
        technical_source_candle_time: null,
        technical_source_candle_row_id: null,
        r4_input_candle_times: requiredPriorTimestamps(targetTs),
        r4_input_candle_row_ids: priorRowIds,
        r4_feature_snapshot: {
          model_version: A96_MODEL_VERSION,
          variant: A96_VARIANT,
          invalid: true,
          reason: streamCheck.reason,
          expected_input_candle_times: requiredPriorTimestamps(targetTs),
          input_candle_row_ids: priorRowIds,
          provider: A96_CANDLE_STREAM.provider,
          confirmed: true,
          layer_a_direction: a,
          layer_b_direction: b,
          layer_a_prob_mean: layerAProbMean,
          thresholds: {
            efficiency_veto_min: A96_CONFIG.four_candle_efficiency_veto_min_inclusive,
            efficiency_veto_max: A96_CONFIG.four_candle_efficiency_veto_max_exclusive,
            agreement_distance_from_low_bps_min: A96_CONFIG.agreement_distance_from_4_low_bps,
            agreement_mean_two_body_to_range_max: A96_CONFIG.agreement_mean_2_body_to_range_max,
            mean_two_body_to_range_max: A96_CONFIG.mean_two_body_to_range_max,
            four_candle_aligned_wick_pressure_max: A96_CONFIG.four_candle_aligned_wick_pressure_max,
            aligned_macd_hist_atr_max: A96_CONFIG.aligned_macd_hist_atr_max,
          },
          decision_reason: reason,
        },
        r3_counterfactual_decision: "ABSTAIN",
        r3_counterfactual_direction: null,
        r3_counterfactual_reason: "ABSTAIN_INVALID_CANDLE_DATA",
        r3_counterfactual_margin_condition: false,
        webhook_status: "NOT_APPLICABLE",
        target_open: targetOpen,
        fit_resolved_count_at_prediction: fitState.comparable_resolved_count,
        layer_a_net_at_prediction: fitState.layer_a_net,
        layer_b_net_at_prediction: fitState.layer_b_net,
        feature_history_valid: false,
        feature_history_error: streamCheck.reason,
        ...streamAudit,
      } as never, { onConflict: "prediction_id" });

      if (absErr) throw absErr;
      // r2: invalid-candle-data rows must not emit a webhook.
      return;
    }


    // Compute agreement features from the validated snapshot.
    let feature_history_valid = true;
    let feature_history_error: string | null = null;
    let features: { distance_from_4_candle_low_bps: number; mean_2_candle_body_to_range: number } | null = null;
    try {
      features = agreementFeatures({ priorCandles, targetTimestamp: targetTs, targetOpen });
    } catch (e) {
      feature_history_valid = false;
      feature_history_error = e instanceof CandleHistoryError ? e.message : (e instanceof Error ? e.message : String(e));
    }

    // r4 technical snapshot (MACD hist + ATR14 at exactly T-15m).
    const technical = await fetchTechnicalSnapshot(sb, targetTs);

    const engineInput = {
      layerADirection: a as "GREEN" | "RED",
      layerBDirection: b as "GREEN" | "RED",
      layerAProbMean,
      baseSelectedLayer: base as Layer,
      fitState,
      targetTimestamp: targetTs,
      targetOpen,
      priorCandles,
      technical: {
        macd_hist: technical.macd_hist,
        atr14: technical.atr14,
        source_ts: technical.source_ts,
      },
    };
    rejectExternalModelInputs(engineInput);
    const decision = a96Decide(engineInput);

    // Audit-only r3 replay. Never affects the active decision or webhook.
    const r3cf = a96DecideR3Counterfactual({
      layerADirection: a as "GREEN" | "RED",
      layerBDirection: b as "GREEN" | "RED",
      layerAProbMean,
      targetTimestamp: targetTs,
      targetOpen,
      priorCandles,
    });

    const distanceBps = decision.feature_values.distance_from_4_candle_low_bps
      ?? (features ? features.distance_from_4_candle_low_bps : null);
    const meanBody = decision.feature_values.mean_2_candle_body_to_range
      ?? (features ? features.mean_2_candle_body_to_range : null);

    const publishes = decision.prediction === "GREEN" || decision.prediction === "RED";
    // a96 outbound webhooks are DISABLED. TD1-RC is the only webhook source.
    const webhookEligible = false;
    void prospectiveValid;
    void publishes;
    const idempotencyKey = `${predictionId}:${A96_MODEL_VERSION}`;
    void idempotencyKey;


    const featureSnapshot = {
      model_version: A96_MODEL_VERSION,
      variant: A96_VARIANT,
      input_candle_times: priorCandles.map((c) => c.timestamp.toISOString()),
      input_candle_row_ids: priorRowIds,
      provider: A96_CANDLE_STREAM.provider,
      symbol: A96_CANDLE_STREAM.symbol,
      timeframe: A96_CANDLE_STREAM.timeframe,
      confirmed: true,
      ohlc: priorSnapshot,
      body_to_range: {
        t30: decision.feature_values.body_to_range_t30,
        t15: decision.feature_values.body_to_range_t15,
        mean: decision.feature_values.mean_2_candle_body_to_range,
      },
      raw_wick_pressures: decision.feature_values.raw_wick_pressures,
      aligned_wick_pressures: decision.feature_values.aligned_wick_pressures,
      direction_sign: decision.feature_values.direction_sign,
      four_candle_efficiency: {
        net_displacement: decision.feature_values.four_candle_net_displacement,
        total_body_path: decision.feature_values.four_candle_total_body_path,
        path_efficiency: decision.feature_values.four_candle_path_efficiency,
      },
      macd_hist: decision.feature_values.prior_macd_hist,
      atr14: decision.feature_values.prior_atr14,
      aligned_macd_hist_atr: decision.feature_values.aligned_macd_hist_atr,
      technical_source_candle_time: technical.source_ts ? technical.source_ts.toISOString() : null,
      technical_source_candle_row_id: technical.source_row_id,
      thresholds: {
        efficiency_veto_min: A96_CONFIG.four_candle_efficiency_veto_min_inclusive,
        efficiency_veto_max: A96_CONFIG.four_candle_efficiency_veto_max_exclusive,
        agreement_distance_from_low_bps_min: A96_CONFIG.agreement_distance_from_4_low_bps,
        agreement_mean_two_body_to_range_max: A96_CONFIG.agreement_mean_2_body_to_range_max,
        mean_two_body_to_range_max: A96_CONFIG.mean_two_body_to_range_max,
        four_candle_aligned_wick_pressure_max: A96_CONFIG.four_candle_aligned_wick_pressure_max,
        aligned_macd_hist_atr_max: A96_CONFIG.aligned_macd_hist_atr_max,
      },
      layer_a_direction: a,
      layer_b_direction: b,
      layer_a_prob_mean: decision.layer_a_prob_mean,
      layer_a_prob_margin: decision.layer_a_prob_margin,
      decision_reason: decision.reason,
    };

    const { error: upsertError } = await sb.from("a96_predictions").upsert({
      prediction_id: predictionId,
      source_prediction_id: predictionId,
      model_name: A96_MODEL_NAME,
      model_version: A96_MODEL_VERSION,
      variant: A96_VARIANT,
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
      // Legacy margin band — recorded only in r4.
      margin_veto_fired: decision.margin_veto_fired,
      layer_a_prob_mean: decision.layer_a_prob_mean,
      layer_a_prob_margin: decision.layer_a_prob_margin,
      layer_a_probability_valid: decision.layer_a_probability_valid,
      margin_band_min: A96_CONFIG.legacy_margin_min_inclusive,
      margin_band_max: A96_CONFIG.legacy_margin_max_exclusive,
      margin_band_eligible: decision.margin_band_eligible,
      legacy_margin_condition: decision.legacy_margin_condition,
      legacy_margin_outside_band: decision.legacy_margin_outside_band,
      distance_from_4_candle_low_bps: distanceBps,
      mean_2_candle_body_to_range: meanBody,
      distance_veto_condition: decision.feature_values.distance_veto_condition,
      body_ratio_veto_condition: decision.feature_values.body_ratio_veto_condition,
      // r3 four-candle path-efficiency audit (immutable prediction-time values)
      four_candle_net_displacement: decision.feature_values.four_candle_net_displacement,
      four_candle_total_body_path: decision.feature_values.four_candle_total_body_path,
      four_candle_path_efficiency: decision.feature_values.four_candle_path_efficiency,
      efficiency_veto_min: A96_CONFIG.four_candle_efficiency_veto_min_inclusive,
      efficiency_veto_max: A96_CONFIG.four_candle_efficiency_veto_max_exclusive,
      efficiency_veto_condition: decision.feature_values.efficiency_veto_condition,
      efficiency_veto_fired: decision.efficiency_veto_fired,
      // r4 structure + momentum audit
      body_ratio_max: A96_CONFIG.mean_two_body_to_range_max,
      body_ratio_condition: decision.feature_values.body_concentration_condition,
      body_ratio_veto_fired: decision.body_ratio_veto_fired,
      four_candle_aligned_wick_pressure: decision.feature_values.four_candle_aligned_wick_pressure,
      wick_pressure_max: A96_CONFIG.four_candle_aligned_wick_pressure_max,
      wick_pressure_condition: decision.feature_values.wick_pressure_condition,
      wick_pressure_veto_fired: decision.wick_pressure_veto_fired,
      prior_macd_hist: decision.feature_values.prior_macd_hist,
      prior_atr14: decision.feature_values.prior_atr14,
      aligned_macd_hist_atr: decision.feature_values.aligned_macd_hist_atr,
      macd_veto_max: A96_CONFIG.aligned_macd_hist_atr_max,
      macd_veto_condition: decision.feature_values.macd_veto_condition,
      macd_veto_fired: decision.macd_veto_fired,
      r4_feature_history_valid: decision.r4_feature_history_valid,
      r4_feature_history_error: decision.r4_feature_history_error ?? technical.error,
      technical_source_candle_time: technical.source_ts ? technical.source_ts.toISOString() : null,
      technical_source_candle_row_id: technical.source_row_id,
      r4_input_candle_times: priorCandles.map((c) => c.timestamp.toISOString()),
      r4_input_candle_row_ids: priorRowIds,
      r4_feature_snapshot: featureSnapshot,
      // r3 counterfactual (audit-only)
      r3_counterfactual_decision: r3cf.decision,
      r3_counterfactual_direction: r3cf.direction,
      r3_counterfactual_reason: r3cf.reason,
      r3_counterfactual_margin_condition: r3cf.margin_condition,
      // Webhook lifecycle
      webhook_status: webhookEligible ? "PENDING" : "NOT_APPLICABLE",
      webhook_idempotency_key: webhookEligible ? idempotencyKey : null,
      target_open: targetOpen,
      fit_resolved_count_at_prediction: fitState.comparable_resolved_count,
      layer_a_net_at_prediction: fitState.layer_a_net,
      layer_b_net_at_prediction: fitState.layer_b_net,
      feature_history_valid,
      feature_history_error,
      ...streamAudit,
    } as never, { onConflict: "prediction_id" });
    if (upsertError) throw upsertError;

    // a96 outbound webhooks are DISABLED — TD1-RC is the only webhook source.
    // Rows are still persisted with webhook_status NOT_APPLICABLE.







  } catch (e) {
    await logApiError(sb, "a96-error", { prediction_id: predictionId }, e);
  }
}
