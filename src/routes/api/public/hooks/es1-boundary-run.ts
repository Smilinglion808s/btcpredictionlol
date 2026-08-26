import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { setB4x4RequestHost } from "@/lib/b4x4/build-identity";

const TF_MS = 15 * 60 * 1000;
/** How far into a candle we still consider ourselves "at" its boundary. */
const FRESH_WINDOW_MS = 60_000;
/** Longest we are willing to sit and wait for a future boundary to arrive. */
const MAX_WAIT_FOR_BOUNDARY_MS = 120_000;
/**
 * Above this lead the request only warms and returns. Sitting through a full
 * pre-boundary minute made the request straddle the edge gateway's timeout, and
 * a single slow warm turned the whole boundary into a 502 with no row written.
 */
const WARM_ONLY_LEAD_MS = 25_000;
/** How late a `mode=recover` pass may still write the current candle's row. */
const RECOVER_WINDOW_MS = 5 * 60_000;


/**
 * B4x4-ES1 live boundary run.
 *
 * ES1 is a source-candle model: its feature row for target candle T is built
 * from the fully closed candle T-15m. Running it in the pre-boundary pass
 * (boundary - 40s) therefore could never see the candle it needs, so ES1 was
 * always one candle behind — it published for the candle that had already
 * started 15 minutes earlier.
 *
 * This endpoint is invoked one minute before the boundary so its server worker
 * is already warm. It waits for the boundary and the just-closed source candle,
 * then predicts the candle that is opening right now.
 *
 * Auth: requires the project's publishable key in the `apikey` header.
 */
export const Route = createFileRoute("/api/public/hooks/es1-boundary-run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // B4x4-ES1 is RETIRED (2026-08-26). Its history and CSV are archived;
        // this endpoint no longer mints predictions for any target.
        return Response.json(
          { ok: false, retired: true, model: "b4x4-es1", retired_at: "2026-08-26" },
          { status: 410 },
        );
        // eslint-disable-next-line no-unreachable
        const started = Date.now();

        setB4x4RequestHost(request.headers.get("host"));
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

        const mode = new URL(request.url).searchParams.get("mode") ?? "auto";
        const now = Date.now();
        // Target must always be an UPCOMING candle — the one that is opening
        // right now (cron fires on the boundary) or, if we fired early/late,
        // the next boundary. We never publish for a candle that is already
        // meaningfully underway.
        const floor = Math.floor(now / TF_MS) * TF_MS;
        const intoCandle = now - floor; // ms elapsed since the current candle opened
        // `mode=recover` is the late safety net: when the boundary pass never
        // ran (worker 502, cron startup timeout), we still want the row for the
        // candle already underway. The webhook layer keeps its own 90s freshness
        // guard, so a late recovery can never publish a stale trade signal.
        const recovering = mode === "recover" && intoCandle <= RECOVER_WINDOW_MS;
        const targetMs =
          intoCandle <= FRESH_WINDOW_MS || recovering
            ? floor // fired on the boundary (or recovering it): predict that candle
            : floor + TF_MS; // fired early or late: predict the next boundary
        const targetTs = new Date(targetMs).toISOString();
        const sourceTs = new Date(targetMs - TF_MS).toISOString();

        const out: Record<string, unknown> = {
          target_candle_ts: targetTs,
          source_candle_ts: sourceTs,
          ms_into_target_candle: Math.max(0, now - targetMs),
        };


        if (targetMs - now > MAX_WAIT_FOR_BOUNDARY_MS) {
          out.skipped = "no boundary due — next scheduled run owns this candle";
          out.elapsed_ms = Date.now() - started;
          return new Response(JSON.stringify(out), {
            headers: { "content-type": "application/json" },
          });
        }

        // Idempotency backstop: a second cron fires ON the boundary so a
        // crashed/502'd pre-boundary worker can never silently drop a candle.
        // If the primary pass already produced the row, do nothing — never
        // re-run the balanced chain or re-send a webhook for the same target.
        {
          const { data: existing } = await supabase
            .from("b4x4_es1_predictions")
            .select("id")
            .eq("target_candle_ts", targetTs)
            .maybeSingle();
          if (existing) {
            out.skipped = "prediction already exists for this target";
            out.row_id = (existing as { id: string }).id;
            out.elapsed_ms = Date.now() - started;
            return new Response(JSON.stringify(out), {
              headers: { "content-type": "application/json" },
            });
          }
        }

        // Per-stage latency instrumentation. Read-only diagnostics: it never
        // changes what any model computes, only how we measure the pipeline.
        const stages: Record<string, number> = {};
        const mark = (name: string, from: number) => {
          stages[name] = Date.now() - from;
        };

        try {
          const { fetchAndUpsertCandles } = await import("@/lib/okx.server");
          const { runEs1ForTarget, maybeSendEs1Webhook, buildEs1Replay } = await import(
            "@/lib/b4x4es1/orchestrator.server"
          );
          // Warm the modules that run after the decision so their first import
          // is not paid for inside the post-boundary critical path.
          const warmModules = Promise.all([
            import("@/lib/b4x4es1/balanced.server"),
            import("@/lib/b4x4es1/dualAdaptive.server"),
            import("@/lib/webhooks.server"),
          ]);

          // ---- Pre-boundary warm pass -------------------------------------
          // This endpoint is invoked ~60s before the boundary. That idle time
          // used to be wasted: every cold worker then paid for a full input
          // load, artifact load and replay AFTER the boundary, which is what
          // pushed publication ~20s into the candle.
          //
          // Warming with `upTo = source candle - 15m` primes the incremental
          // row caches, the minted-fit artifacts and the JIT — using only
          // candles that closed long ago. It is cached under its own key, so
          // the post-boundary replay still recomputes the live target from
          // fresh data. Model inputs and outputs are unchanged.
          const warmLeadMs = targetMs - Date.now();
          if (warmLeadMs > 8_000) {
            const t = Date.now();
            try {
              await fetchAndUpsertCandles(supabase);
              mark("warm_fetch_ms", t);
              const tw = Date.now();
              await buildEs1Replay(supabase, {
                upTo: new Date(targetMs - 2 * TF_MS).toISOString(),
              });
              mark("warm_replay_ms", tw);
              await warmModules;
              out.warmed = true;
            } catch (e) {
              out.warm_error = e instanceof Error ? e.message : String(e);
            }
            mark("warm_total_ms", t);
          }

          // Warm-only pass: return instead of sleeping through the rest of the
          // pre-boundary minute. The boundary-minute cron owns the decision, so
          // no single request has to span warm + wait + predict (which is what
          // pushed this endpoint past the gateway timeout and produced a 502
          // with no prediction row at all).
          if (targetMs - Date.now() > WARM_ONLY_LEAD_MS) {
            out.warm_only = true;
            out.stages = stages;
            out.elapsed_ms = Date.now() - started;
            return new Response(JSON.stringify(out), {
              headers: { "content-type": "application/json" },
            });
          }


          // Wait for the source candle to be closed and ingested. Bounded so
          // this endpoint can never outlive its own 15-minute slot.
          //
          // Fetch once just after the boundary before replaying. Scoring first
          // used to trigger an internal fetch/replay and then repeat the same
          // work here, adding several seconds under exchange rate limiting.
          let row = null as Awaited<ReturnType<typeof runEs1ForTarget>>;
          for (let attempt = 0; attempt < 4 && !row; attempt++) {
            if (attempt > 0) await new Promise((r) => setTimeout(r, 1_500));
            // OKX can take about two seconds to mark the source candle final.
            // Waiting here preserves the exact closed-candle input while
            // avoiding a guaranteed unconfirmed response at +800ms.
            if (Date.now() < targetMs + 2_100) {
              await new Promise((r) => setTimeout(r, targetMs + 2_100 - Date.now()));
            }
            const tf = Date.now();
            try {
              await fetchAndUpsertCandles(supabase);
            } catch {
              /* retryable */
            }
            mark("fetch_ms", tf);
            const tr = Date.now();
            row = await runEs1ForTarget(supabase, {
              targetCandleTs: targetTs,
              runMode: "LIVE",
              recoverMissingSource: false,
            });
            mark("es1_ms", tr);
            out.attempts = attempt + 1;
          }


          if (row) {
            out.row_id = row.id;
            out.legacy_final_prediction = row.final_prediction;
            out.legacy_would_trade = row.would_trade;

            let activeRow: Record<string, unknown> = row as Record<string, unknown>;

            // 1. Exact-target Binance boundary features — the only Binance work
            //    the active decision depends on. Finalized strictly BEFORE the
            //    active decision and before any webhook, exactly as before.
            const tb = Date.now();
            try {
              const { finalizeBinanceObTarget } = await import(
                "@/lib/b4x4es1/binanceOb/orchestrator.server"
              );
              await finalizeBinanceObTarget(supabase, targetTs, String(row.id));
              out.binance_ob_linked = true;
            } catch (e) {
              out.binance_ob_linked = false;
              out.binance_finalize_error = e instanceof Error ? e.message : String(e);
            }
            mark("binance_finalize_ms", tb);

            // 2. Retained counterfactual: Binance Dual-Venue Adaptive R1.
            const td = Date.now();
            try {
              const { runDualAdaptiveForPrediction } = await import(
                "@/lib/b4x4es1/dualAdaptive.server"
              );
              const dual = await runDualAdaptiveForPrediction(supabase, activeRow, targetTs);
              if (dual) {
                activeRow = { ...activeRow, ...dual.patch };
                out.dual_adaptive_direction = dual.decision.candidateDirection;
                out.dual_adaptive_would_trade = dual.decision.wouldTrade;
                out.dual_adaptive_decision_reason = dual.decision.decisionReason;
                out.dual_adaptive_activated = dual.decision.activated;
                out.dual_adaptive_spot_mode = dual.decision.spot.mode;
                out.dual_adaptive_perp_mode = dual.decision.perp.mode;
              }
            } catch (e) {
              out.dual_adaptive_error = e instanceof Error ? e.message : String(e);
            }
            mark("dual_ms", td);

            // 3. ACTIVE MODEL: B4x4-ES1 Balanced Precision Stack R1.
            const tp = Date.now();
            try {
              const { runPrecisionForPrediction } = await import(
                "@/lib/b4x4es1/precisionStack.server"
              );
              const precision = await runPrecisionForPrediction(supabase, activeRow, targetTs);
              if (precision) {
                activeRow = { ...activeRow, ...precision.patch };
                out.precision_direction = precision.patch.precision_candidate_direction;
                out.precision_would_trade = precision.patch.precision_would_trade;
                out.precision_decision_reason = precision.patch.precision_decision_reason;
                out.precision_sleeve = precision.patch.precision_sleeve;
                out.precision_route = precision.patch.precision_balanced_route;
                out.precision_activated = precision.activated;
                out.precision_build_ms = precision.context.buildMs;
              }
            } catch (e) {
              // Fail closed: no precision row means no publication.
              out.precision_error = e instanceof Error ? e.message : String(e);
            }
            mark("precision_ms", tp);

            // 4. Publish immediately. Everything below this line is a scored
            //    counterfactual that can never publish, so it must not sit in
            //    front of the webhook.
            const tw = Date.now();
            out.webhook_sent = await maybeSendEs1Webhook(supabase, activeRow);
            mark("webhook_ms", tw);
            out.publish_lag_ms = Date.now() - targetMs;

            // 4. Retained counterfactual: Balanced Binance 3-of-4 R1. Same
            //    inputs, same persistence — just no longer blocking publication.
            const tbal = Date.now();
            try {
              const { runBalancedForPrediction } = await import("@/lib/b4x4es1/balanced.server");
              const balanced = await runBalancedForPrediction(supabase, row, targetTs, {
                skipFinalize: true,
              });
              if (balanced) {
                out.balanced_final_prediction = balanced.decision.finalPrediction;
                out.balanced_would_trade = balanced.decision.wouldTrade;
                out.balanced_decision_reason = balanced.decision.decisionReason;
              }
            } catch (e) {
              out.balanced_error = e instanceof Error ? e.message : String(e);
            }
            mark("balanced_ms", tbal);
          } else {

            out.error = "source candle unavailable";
          }
        } catch (e) {
          out.error = e instanceof Error ? e.message : String(e);
        }

        out.stages = stages;


        out.elapsed_ms = Date.now() - started;
        return new Response(JSON.stringify(out), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
