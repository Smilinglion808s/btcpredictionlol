// C85 decision history export.
//
// Streams every c85_targets row newest-first with its settlement joined, so the
// file is a complete audit trail: validity chain, both heads, both rank
// families, the deterioration state, the gate reasons, the measured nanosecond
// timings and the dispatch outcome. Abstains are included as rows with
// final_side 0 — they are decisions, not gaps.

import { createClient } from "@supabase/supabase-js";
import { C85_MODEL_VERSION, C85_TARGETS_TABLE, boiseDate } from "./config";

const COLUMNS = [
  "target_open_utc",
  "target_open_boise_date",
  "ticker",
  "run_mode",
  "status",
  "status_reason",
  "binance_complete",
  "anchor_valid",
  "cm_valid",
  "auxiliary_valid",
  "source_ok",
  "core_valid",
  "structure_valid",
  "market_q1",
  "probability_yes",
  "proposal",
  "probability_correct",
  "aux_long_logit",
  "aux_long_logscale",
  "aux_recent_logit",
  "aux_recent_logscale",
  "admission_rank",
  "admission_rank_count",
  "filter_rank",
  "filter_rank_count",
  "core_side",
  "extension",
  "last_yes_price",
  "base_side",
  "weak",
  "deterioration_ewma16",
  "deterioration_ewma128",
  "deterioration_settled_count",
  "deterioration_warmup",
  "final_side",
  "gate_reasons",
  "consumed_state_cutoff_ns",
  "direction_fit_id",
  "meta_fit_id",
  "aux_fit_month",
  "feature_order_sha256",
  "source_hash",
  "target_open_ns",
  "packet_freeze_ns",
  "last_event_ns",
  "last_receipt_ns",
  "compute_started_ns",
  "compute_complete_ns",
  "decision_durable_ns",
  "dispatch_ns",
  "publication_offset_ms",
  "deadline_met",
  "webhook_status",
  "webhook_attempts",
  "webhook_last_error",
  "executed",
  "published_at",
  "official_result",
  "outcome",
  "raw_net",
  "settlement_ts",
] as const;

function cell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value).replace(/"/g, '""');
  const s = String(value);
  return /[",\n]/.test(s) ? s.replace(/"/g, '""') : s;
}

function line(values: unknown[]): string {
  return values.map((v) => `"${cell(v)}"`).join(",") + "\n";
}

const PAGE = 1000;

export async function streamC85Csv(limit = 20000): Promise<Response> {
  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: settlementRows } = await client
    .from("c85_settlements")
    .select("target_open_utc, official_result, outcome, raw_net, settlement_ts")
    .eq("model_version", C85_MODEL_VERSION)
    .limit(limit);
  const settlements = new Map<string, Record<string, unknown>>();
  for (const r of (settlementRows ?? []) as Record<string, unknown>[]) {
    settlements.set(new Date(String(r.target_open_utc)).toISOString(), r);
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(line([...COLUMNS])));
      try {
        for (let from = 0; from < limit; from += PAGE) {
          const { data, error } = await client
            .from(C85_TARGETS_TABLE)
            .select("*")
            .eq("model_version", C85_MODEL_VERSION)
            .order("target_open_utc", { ascending: false })
            .range(from, Math.min(from + PAGE, limit) - 1);
          if (error) throw new Error(error.message);
          const batch = (data ?? []) as Record<string, unknown>[];
          for (const row of batch) {
            const iso = new Date(String(row.target_open_utc)).toISOString();
            const settled = settlements.get(iso) ?? {};
            const merged: Record<string, unknown> = {
              ...row,
              ...settled,
              target_open_utc: iso,
              target_open_boise_date: boiseDate(iso),
            };
            controller.enqueue(encoder.encode(line(COLUMNS.map((c) => merged[c]))));
          }
          if (batch.length < PAGE) break;
        }
      } catch (e) {
        controller.enqueue(encoder.encode(line([`export_error: ${String(e)}`])));
      }
      controller.close();
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="c85_multi_meta_decisions_${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
