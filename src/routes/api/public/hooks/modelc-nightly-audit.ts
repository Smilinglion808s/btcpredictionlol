// Model C — Dual Horizon nightly monitoring.
//
// Mirrors model7-nightly-audit but scoped to `model_c_shadow` and
// `model_c_training_fits`. Emits a single summary row to api_runs
// (run_type='model_c_nightly_audit') with:
//   - coverage: last 24h shadow rows vs prod predictions
//   - win rate + Wilson lower bound over the last 7d resolved rows
//   - override fire-rate (hard-NO)
//   - live-fit lineage: fit_id, cutoff, row counts, calibration mean/std
//
// pg_cron POSTs here daily. Auth = anon key in `apikey` header.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

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
  candle_ts: string;
  created_at: string;
  status: string;
  final_decision: "YES" | "NO" | "NO CLEAR EDGE" | null;
  trade: boolean | null;
  ensemble_probability_green: number | null;
  actual_direction: "GREEN" | "RED" | "DOJI" | null;
  fit_id: string | null;
  override_reasons_json: unknown;
};

type FitRow = {
  fit_id: string;
  training_model_version: string;
  training_cutoff_ts: string;
  global_training_row_count: number | null;
  recent_training_row_count: number | null;
  global_artifact_sha256: string | null;
  recent_artifact_sha256: string | null;
  combined_fit_sha256: string | null;
  in_sample_global_prob_mean: number | null;
  in_sample_recent_prob_mean: number | null;
  created_at: string;
};

export const Route = createFileRoute("/api/public/hooks/modelc-nightly-audit")({
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

        const nowMs = Date.now();
        const sevenDayIso = new Date(nowMs - 7 * 24 * 3600 * 1000).toISOString();
        const dayIso = new Date(nowMs - 24 * 3600 * 1000).toISOString();

        // 1. Pull 7d of shadow rows.
        const { data: shadow, error: sErr } = await supabase
          .from("model_c_shadow")
          .select("id, candle_ts, created_at, status, final_decision, trade, ensemble_probability_green, actual_direction, fit_id, override_reasons_json")
          .gte("created_at", sevenDayIso)
          .order("created_at", { ascending: true });
        if (sErr) return Response.json({ error: sErr.message }, { status: 500 });
        const rows = (shadow ?? []) as unknown as ShadowRow[];

        // 2. Coverage: shadow rows in last 24h vs prod predictions in last 24h.
        const { count: prodCount24 } = await supabase
          .from("predictions").select("*", { count: "exact", head: true })
          .gte("created_at", dayIso);
        const shadow24 = rows.filter((r) => r.created_at >= dayIso);
        const errors24 = shadow24.filter((r) => r.status === "blocked" || r.status === "error").length;
        const scored24 = shadow24.filter((r) => r.status !== "blocked" && r.status !== "error").length;
        const prodN = prodCount24 ?? 0;
        const covPct = prodN ? +((100 * scored24) / prodN).toFixed(1) : 0;

        // 3. Win-rate + Wilson LB over 7d resolved.
        const resolved = rows.filter(
          (r) => r.trade && (r.final_decision === "YES" || r.final_decision === "NO")
            && (r.actual_direction === "GREEN" || r.actual_direction === "RED"),
        );
        const wins = resolved.filter(
          (r) => (r.final_decision === "YES" && r.actual_direction === "GREEN") ||
                 (r.final_decision === "NO" && r.actual_direction === "RED"),
        ).length;
        const wr = resolved.length ? wins / resolved.length : 0;
        const wilson = wilsonLower(wins, resolved.length);

        // 4. Trade rate + override fire-rate.
        const opps = rows.filter((r) => r.status === "scored" || r.status === "win" || r.status === "loss" || r.status === "skip");
        const trades = opps.filter((r) => r.trade).length;
        const tradeRate = opps.length ? +((100 * trades) / opps.length).toFixed(1) : 0;
        const overrideCounts: Record<string, number> = {};
        for (const r of opps) {
          // override_reasons_json is an array of { id, fired, applied, note? }
          // objects from decideModelC. Older code treated it as a string
          // array, which produced "[object Object]" alert identifiers. Count
          // only entries where the override actually APPLIED (flipped YES→NO).
          const reasons = Array.isArray(r.override_reasons_json)
            ? (r.override_reasons_json as Array<{ id?: unknown; applied?: unknown }>)
            : [];
          for (const entry of reasons) {
            if (!entry || typeof entry !== "object") continue;
            if (entry.applied !== true) continue;
            const id = typeof entry.id === "string" && entry.id.length > 0 ? entry.id : "unknown_override";
            overrideCounts[id] = (overrideCounts[id] ?? 0) + 1;
          }
        }
        const overrideRates: Record<string, number> = {};
        for (const [k, v] of Object.entries(overrideCounts)) {
          overrideRates[k] = opps.length ? +((100 * v) / opps.length).toFixed(1) : 0;
        }

        // 5. Live-fit lineage (latest).
        const { data: fits } = await supabase
          .from("model_c_training_fits")
          .select("fit_id, training_model_version, training_cutoff_ts, global_training_row_count, recent_training_row_count, global_artifact_sha256, recent_artifact_sha256, combined_fit_sha256, in_sample_global_prob_mean, in_sample_recent_prob_mean, created_at")
          .order("created_at", { ascending: false })
          .limit(5);
        const fitRows = (fits ?? []) as unknown as FitRow[];
        const activeFit = fitRows[0] ?? null;

        // 6. Alerts.
        const alerts: string[] = [];
        if (prodN > 0 && covPct < 90) alerts.push(`coverage_low_${covPct}pct`);
        if (errors24 > 0) alerts.push(`errors_last_24h_${errors24}`);
        if (resolved.length >= 30 && wilson < 0.5) alerts.push(`wilson_lb_below_50_${(100 * wilson).toFixed(1)}`);
        for (const [k, v] of Object.entries(overrideRates)) {
          if (v > 30) alerts.push(`override_overfit_${k}_${v}pct`);
        }

        const summary = {
          window: { seven_day_start: sevenDayIso, day_start: dayIso },
          coverage_24h: {
            prod_predictions: prodN,
            shadow_scored: scored24,
            shadow_errors: errors24,
            coverage_pct: covPct,
          },
          performance_7d: {
            resolved_trades: resolved.length,
            wins,
            losses: resolved.length - wins,
            win_rate: +(wr * 100).toFixed(2),
            wilson_lower_95: +(wilson * 100).toFixed(2),
          },
          trade_rate_pct: tradeRate,
          override_fire_rates_pct: overrideRates,
          active_fit: activeFit,
          recent_fits: fitRows,
          alerts,
        };

        const { error: insErr } = await supabase.from("api_runs").insert({
          run_type: "model_c_nightly_audit",
          request_payload: { since: sevenDayIso },
          response_payload: summary as unknown as Record<string, unknown>,
          success: alerts.length === 0,
          error_message: alerts.length ? alerts.join(",") : null,
        });
        if (insErr) return Response.json({ error: insErr.message }, { status: 500 });

        return Response.json({ ok: true, summary });
      },
    },
  },
});
