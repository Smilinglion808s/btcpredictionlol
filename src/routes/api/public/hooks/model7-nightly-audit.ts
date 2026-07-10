// Model 7 Shadow — nightly A/B/CI monitoring per model_7_shadow_nightly_monitoring v1.0.
// Runs all 9 spec queries, computes Wilson lower bounds, rolling-48h windows,
// and calibration gaps, then persists a single summary row to api_runs
// (run_type='model7-nightly-audit'). Cron hits this endpoint once daily.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// --------- helpers ---------
const Z = 1.96;
function wilsonLower(wins: number, n: number): number {
  if (n <= 0) return 0;
  const p = wins / n;
  const z2 = Z * Z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = Z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return (center - margin) / denom;
}

type ShadowRow = {
  id: string;
  variant: "A" | "B";
  candle_ts: string;
  created_at: string;
  status: string;
  decision: "YES" | "NO" | "SKIP" | null;
  probability_green: number | null;
  hard_no_override_fired: string | null;
  actual_direction: "GREEN" | "RED" | "DOJI" | null;
  model_fit_id: string | null;
  unknown_categories: Record<string, unknown> | null;
  production_model_version: string | null;
};

type FitRow = {
  model_fit_id: string;
  variant: string;
  training_model_version: string;
  training_row_count: number;
  training_window_start: string | null;
  training_window_end: string | null;
  first_scored_candle_ts: string | null;
  created_at: string;
};

function summarizeVariant(rows: ShadowRow[]) {
  const resolved = rows.filter(
    (r) => (r.decision === "YES" || r.decision === "NO") &&
           (r.actual_direction === "GREEN" || r.actual_direction === "RED"),
  );
  const wins = resolved.filter(
    (r) => (r.decision === "YES" && r.actual_direction === "GREEN") ||
           (r.decision === "NO" && r.actual_direction === "RED"),
  ).length;
  const losses = resolved.length - wins;
  const winRate = resolved.length ? wins / resolved.length : 0;
  const wilson = wilsonLower(wins, resolved.length);

  // Trade rate: exclude errors and warming-up rows.
  const opps = rows.filter((r) => r.status !== "error" && r.model_fit_id !== "warming_up");
  const trades = opps.filter((r) => r.decision === "YES" || r.decision === "NO").length;
  const tradeRate = opps.length ? trades / opps.length : 0;

  // Rolling 48h windows — bucket by candle_ts, step every 12h, min n>=15.
  const sorted = [...resolved].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const worst48h = { win_rate: 1, n: 0, window_end: null as string | null };
  const stepMs = 12 * 3600 * 1000;
  const winMs = 48 * 3600 * 1000;
  if (sorted.length) {
    const startT = new Date(sorted[0].created_at).getTime();
    const endT = new Date(sorted[sorted.length - 1].created_at).getTime();
    for (let t = startT; t <= endT; t += stepMs) {
      const winRows = sorted.filter((r) => {
        const rt = new Date(r.created_at).getTime();
        return rt >= t && rt < t + winMs;
      });
      if (winRows.length < 15) continue;
      const w = winRows.filter(
        (r) => (r.decision === "YES" && r.actual_direction === "GREEN") ||
               (r.decision === "NO" && r.actual_direction === "RED"),
      ).length;
      const wr = w / winRows.length;
      if (wr < worst48h.win_rate) {
        worst48h.win_rate = wr;
        worst48h.n = winRows.length;
        worst48h.window_end = new Date(t + winMs).toISOString();
      }
    }
    if (worst48h.window_end === null) worst48h.win_rate = 0; // no qualifying window
  }

  // Calibration buckets.
  const buckets: Record<string, { n: number; sum_prob: number; greens: number; resolved_n: number }> = {
    below_no_threshold: { n: 0, sum_prob: 0, greens: 0, resolved_n: 0 },
    skip_zone: { n: 0, sum_prob: 0, greens: 0, resolved_n: 0 },
    above_yes_threshold: { n: 0, sum_prob: 0, greens: 0, resolved_n: 0 },
  };
  for (const r of rows) {
    if (r.status === "error" || r.probability_green === null) continue;
    const p = Number(r.probability_green);
    const key = p < 0.26 ? "below_no_threshold" : p <= 0.58 ? "skip_zone" : "above_yes_threshold";
    const b = buckets[key];
    b.n += 1; b.sum_prob += p;
    if (r.actual_direction === "GREEN" || r.actual_direction === "RED") {
      b.resolved_n += 1;
      if (r.actual_direction === "GREEN") b.greens += 1;
    }
  }
  let maxCalibGap = 0;
  const calibration: Record<string, unknown> = {};
  for (const [k, b] of Object.entries(buckets)) {
    const meanProb = b.n ? b.sum_prob / b.n : 0;
    const realized = b.resolved_n ? b.greens / b.resolved_n : null;
    calibration[k] = {
      n: b.n, mean_prob: +meanProb.toFixed(3),
      realized_green_pct: realized === null ? null : +(realized * 100).toFixed(1),
      resolved_n: b.resolved_n,
    };
    if (realized !== null) maxCalibGap = Math.max(maxCalibGap, Math.abs(meanProb - realized));
  }

  // Hard-NO override fire rates.
  const overrideCounts: Record<string, number> = {};
  const nonErr = rows.filter((r) => r.status !== "error");
  for (const r of nonErr) {
    const k = r.hard_no_override_fired ?? "(none)";
    overrideCounts[k] = (overrideCounts[k] ?? 0) + 1;
  }
  const overrideRates: Record<string, number> = {};
  const totalNonErr = nonErr.length || 1;
  let maxOverridePct = 0;
  for (const [k, c] of Object.entries(overrideCounts)) {
    const pct = (100 * c) / totalNonErr;
    overrideRates[k] = +pct.toFixed(1);
    if (k !== "(none)" && pct > maxOverridePct) maxOverridePct = pct;
  }

  return {
    n_trades: resolved.length, wins, losses,
    win_rate_pct: +(winRate * 100).toFixed(1),
    wilson_lower_bound: +wilson.toFixed(4),
    trade_rate_pct: +(tradeRate * 100).toFixed(1),
    opportunities: opps.length,
    worst_48h_window: worst48h,
    calibration_buckets: calibration,
    max_calibration_gap: +maxCalibGap.toFixed(3),
    override_fire_rates_pct: overrideRates,
    max_single_override_pct: +maxOverridePct.toFixed(1),
  };
}

export const Route = createFileRoute("/api/public/hooks/model7-nightly-audit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const supabase = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );

        const sinceIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

        // Pull all shadow rows in the last 7d for full analysis.
        const { data: shadow, error: sErr } = await supabase
          .from("model7_shadow")
          .select("*")
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: true });
        if (sErr) return Response.json({ error: sErr.message }, { status: 500 });
        const rows = (shadow ?? []) as unknown as ShadowRow[];

        // Coverage: last 24h vs production predictions.
        const cov24Iso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { count: prodCount24 } = await supabase
          .from("predictions").select("*", { count: "exact", head: true })
          .gte("created_at", cov24Iso);
        const cov24 = {
          A: { rows: 0, errors: 0, skipped: 0 },
          B: { rows: 0, errors: 0, skipped: 0 },
        } as Record<"A" | "B", { rows: number; errors: number; skipped: number }>;
        for (const r of rows) {
          if (new Date(r.created_at).getTime() < Date.now() - 24 * 3600 * 1000) continue;
          const v = r.variant;
          cov24[v].rows += 1;
          if (r.status === "error") cov24[v].errors += 1;
          if (r.status === "skipped") cov24[v].skipped += 1;
        }
        const prodN = prodCount24 ?? 0;
        const covPct = (n: number) => (prodN ? +((100 * n) / prodN).toFixed(1) : 0);

        // Per-variant summaries.
        const summaryA = summarizeVariant(rows.filter((r) => r.variant === "A"));
        const summaryB = summarizeVariant(rows.filter((r) => r.variant === "B"));

        // Variant agreement (only rows with both A and B present and at least one non-SKIP).
        const byCandle = new Map<string, { A?: ShadowRow; B?: ShadowRow }>();
        for (const r of rows) {
          if (r.model_fit_id === "warming_up") continue;
          const slot = byCandle.get(r.candle_ts) ?? {};
          slot[r.variant] = r;
          byCandle.set(r.candle_ts, slot);
        }
        let pairs = 0, agree = 0, disagree = 0;
        let agreeTrades = 0, agreeWins = 0, disagreeTrades = 0, disagreeWins = 0;
        for (const { A, B } of byCandle.values()) {
          if (!A || !B) continue;
          if (A.decision !== "YES" && A.decision !== "NO" && B.decision !== "YES" && B.decision !== "NO") continue;
          pairs += 1;
          const same = A.decision === B.decision;
          if (same) agree += 1; else disagree += 1;
          const dir = A.actual_direction;
          if (dir === "GREEN" || dir === "RED") {
            const aw = (A.decision === "YES" && dir === "GREEN") || (A.decision === "NO" && dir === "RED");
            if (same && A.decision !== "SKIP" && A.decision !== null) {
              agreeTrades += 1; if (aw) agreeWins += 1;
            } else if (!same) {
              if (A.decision === "YES" || A.decision === "NO") { disagreeTrades += 1; if (aw) disagreeWins += 1; }
            }
          }
        }
        const agreement = {
          pairs, agreement_pct: pairs ? +((100 * agree) / pairs).toFixed(1) : 0,
          agree_trades: agreeTrades,
          agree_win_rate_pct: agreeTrades ? +((100 * agreeWins) / agreeTrades).toFixed(1) : null,
          disagree_trades: disagreeTrades,
          disagree_win_rate_pct: disagreeTrades ? +((100 * disagreeWins) / disagreeTrades).toFixed(1) : null,
        };

        // Unknown-category drift (persistent >3 days).
        const unknownByDay = new Map<string, Map<string, number>>();
        for (const r of rows) {
          if (!r.unknown_categories || Object.keys(r.unknown_categories).length === 0) continue;
          const day = r.created_at.slice(0, 10);
          const bag = unknownByDay.get(day) ?? new Map<string, number>();
          for (const k of Object.keys(r.unknown_categories)) bag.set(k, (bag.get(k) ?? 0) + 1);
          unknownByDay.set(day, bag);
        }
        const keyDays = new Map<string, Set<string>>();
        for (const [day, bag] of unknownByDay) {
          for (const k of bag.keys()) {
            const s = keyDays.get(k) ?? new Set<string>(); s.add(day); keyDays.set(k, s);
          }
        }
        const persistentDrift: string[] = [];
        for (const [k, days] of keyDays) if (days.size > 3) persistentDrift.push(k);

        // Variant B fit health + leak-check invariant.
        const { data: fits } = await supabase
          .from("model7_training_fits")
          .select("model_fit_id,variant,training_model_version,training_row_count,training_window_start,training_window_end,first_scored_candle_ts,created_at")
          .order("created_at", { ascending: false })
          .limit(10);
        const fitList = (fits ?? []) as unknown as FitRow[];
        const leakageViolations = fitList.filter((f) =>
          f.first_scored_candle_ts && f.training_window_end &&
          new Date(f.first_scored_candle_ts).getTime() <= new Date(f.training_window_end).getTime(),
        ).map((f) => ({
          model_fit_id: f.model_fit_id,
          training_window_end: f.training_window_end,
          first_scored_candle_ts: f.first_scored_candle_ts,
        }));

        // Alert triage per spec.
        const alerts: string[] = [];
        if (covPct(cov24.A.rows) < 95) alerts.push(`variant_A_coverage_low:${covPct(cov24.A.rows)}%`);
        for (const v of ["A", "B"] as const) {
          const s = v === "A" ? summaryA : summaryB;
          if (s.n_trades >= 200 && s.wilson_lower_bound < 0.58)
            alerts.push(`variant_${v}_bar_not_met:${s.wilson_lower_bound}`);
          if (s.opportunities > 0 && (s.trade_rate_pct < 40 || s.trade_rate_pct > 85))
            alerts.push(`variant_${v}_trade_rate_out_of_band:${s.trade_rate_pct}%`);
          if (s.worst_48h_window.n >= 15 && s.worst_48h_window.win_rate < 0.45)
            alerts.push(`variant_${v}_48h_below_45:${(s.worst_48h_window.win_rate * 100).toFixed(1)}%`);
          if (s.max_single_override_pct > 25)
            alerts.push(`variant_${v}_override_overfit:${s.max_single_override_pct}%`);
        }
        if (persistentDrift.length) alerts.push(`unknown_category_drift:${persistentDrift.join(",")}`);
        if (leakageViolations.length) alerts.push(`variant_B_LEAKAGE:${leakageViolations.length}_fits`);

        // Promotion-bar countdown line per variant.
        const promotion = {
          A: `Variant A: ${summaryA.n_trades}/200 trades toward eligibility, wilson_lower_bound=${summaryA.wilson_lower_bound} (need >= 0.58)`,
          B: `Variant B: ${summaryB.n_trades}/200 trades toward eligibility, wilson_lower_bound=${summaryB.wilson_lower_bound} (need >= 0.58)`,
        };

        const report = {
          generated_at: new Date().toISOString(),
          window: { since: sinceIso },
          coverage_24h: {
            production_rows: prodN,
            variant_A: { ...cov24.A, pct_of_production: covPct(cov24.A.rows) },
            variant_B: { ...cov24.B, pct_of_production: covPct(cov24.B.rows) },
          },
          variant_A: summaryA,
          variant_B: summaryB,
          variant_agreement: agreement,
          persistent_unknown_categories: persistentDrift,
          variant_b_fits: fitList.map((f) => ({
            model_fit_id: f.model_fit_id,
            training_model_version: f.training_model_version,
            training_row_count: f.training_row_count,
            training_window_end: f.training_window_end,
            first_scored_candle_ts: f.first_scored_candle_ts,
            created_at: f.created_at,
          })),
          leakage_violations: leakageViolations,
          promotion_bar: promotion,
          alerts,
        };

        await supabase.from("api_runs").insert({
          run_type: "model7-nightly-audit",
          response_payload: report as never,
          success: alerts.length === 0,
          error_message: alerts.length ? alerts.join("; ") : null,
        } as never);

        return Response.json(report);
      },
    },
  },
});
