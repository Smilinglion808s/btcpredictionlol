// T10 Bridge R1 — streaming CSV export (server only).
//
// Reporting only: rows are paged out of the database and pushed straight into
// the HTTP response, so a full-history export never buffers in memory.

import { createClient } from "@supabase/supabase-js";
import { T10_BRIDGE_VERSION, T10_FEATURE_ORDER, T10_PREDICTIONS_TABLE } from "./config";

type Row = Record<string, unknown>;

const PAGE = 500;

/** Scalar decision columns, oldest first, ahead of the flattened features. */
export const T10_CSV_COLUMNS = [
  "target_ts",
  "boise_date",
  "utc_date",
  "run_mode",
  "trigger_kind",
  "model_version",
  "model_variant",
  "config_hash",
  "feature_order_hash",
  "activation_mode",
  "decision_at",
  "decision_offset_ms",
  "packet_complete",
  "packet_count",
  "packet_first_offset",
  "packet_last_offset",
  "packet_failure_reason",
  "features_valid",
  "fit_id",
  "fit_block_start_index",
  "fit_certified",
  "correctness_probability",
  "base_direction",
  "long_rank",
  "long_rank_count",
  "fast_rank",
  "fast_rank_count",
  "rank_certified",
  "policy_would_trade",
  "policy_direction",
  "policy_decision_reason",
  "final_prediction",
  "webhook_eligible",
  "webhook_sent",
  "webhook_sent_at",
  "webhook_status",
  "webhook_latency_ms",
  "webhook_offset_ms",
  "actual_open",
  "actual_high",
  "actual_low",
  "actual_close",
  "actual_direction",
  "result",
  "raw_score",
  "resolved_at",
] as const;

function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function cell(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Streams the whole T10 prediction history, oldest first, as text/csv. */
export function streamT10Csv(): Response {
  const client = sb();
  const header = [...T10_CSV_COLUMNS, ...T10_FEATURE_ORDER];
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`${header.join(",")}\n`));
      try {
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await client
            .from(T10_PREDICTIONS_TABLE)
            .select([...T10_CSV_COLUMNS, "feature_vector"].join(", "))
            .eq("model_version", T10_BRIDGE_VERSION)
            .order("target_ts", { ascending: true })
            .range(from, from + PAGE - 1);
          if (error) throw new Error(error.message);
          const rows = (data ?? []) as unknown as Row[];
          if (rows.length > 0) {
            const chunk = rows
              .map((r) => {
                const vec = (r.feature_vector ?? {}) as Row;
                const arr = Array.isArray(vec) ? (vec as unknown as unknown[]) : null;
                return [
                  ...T10_CSV_COLUMNS.map((c) => cell(r[c])),
                  ...T10_FEATURE_ORDER.map((f, i) => cell(arr ? arr[i] : vec[f])),
                ].join(",");
              })
              .join("\n");
            controller.enqueue(encoder.encode(`${chunk}\n`));
          }
          if (rows.length < PAGE) break;
        }
      } catch (e) {
        controller.enqueue(
          encoder.encode(`# export_error,${cell(e instanceof Error ? e.message : String(e))}\n`),
        );
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="t10-bridge-r1-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}
