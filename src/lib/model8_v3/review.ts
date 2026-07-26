// Model 3 FWD v3.0.1 — candidate-vs-active review report builder.
// Pure functions. Consumed by the orchestrator on 96-candle checkpoints
// and by server functions that surface reports in the UI.

import type { Candle } from "./features";
import { buildTrainingMatrix } from "./features";
import { predictProb, applyPlatt } from "./logistic";
import { computeRegimeSnapshot, type RegimeLabel } from "./regime";

export interface FitBundle {
  fit_id: string;
  weights_dir: number[]; intercept_dir: number;
  weights_move: number[]; intercept_move: number;
  means: number[]; scales: number[];
  platt_dir: { a: number; b: number };
  platt_move: { a: number; b: number };
}

export interface OfficialRow {
  target_candle_ts: string;
  actual_direction: string | null;
  raw_result: string | null;
  qualified_result: string | null;
  raw_prediction: string | null;
  qualified_prediction: string | null;
  calibrated_probability_green: number | null;
  regime_label: RegimeLabel | null;
  regime_transition_score: number | null;
}

function acc(rows: OfficialRow[], key: "raw_result" | "qualified_result") {
  let w = 0, l = 0, p = 0, a = 0;
  for (const r of rows) {
    const v = r[key];
    if (v === "WIN") w++;
    else if (v === "LOSS") l++;
    else if (v === "PUSH") p++;
    else if (v === "ABSTAIN") a++;
  }
  const decided = w + l;
  return { wins: w, losses: l, pushes: p, abstains: a, trades: decided,
    win_rate: decided ? Math.round((w / decided) * 10000) / 100 : 0 };
}

function brierLogloss(rows: OfficialRow[]) {
  let bs = 0, ll = 0, n = 0;
  for (const r of rows) {
    const p = r.calibrated_probability_green;
    const dir = r.actual_direction;
    if (p == null || (dir !== "GREEN" && dir !== "RED")) continue;
    const y = dir === "GREEN" ? 1 : 0;
    bs += (p - y) ** 2;
    const c = Math.min(0.9999, Math.max(0.0001, p));
    ll += -(y * Math.log(c) + (1 - y) * Math.log(1 - c));
    n++;
  }
  return { brier: n ? Math.round((bs / n) * 10000) / 10000 : 0,
    log_loss: n ? Math.round((ll / n) * 10000) / 10000 : 0, scored: n };
}

function greenRed(rows: OfficialRow[], predKey: "raw_prediction" | "qualified_prediction", resKey: "raw_result" | "qualified_result") {
  let gW = 0, gT = 0, rW = 0, rT = 0;
  for (const r of rows) {
    const res = r[resKey];
    if (res !== "WIN" && res !== "LOSS") continue;
    if (r[predKey] === "GREEN") { gT++; if (res === "WIN") gW++; }
    else if (r[predKey] === "RED") { rT++; if (res === "WIN") rW++; }
  }
  return {
    green_win_rate: gT ? Math.round((gW / gT) * 10000) / 100 : 0, green_total: gT,
    red_win_rate: rT ? Math.round((rW / rT) * 10000) / 100 : 0, red_total: rT,
  };
}

function abstainedRawAcc(rows: OfficialRow[]) {
  const sub = rows.filter((r) => r.qualified_result === "ABSTAIN" && (r.raw_result === "WIN" || r.raw_result === "LOSS"));
  return acc(sub, "raw_result");
}

function drawdown(rows: OfficialRow[], key: "raw_result" | "qualified_result") {
  const ordered = [...rows]
    .filter((r) => r[key] === "WIN" || r[key] === "LOSS")
    .sort((a, b) => a.target_candle_ts.localeCompare(b.target_candle_ts));
  let running = 0, peak = 0, maxDD = 0, streak = 0, worst = 0;
  for (const r of ordered) {
    if (r[key] === "WIN") { running++; streak = 0; }
    else { running--; streak++; if (streak > worst) worst = streak; }
    if (running > peak) peak = running;
    if (peak - running > maxDD) maxDD = peak - running;
  }
  return { max_drawdown: maxDD, longest_losing_streak: worst };
}

function calibrationBuckets(rows: OfficialRow[]) {
  const buckets = ["0.00-0.20", "0.20-0.40", "0.40-0.60", "0.60-0.80", "0.80-1.00"];
  const totals: Record<string, { sumP: number; wins: number; n: number }> = {};
  for (const b of buckets) totals[b] = { sumP: 0, wins: 0, n: 0 };
  for (const r of rows) {
    const p = r.calibrated_probability_green;
    const dir = r.actual_direction;
    if (p == null || (dir !== "GREEN" && dir !== "RED")) continue;
    const b = p < 0.2 ? buckets[0] : p < 0.4 ? buckets[1] : p < 0.6 ? buckets[2] : p < 0.8 ? buckets[3] : buckets[4];
    totals[b].sumP += p; totals[b].wins += dir === "GREEN" ? 1 : 0; totals[b].n++;
  }
  const out: Record<string, { n: number; avg_pred: number; empirical: number }> = {};
  for (const b of buckets) {
    const t = totals[b];
    out[b] = { n: t.n,
      avg_pred: t.n ? Math.round((t.sumP / t.n) * 10000) / 10000 : 0,
      empirical: t.n ? Math.round((t.wins / t.n) * 10000) / 10000 : 0 };
  }
  return out;
}

function regimeSlice(rows: OfficialRow[]) {
  const out: Record<string, ReturnType<typeof acc>> = {};
  for (const label of ["LOW_VOL_RANGE","LOW_VOL_TREND","HIGH_VOL_RANGE","HIGH_VOL_TREND","TRANSITION"]) {
    out[label] = acc(rows.filter((r) => r.regime_label === label), "qualified_result");
  }
  return out;
}

function transitionSplit(rows: OfficialRow[]) {
  const t = rows.filter((r) => (r.regime_transition_score ?? 0) >= 0.5);
  const nt = rows.filter((r) => (r.regime_transition_score ?? 0) < 0.5);
  return {
    transition: acc(t, "qualified_result"),
    non_transition: acc(nt, "qualified_result"),
  };
}

/** Score how a fit WOULD have performed on the given rows, using stored feature_values. */
function scoreFitOnRows(fit: FitBundle, rows: Array<Record<string, unknown>>, featureOrder: string[], config: { edge: number; movementProb: number }): OfficialRow[] {
  return rows.map((r) => {
    const fv = (r.feature_values ?? {}) as Record<string, number>;
    const x = featureOrder.map((n) => Number(fv[n] ?? 0));
    const rawDir = predictProb(x, fit.weights_dir, fit.intercept_dir, fit.means, fit.scales);
    const rawMove = predictProb(x, fit.weights_move, fit.intercept_move, fit.means, fit.scales);
    const calDir = applyPlatt(rawDir, fit.platt_dir.a, fit.platt_dir.b);
    const calMove = applyPlatt(rawMove, fit.platt_move.a, fit.platt_move.b);
    const edge = calDir - 0.5;
    const raw: "GREEN" | "RED" = rawDir >= 0.5 ? "GREEN" : "RED";
    let qual: "GREEN" | "RED" | "ABSTAIN" = "ABSTAIN";
    if (calMove >= config.movementProb && Math.abs(edge) >= config.edge) qual = edge > 0 ? "GREEN" : "RED";
    const dir = r.actual_direction as string | null;
    const rawRes = dir == null ? null : dir === "PUSH" ? "PUSH" : raw === dir ? "WIN" : "LOSS";
    const qualRes = dir == null ? null : qual === "ABSTAIN" ? "ABSTAIN" : dir === "PUSH" ? "PUSH" : qual === dir ? "WIN" : "LOSS";
    return {
      target_candle_ts: String(r.target_candle_ts),
      actual_direction: dir,
      raw_result: rawRes,
      qualified_result: qualRes,
      raw_prediction: raw,
      qualified_prediction: qual,
      calibrated_probability_green: calDir,
      regime_label: (r.regime_label as RegimeLabel | null) ?? null,
      regime_transition_score: (r.regime_transition_score as number | null) ?? null,
    };
  });
}

export function performanceReport(rows: OfficialRow[]) {
  return {
    raw: acc(rows, "raw_result"),
    qualified: acc(rows, "qualified_result"),
    abstained_raw: abstainedRawAcc(rows),
    coverage_pct: (() => {
      const q = acc(rows, "qualified_result");
      const total = q.trades + q.abstains;
      return total ? Math.round((q.trades / total) * 10000) / 100 : 0;
    })(),
    brier_logloss: brierLogloss(rows),
    green_red_qualified: greenRed(rows, "qualified_prediction", "qualified_result"),
    green_red_raw: greenRed(rows, "raw_prediction", "raw_result"),
    calibration: calibrationBuckets(rows),
    drawdown: drawdown(rows, "qualified_result"),
    by_regime: regimeSlice(rows),
    transition_split: transitionSplit(rows),
    row_count: rows.length,
  };
}

/** Build the candidate-vs-active report used at each 96-candle checkpoint. */
export function buildCandidateReviewReport(input: {
  candidateFit: FitBundle;
  activeFit: FitBundle | null;
  activeRows: Array<Record<string, unknown>>; // official predictions, newest first
  featureOrder: string[];
  edge: number;
  movementProb: number;
}) {
  const active = input.activeRows.map((r) => ({
    target_candle_ts: String(r.target_candle_ts),
    actual_direction: r.actual_direction as string | null,
    raw_result: r.raw_result as string | null,
    qualified_result: r.qualified_result as string | null,
    raw_prediction: r.raw_prediction as string | null,
    qualified_prediction: r.qualified_prediction as string | null,
    calibrated_probability_green: r.calibrated_probability_green as number | null,
    regime_label: (r.regime_label as RegimeLabel | null) ?? null,
    regime_transition_score: (r.regime_transition_score as number | null) ?? null,
  } as OfficialRow));

  // Newest-first slices → take() from the top.
  const last96 = active.slice(0, 96);
  const last384 = active.slice(0, 384);
  const cumulative = active;

  const cand96 = scoreFitOnRows(input.candidateFit, input.activeRows.slice(0, 96), input.featureOrder, { edge: input.edge, movementProb: input.movementProb });
  const cand384 = scoreFitOnRows(input.candidateFit, input.activeRows.slice(0, 384), input.featureOrder, { edge: input.edge, movementProb: input.movementProb });
  const candCum = scoreFitOnRows(input.candidateFit, input.activeRows, input.featureOrder, { edge: input.edge, movementProb: input.movementProb });

  return {
    generated_at: new Date().toISOString(),
    candidate_fit_id: input.candidateFit.fit_id,
    active_fit_id: input.activeFit?.fit_id ?? null,
    windows: {
      last_96: { active: performanceReport(last96), candidate_counterfactual: performanceReport(cand96) },
      last_384: { active: performanceReport(last384), candidate_counterfactual: performanceReport(cand384) },
      cumulative: { active: performanceReport(cumulative), candidate_counterfactual: performanceReport(candCum) },
    },
    alerts_summary: {
      transition_rows: active.filter((r) => (r.regime_transition_score ?? 0) >= 0.5).length,
      // Simple calibration deterioration by regime: candidate brier lower than active on any regime.
      calibration_deterioration_by_regime: (() => {
        const out: Record<string, { active_brier: number; candidate_brier: number; delta: number }> = {};
        for (const label of ["LOW_VOL_RANGE","LOW_VOL_TREND","HIGH_VOL_RANGE","HIGH_VOL_TREND","TRANSITION"]) {
          const a = brierLogloss(active.filter((r) => r.regime_label === label));
          const idxs = input.activeRows
            .map((r, i) => (r.regime_label === label ? i : -1))
            .filter((i) => i >= 0);
          const candSubset = scoreFitOnRows(input.candidateFit, idxs.map((i) => input.activeRows[i]), input.featureOrder, { edge: input.edge, movementProb: input.movementProb });
          const c = brierLogloss(candSubset);
          out[label] = { active_brier: a.brier, candidate_brier: c.brier, delta: Math.round((a.brier - c.brier) * 10000) / 10000 };
        }
        return out;
      })(),
    },
  };
}

// Re-export so orchestrator can compute per-row regime snapshots.
export { computeRegimeSnapshot };
export type { Candle };
