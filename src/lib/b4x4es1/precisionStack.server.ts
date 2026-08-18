// B4x4-ES1 Balanced Precision Stack R1 — live wiring (server only).
//
// This is the ACTIVE publication policy. It runs after the Binance Dual-Venue
// Adaptive chain (retained as a scored counterfactual) and reads the exact
// target-boundary Binance features plus canonical candles. Direction is frozen
// research logic in `precisionStack.ts`; nothing here may alter it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTechnicalRows, type RawCandle } from "@/lib/v6/technical";
import {
  PRECISION_FILL_MIN_CONFIDENCE,
  PRECISION_PRIMARY_MAX_TREND_AGE,
  PRECISION_RESCUE_MAX_WICK_PERCENTILE,
  PRECISION_STACK_POLICY_ID,
  PRECISION_WICK_PERCENTILE_WINDOW,
  decidePrecisionStack,
  upperWickPercentile,
  type Direction,
  type PrecisionStackDecision,
  type PrecisionStackInputs,
} from "./precisionStack";
import {
  fitTechnicalModel,
  technicalTrainEndFor,
  type TechnicalFeatureRow,
  type TechnicalModel,
} from "./precisionTechnical";
import { TF_MS } from "./config";

type DbRow = Record<string, unknown>;
type Outcome = Direction | "PUSH";

/** Publication switch. Rows are always recorded either way. */
export const PRECISION_PUBLICATION_ENABLED = true;

export const PRECISION_MODEL_VERSION = "b4x4-es1-balanced-precision-stack-r1";
export const PRECISION_POLICY_VERSION = "precision-stack-r1";
export const PRECISION_IMPLEMENTATION_REVISION = "precision-stack-r1-impl1";
export const PRECISION_VARIANT = "PRECISION_STACK";
export const PRECISION_RESOLVER_VERSION = "precision-r1";
export const PRECISION_ACTIVATION_ID = "b4x4-es1";
export const PRECISION_APPROVAL_NOTE =
  "Approved frozen policy: research Balanced Router (venue FADE/FOLLOW + activity guard, technical fill at |p-0.5| >= 0.06) with trend-age Primary and upper-wick Rescue sleeves." as const;

/** Hard ceiling on the walk-forward technical fill work at boundary time. */
const TECHNICAL_BUDGET_MS = 6_000;
/** Boundary features are only ever read up to and including the target. */
const FEATURE_VERSION = "binance-ob-r1";

export function precisionConfigHash(): string {
  const payload = [
    PRECISION_STACK_POLICY_ID,
    PRECISION_FILL_MIN_CONFIDENCE,
    PRECISION_PRIMARY_MAX_TREND_AGE,
    PRECISION_RESCUE_MAX_WICK_PERCENTILE,
    PRECISION_WICK_PERCENTILE_WINDOW,
    PRECISION_IMPLEMENTATION_REVISION,
  ].join("|");
  let h = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `pstack-${(h >>> 0).toString(16)}`;
}

function inputHash(targetTs: string, inp: PrecisionStackInputs): string {
  const payload = [
    targetTs,
    inp.spotAdaptiveDirection,
    inp.perpAdaptiveDirection,
    inp.perpSignChangeCount60s,
    inp.spotNormalizedOfi5s,
    inp.technicalDirection,
    inp.technicalConfidence,
    inp.priorTrendAgeCandles,
    inp.upperWickPercentile96,
  ].join("|");
  let h = 5381;
  for (let i = 0; i < payload.length; i++) h = (Math.imul(h, 33) ^ payload.charCodeAt(i)) >>> 0;
  return `pin-${h.toString(16)}`;
}

function nextCleanBoundaryTs(targetTs: string): string {
  return new Date(Math.floor(new Date(targetTs).getTime() / TF_MS) * TF_MS + TF_MS).toISOString();
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Venue orientation, frozen research definition: FADE the final imbalance when
 * the 60s mean agrees with it, otherwise FOLLOW it.
 */
export function venueOrientation(
  final: number | null,
  mean60: number | null,
): { mode: "FADE" | "FOLLOW" | "NONE"; direction: Direction | null } {
  if (final === null || !Number.isFinite(final) || final === 0) {
    return { mode: "NONE", direction: null };
  }
  const followDir: Direction = final > 0 ? "GREEN" : "RED";
  const agree = mean60 !== null && Number.isFinite(mean60) && Math.sign(mean60) === Math.sign(final);
  return agree
    ? { mode: "FADE", direction: followDir === "GREEN" ? "RED" : "GREEN" }
    : { mode: "FOLLOW", direction: followDir };
}

interface ObFeature {
  ready: boolean;
  finalImbalance: number | null;
  meanImbalance60s: number | null;
  signChangeCount60s: number | null;
  normalizedOfi5s: number | null;
  resyncContinuous: boolean;
}

async function loadBoundaryFeatures(
  sb: SupabaseClient,
  targetTs: string,
): Promise<{ spot: Map<string, ObFeature>; perp: Map<string, ObFeature> }> {
  const spot = new Map<string, ObFeature>();
  const perp = new Map<string, ObFeature>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("b4x4_es1_binance_ob_boundary_features")
      .select(
        "target_ts, market_kind, ready, final_imbalance_10bps, mean_imbalance_10bps_60s, sign_change_count_60s, normalized_ofi_5s, resync_continuous",
      )
      .eq("feature_version", FEATURE_VERSION)
      .lte("target_ts", targetTs)
      .order("target_ts", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`precision_features_load:${error.message}`);
    const rows = (data ?? []) as DbRow[];
    for (const r of rows) {
      const ts = new Date(String(r.target_ts)).toISOString();
      const f: ObFeature = {
        ready: r.ready === true,
        finalImbalance: num(r.final_imbalance_10bps),
        meanImbalance60s: num(r.mean_imbalance_10bps_60s),
        signChangeCount60s: num(r.sign_change_count_60s),
        normalizedOfi5s: num(r.normalized_ofi_5s),
        resyncContinuous: r.resync_continuous === true,
      };
      (r.market_kind === "SPOT" ? spot : perp).set(ts, f);
    }
    if (rows.length < PAGE) break;
  }
  return { spot, perp };
}

interface Opportunity {
  targetTs: string;
  spot: ObFeature;
  perp: ObFeature;
  techRow: TechnicalFeatureRow;
  trendAge: number | null;
  wickPercentile: number | null;
  actual: Outcome | null;
}

export interface PrecisionContext {
  index: number;
  inputs: PrecisionStackInputs;
  spot: ObFeature | null;
  perp: ObFeature | null;
  spotMode: "FADE" | "FOLLOW" | "NONE";
  perpMode: "FADE" | "FOLLOW" | "NONE";
  technicalPGreen: number | null;
  technicalTrainRows: number | null;
  technicalError: string | null;
  bothVenuesReady: boolean;
  buildMs: number;
}

/**
 * Build the frozen research inputs for `targetTs` using production data only:
 * exact-target Binance boundary features and canonical candles up to the prior
 * close. The walk-forward technical fill is refit in 16-opportunity blocks on
 * strictly prior resolved opportunities.
 */
export async function buildPrecisionContext(
  sb: SupabaseClient,
  targetTs: string,
): Promise<PrecisionContext> {
  const started = Date.now();
  const { loadCanonicalCandles } = await import("./data.server");
  const [candles, features] = await Promise.all([
    loadCanonicalCandles(sb),
    loadBoundaryFeatures(sb, targetTs),
  ]);

  const raw: (RawCandle & { candle_ts: string })[] = candles.map((c) => ({
    candle_ts: c.candleTs,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  })) as (RawCandle & { candle_ts: string })[];
  const tech = buildTechnicalRows(raw);
  const techByTs = new Map<string, TechnicalFeatureRow>();
  const candleByTs = new Map<string, (typeof raw)[number]>();
  const wickShares: number[] = [];
  const wickIndex = new Map<string, number>();
  raw.forEach((c, i) => {
    const ts = new Date(c.candle_ts).toISOString();
    techByTs.set(ts, tech[i] as TechnicalFeatureRow);
    candleByTs.set(ts, c);
    const rng = c.high - c.low;
    wickIndex.set(ts, wickShares.length);
    wickShares.push(rng > 0 ? (c.high - Math.max(c.open, c.close)) / rng : 0);
  });

  const timestamps = [...features.spot.keys()]
    .filter((ts) => features.perp.has(ts))
    .sort()
    .filter((ts) => ts <= targetTs);

  const opps: Opportunity[] = [];
  for (const ts of timestamps) {
    const s = features.spot.get(ts)!;
    const p = features.perp.get(ts)!;
    if (!s.ready || !p.ready) continue;
    const priorTs = new Date(new Date(ts).getTime() - TF_MS).toISOString();
    const techRow = techByTs.get(priorTs);
    if (!techRow) continue;
    const idx = wickIndex.get(priorTs)!;
    const hist = wickShares.slice(Math.max(0, idx - PRECISION_WICK_PERCENTILE_WINDOW), idx);
    const wickPercentile = upperWickPercentile(hist, wickShares[idx]);
    const trendAgeRaw = techRow["trend_age_candles"];
    const target = candleByTs.get(ts);
    const actual: Outcome | null = target
      ? target.close > target.open
        ? "GREEN"
        : target.close < target.open
          ? "RED"
          : "PUSH"
      : null;
    opps.push({
      targetTs: ts,
      spot: s,
      perp: p,
      techRow: {
        ...techRow,
        boundary_contiguous: s.resyncContinuous && p.resyncContinuous ? 1 : 0,
      },
      trendAge: typeof trendAgeRaw === "number" ? trendAgeRaw : null,
      wickPercentile,
      actual,
    });
  }

  const spot = features.spot.get(targetTs) ?? null;
  const perp = features.perp.get(targetTs) ?? null;
  const bothVenuesReady = spot?.ready === true && perp?.ready === true;
  const index = opps.findIndex((o) => o.targetTs === targetTs);
  const current = index >= 0 ? opps[index] : null;

  const spotOrient = venueOrientation(spot?.finalImbalance ?? null, spot?.meanImbalance60s ?? null);
  const perpOrient = venueOrientation(perp?.finalImbalance ?? null, perp?.meanImbalance60s ?? null);

  // Walk-forward technical fill for the block containing this opportunity.
  let model: TechnicalModel | null = null;
  let technicalError: string | null = null;
  let trainRows: number | null = null;
  if (current) {
    try {
      const trainEnd = technicalTrainEndFor(index);
      if (trainEnd === null) {
        technicalError = "NO_FIT_WINDOW";
      } else if (Date.now() - started > TECHNICAL_BUDGET_MS) {
        technicalError = "BUDGET_EXCEEDED_BEFORE_FIT";
      } else {
        const train = opps.slice(0, trainEnd).filter((o) => o.actual !== null && o.actual !== "PUSH");
        model = fitTechnicalModel(
          train.map((o) => o.techRow),
          train.map((o) => (o.actual === "GREEN" ? 1 : 0)),
        );
        trainRows = train.length;
        if (!model) technicalError = "FIT_UNAVAILABLE";
      }
    } catch (e) {
      technicalError = e instanceof Error ? e.message : String(e);
      model = null;
    }
  }

  const pGreen = model && current ? model.predictGreenProbability(current.techRow) : null;

  const inputs: PrecisionStackInputs = {
    spotAdaptiveDirection: bothVenuesReady ? spotOrient.direction : null,
    perpAdaptiveDirection: bothVenuesReady ? perpOrient.direction : null,
    perpSignChangeCount60s: perp?.signChangeCount60s ?? null,
    spotNormalizedOfi5s: spot?.normalizedOfi5s ?? null,
    technicalDirection: pGreen === null ? null : pGreen >= 0.5 ? "GREEN" : "RED",
    technicalConfidence: pGreen === null ? null : Math.abs(pGreen - 0.5),
    priorTrendAgeCandles: current?.trendAge ?? null,
    upperWickPercentile96: current?.wickPercentile ?? null,
  };

  return {
    index,
    inputs,
    spot,
    perp,
    spotMode: spotOrient.mode,
    perpMode: perpOrient.mode,
    technicalPGreen: pGreen,
    technicalTrainRows: trainRows,
    technicalError,
    bothVenuesReady,
    buildMs: Date.now() - started,
  };
}

/**
 * `b4x4_es1_activation` holds the single authoritative activation record. The
 * precision boundary is committed exactly once, on the first target where both
 * Binance books are ready, and always points at a FUTURE clean boundary.
 */
export async function ensurePrecisionActivation(
  sb: SupabaseClient,
  eligible: boolean,
  snapshot: Record<string, unknown>,
  targetTs: string,
): Promise<string | null> {
  const existing = await readPrecisionActivationTs(sb);
  if (existing) return existing;
  if (!eligible) return null;

  const activationTs = nextCleanBoundaryTs(targetTs);
  const now = new Date().toISOString();
  await sb
    .from("b4x4_es1_activation")
    .update({
      precision_mode: "ACTIVE",
      precision_policy_id: PRECISION_STACK_POLICY_ID,
      precision_policy_version: PRECISION_POLICY_VERSION,
      precision_config_hash: precisionConfigHash(),
      precision_approved_at: now,
      precision_approval_note: PRECISION_APPROVAL_NOTE,
      precision_activation_target_ts: activationTs,
      precision_activation_snapshot: snapshot,
      precision_created_at: now,
    } as never)
    .eq("id", PRECISION_ACTIVATION_ID)
    .is("precision_activation_target_ts", null);

  return readPrecisionActivationTs(sb);
}

export async function readPrecisionActivationTs(sb: SupabaseClient): Promise<string | null> {
  const { data } = await sb
    .from("b4x4_es1_activation")
    .select("precision_activation_target_ts")
    .eq("id", PRECISION_ACTIVATION_ID)
    .maybeSingle();
  const ts = (data as DbRow | null)?.precision_activation_target_ts as string | undefined;
  return ts ? new Date(ts).toISOString() : null;
}

export interface PrecisionRunResult {
  decision: PrecisionStackDecision;
  context: PrecisionContext;
  activated: boolean;
  patch: DbRow;
}

function decisionReasonFor(
  ctx: PrecisionContext,
  d: PrecisionStackDecision,
  activated: boolean,
): string {
  if (!ctx.bothVenuesReady) return "ABSTAIN_PRECISION_VENUES_NOT_READY";
  if (!d.balanced.wouldTrade) {
    if (d.balanced.dualAgree && !d.balanced.activityGuardPassed) {
      return "ABSTAIN_PRECISION_ACTIVITY_GUARD";
    }
    return "ABSTAIN_PRECISION_FILL_BELOW_CONFIDENCE";
  }
  if (d.primary.wouldTrade) {
    return d.balanced.core ? "PUBLISH_PRECISION_PRIMARY_CORE" : "PUBLISH_PRECISION_PRIMARY_FILL";
  }
  if (d.rescue.wouldTrade) return "PUBLISH_PRECISION_RESCUE_WICK_FLIP";
  if (!activated) return "ABSTAIN_PRECISION_PRE_ACTIVATION";
  return "ABSTAIN_PRECISION_STALE_TREND_NO_RESCUE";
}

/**
 * Decide, persist and (when activated) take over the primary publication
 * fields. The Dual-Venue Adaptive chain has already been recorded and remains
 * a fully scored counterfactual.
 */
export async function runPrecisionForPrediction(
  sb: SupabaseClient,
  row: DbRow,
  targetTs: string,
): Promise<PrecisionRunResult | null> {
  const predictionId = String(row.id);
  const isLive = row.run_mode === "LIVE";

  let ctx: PrecisionContext;
  try {
    ctx = await buildPrecisionContext(sb, targetTs);
  } catch (e) {
    // Fail closed: an input failure is an auditable abstention, never a
    // fallback to another model's direction.
    const message = e instanceof Error ? e.message : String(e);
    await sb
      .from("b4x4_es1_predictions")
      .update({
        precision_policy_id: PRECISION_STACK_POLICY_ID,
        precision_policy_version: PRECISION_POLICY_VERSION,
        precision_implementation_revision: PRECISION_IMPLEMENTATION_REVISION,
        precision_config_hash: precisionConfigHash(),
        precision_ready: false,
        precision_ready_reason: `PRECISION_INPUT_LOAD_FAILED:${message}`,
        precision_would_trade: false,
        precision_candidate_direction: null,
        precision_decision_reason: "ABSTAIN_PRECISION_INPUT_LOAD_FAILED",
        precision_webhook_eligible: false,
        precision_resolver_version: PRECISION_RESOLVER_VERSION,
      } as never)
      .eq("id", predictionId);
    return null;
  }

  const activationTargetTs = await ensurePrecisionActivation(
    sb,
    ctx.bothVenuesReady,
    {
      target_ts: targetTs,
      spot_ready: ctx.spot?.ready ?? false,
      perp_ready: ctx.perp?.ready ?? false,
      checked_at: new Date().toISOString(),
    },
    targetTs,
  ).catch(() => null);

  const decision = decidePrecisionStack(ctx.inputs);
  const activated =
    activationTargetTs != null &&
    new Date(targetTs).getTime() >= new Date(activationTargetTs).getTime();
  const reason = decisionReasonFor(ctx, decision, activated);

  const wouldTrade = activated && decision.combined.wouldTrade;
  const direction = wouldTrade ? decision.combined.direction : null;
  const webhookEligible =
    PRECISION_PUBLICATION_ENABLED && isLive && activated && wouldTrade && direction != null;

  const sleeve = decision.primary.wouldTrade
    ? "PRIMARY"
    : decision.rescue.wouldTrade
      ? "RESCUE"
      : "NONE";
  const balancedRoute = decision.balanced.core ? "OB_CORE" : decision.balanced.fill ? "TECHNICAL_FILL" : "NONE";

  const patch: DbRow = {
    precision_policy_id: PRECISION_STACK_POLICY_ID,
    precision_policy_version: PRECISION_POLICY_VERSION,
    precision_implementation_revision: PRECISION_IMPLEMENTATION_REVISION,
    precision_config_hash: precisionConfigHash(),
    precision_activation_id: PRECISION_ACTIVATION_ID,
    precision_activation_target_ts: activationTargetTs,
    precision_activated: activated,
    precision_input_hash: inputHash(targetTs, ctx.inputs),
    precision_opportunity_index: ctx.index >= 0 ? ctx.index : null,
    precision_ready: ctx.bothVenuesReady,
    precision_ready_reason: ctx.bothVenuesReady ? "READY" : "VENUE_NOT_READY",
    precision_spot_ready: ctx.spot?.ready ?? false,
    precision_perp_ready: ctx.perp?.ready ?? false,
    precision_spot_mode: ctx.spotMode,
    precision_spot_direction: ctx.inputs.spotAdaptiveDirection,
    precision_perp_mode: ctx.perpMode,
    precision_perp_direction: ctx.inputs.perpAdaptiveDirection,
    precision_venue_agreement: decision.balanced.dualAgree,
    precision_activity_guard_passed: decision.balanced.activityGuardPassed,
    precision_spot_final_imbalance_10bps: ctx.spot?.finalImbalance ?? null,
    precision_spot_mean_imbalance_10bps_60s: ctx.spot?.meanImbalance60s ?? null,
    precision_perp_final_imbalance_10bps: ctx.perp?.finalImbalance ?? null,
    precision_perp_mean_imbalance_10bps_60s: ctx.perp?.meanImbalance60s ?? null,
    precision_perp_sign_change_count_60s: ctx.perp?.signChangeCount60s ?? null,
    precision_spot_normalized_ofi_5s: ctx.spot?.normalizedOfi5s ?? null,
    precision_technical_direction: ctx.inputs.technicalDirection,
    precision_technical_confidence: ctx.inputs.technicalConfidence,
    precision_technical_p_green: ctx.technicalPGreen,
    precision_technical_train_rows: ctx.technicalTrainRows,
    precision_technical_model_available: ctx.technicalPGreen !== null,
    precision_technical_error: ctx.technicalError,
    precision_balanced_route: balancedRoute,
    precision_balanced_would_trade: decision.balanced.wouldTrade,
    precision_balanced_direction: decision.balanced.direction,
    precision_prior_trend_age_candles: ctx.inputs.priorTrendAgeCandles,
    precision_upper_wick_percentile_96: ctx.inputs.upperWickPercentile96,
    precision_primary_would_trade: decision.primary.wouldTrade,
    precision_primary_direction: decision.primary.direction,
    precision_rescue_would_trade: decision.rescue.wouldTrade,
    precision_rescue_direction: decision.rescue.direction,
    precision_sleeve: sleeve,
    precision_would_trade: wouldTrade,
    precision_candidate_direction: direction,
    precision_decision_reason: reason,
    precision_webhook_eligible: webhookEligible,
    precision_resolver_version: PRECISION_RESOLVER_VERSION,
    precision_build_ms: ctx.buildMs,
  };

  // At/after activation the primary row fields describe the Precision Stack.
  // Every earlier chain has already been snapshotted into its own columns.
  if (activated) {
    patch.model_version = PRECISION_MODEL_VERSION;
    patch.variant = PRECISION_VARIANT;
    patch.final_prediction = direction;
    patch.would_trade = wouldTrade;
    patch.decision_reason = reason;
    patch.webhook_eligible = webhookEligible;
    patch.balanced_webhook_eligible = false;
    patch.dual_adaptive_webhook_eligible = false;
  }

  await sb.from("b4x4_es1_predictions").update(patch as never).eq("id", predictionId);
  return { decision, context: ctx, activated, patch };
}

/** Idempotent scoring of the precision legs against the confirmed candle. */
export async function resolvePrecisionRow(
  sb: SupabaseClient,
  row: DbRow,
  actual: Outcome,
): Promise<void> {
  const score = (traded: boolean, dir: unknown) => {
    if (!traded || (dir !== "GREEN" && dir !== "RED") || actual === "PUSH") {
      return { result: "PUSH" as const, score: 0 };
    }
    return dir === actual
      ? { result: "WIN" as const, score: 1 }
      : { result: "LOSS" as const, score: -1 };
  };

  const combined = score(row.precision_would_trade === true, row.precision_candidate_direction);
  const balanced = score(
    row.precision_balanced_would_trade === true,
    row.precision_balanced_direction,
  );

  await sb
    .from("b4x4_es1_predictions")
    .update({
      precision_result: combined.result,
      precision_result_score: combined.score,
      precision_balanced_result: balanced.result,
      precision_balanced_result_score: balanced.score,
      precision_resolved_at: new Date().toISOString(),
      precision_resolver_version: PRECISION_RESOLVER_VERSION,
      precision_resolution_attempt_count:
        Number(row.precision_resolution_attempt_count ?? 0) + 1,
    } as never)
    .eq("id", String(row.id))
    .is("precision_resolved_at", null);
}
