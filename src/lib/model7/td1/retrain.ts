// TD1-RC retraining. Builds training rows from historical resolved eligible
// A2_Combined signals, fits a deterministic CART, and atomically promotes the
// new fit. Retrain cadence: every 96 resolved signals since the active fit's
// trained-through boundary, or immediately when there is no active fit.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTd1Features, type PriorA2Signal } from "./features";
import { trainTd1, type TrainingRow } from "./trainer";
import { promoteTd1Fit } from "./fitStore";
import type { Candle } from "../featurize";

const BASE_VARIANT = "A2_Combined";
const RETRAIN_EVERY = 96;
const MIN_TRAINING_ROWS = 100;

async function fetchAllPaginated<T>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data } = await fetchPage(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

interface A2Row {
  candle_ts: string;
  target_boundary_ts: string | null;
  decision: "YES" | "NO";
  status: "win" | "loss";
  probability_green: number | null;
}

export type TrainOutcome =
  | { status: "trained"; trainingRows: number; fitId: string; trainedThroughCandleTs: string }
  | { status: "insufficient_signals"; signals: number }
  | { status: "insufficient_training_rows"; trainingRows: number }
  | { status: "skip"; reason: string };

export async function trainAndPromoteTd1(supabase: SupabaseClient): Promise<TrainOutcome> {
  const rawSignals = await fetchAllPaginated<A2Row>(async (from, to) =>
    await supabase
      .from("model7_shadow")
      .select("candle_ts, target_boundary_ts, decision, status, probability_green")
      .eq("variant", BASE_VARIANT)
      .in("status", ["win", "loss"])
      .in("decision", ["YES", "NO"])
      .order("candle_ts", { ascending: true })
      .range(from, to) as never,
  );
  const signals = rawSignals.filter((s) => s.probability_green != null);
  if (signals.length < MIN_TRAINING_ROWS + 8) {
    return { status: "insufficient_signals", signals: signals.length };
  }

  const rawCandles = await fetchAllPaginated<{
    candle_ts: string; open: number; high: number; low: number; close: number; volume: number | null;
  }>(async (from, to) =>
    await supabase
      .from("candles")
      .select("candle_ts, open, high, low, close, volume")
      .order("candle_ts", { ascending: true })
      .range(from, to) as never,
  );
  const candlesAsc: Candle[] = rawCandles.map((c) => ({
    candle_ts: c.candle_ts,
    open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close),
    volume: c.volume,
  }));

  const rows: TrainingRow[] = [];
  for (let i = 0; i < signals.length; i += 1) {
    const s = signals[i];
    const boundary = s.target_boundary_ts ?? s.candle_ts;
    // candles strictly before target boundary
    const candlesBefore = candlesAsc.filter((c) => c.candle_ts < boundary);
    if (candlesBefore.length < 21) continue;
    const candlesNewestFirst = candlesBefore.slice(-30).reverse();
    // prior resolved eligible signals strictly before this signal's candle_ts
    const prior = signals.slice(0, i).filter((p) => p.candle_ts < s.candle_ts);
    if (prior.length < 8) continue;
    const priorNewestFirst: PriorA2Signal[] = prior
      .slice(-20)
      .reverse()
      .map((p) => ({
        candle_ts: p.candle_ts,
        final_decision: p.decision,
        counterfactual_result: p.status === "win" ? "WIN" : "LOSS",
      }));
    try {
      const built = buildTd1Features({
        currentSide: s.decision,
        probabilityGreen: Number(s.probability_green),
        candlesNewestFirst,
        priorA2SignalsNewestFirst: priorNewestFirst,
      });
      rows.push({ features: built.features, label: s.status === "loss" ? 1 : 0 });
    } catch { /* skip unbuildable rows */ }
  }

  if (rows.length < MIN_TRAINING_ROWS) {
    return { status: "insufficient_training_rows", trainingRows: rows.length };
  }

  const lastSignal = signals[signals.length - 1];
  const trainedThrough = lastSignal.target_boundary_ts ?? lastSignal.candle_ts;
  const result = await trainTd1(rows, trainedThrough);
  await promoteTd1Fit(supabase, BASE_VARIANT, result, rows.length);
  return {
    status: "trained",
    trainingRows: rows.length,
    fitId: result.artifact.fitId,
    trainedThroughCandleTs: trainedThrough,
  };
}

// Freeze first-fit cohort configuration. When enabled, the first promoted fit
// is held active across the entire cohort of FREEZE_COHORT_SIZE matched
// resolved eligible A2_Combined signals (including TD1-vetoed signals resolved
// counterfactually — every non-SKIP TD1-RC row counts). No replacement fit is
// promoted during the cohort; normal 96-signal cadence resumes afterward.
export const TD1_FREEZE_FIRST_FIT = true;
export const FREEZE_COHORT_SIZE = 200;

export async function maybeRetrainTd1(supabase: SupabaseClient): Promise<TrainOutcome> {
  try {
    const { data: activeFit } = await supabase
      .from("model7_td1_fits")
      .select("fit_id, trained_through_candle_ts, promoted_at")
      .eq("base_variant", BASE_VARIANT)
      .eq("active", true)
      .maybeSingle();
    if (!activeFit) return await trainAndPromoteTd1(supabase);

    const fit = activeFit as { fit_id: string; trained_through_candle_ts: string; promoted_at: string };

    // Cohort progress: matched resolved eligible A2_Combined signals scored by
    // this fit. A row counts once its A2 counterfactual result is known
    // (a2_counterfactual_result IS NOT NULL) and the TD1 decision was made
    // against a real fit (external_final_decision in YES/NO/SKIP with td1_fit_id set).
    if (TD1_FREEZE_FIRST_FIT) {
      const { count: cohortResolved } = await supabase
        .from("model7_td1_rc_shadow")
        .select("id", { count: "exact", head: true })
        .eq("a2_source_variant", BASE_VARIANT)
        .eq("td1_fit_id", fit.fit_id)
        .not("a2_counterfactual_result", "is", null);
      const resolvedInCohort = cohortResolved ?? 0;
      if (resolvedInCohort < FREEZE_COHORT_SIZE) {
        return {
          status: "skip",
          reason: `freeze_active:cohort_resolved=${resolvedInCohort}/${FREEZE_COHORT_SIZE}:fit=${fit.fit_id}`,
        };
      }
      // Cohort complete — fall through to normal cadence check.
    }

    const { count } = await supabase
      .from("model7_shadow")
      .select("id", { count: "exact", head: true })
      .eq("variant", BASE_VARIANT)
      .in("status", ["win", "loss"])
      .in("decision", ["YES", "NO"])
      .gt("candle_ts", fit.trained_through_candle_ts);
    if ((count ?? 0) < RETRAIN_EVERY) {
      return { status: "skip", reason: `new_resolved=${count ?? 0}` };
    }
    return await trainAndPromoteTd1(supabase);
  } catch (e) {
    return { status: "skip", reason: `error:${e instanceof Error ? e.message : String(e)}` };
  }
}
