// T30 PriceFlow Balanced — streaming CSV export (server only).
//
// Reporting only. The full-history export is far too large to return as a
// single server-function JSON payload (it timed out), so rows are paged out of
// the database and pushed straight into the HTTP response as they arrive.

import { createClient } from "@supabase/supabase-js";
import { T30_FEATURE_ORDER, T30_MODEL_VERSION, T30_PREDICTIONS_TABLE } from "./config";
import { CSV_COLUMNS } from "./statsQuery.server";

type Row = Record<string, unknown>;

const PAGE = 500;

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

/** Streams the whole T30 prediction history, oldest first, as text/csv. */
export function streamT30Csv(): Response {
  const client = sb();
  const header = [...CSV_COLUMNS, ...T30_FEATURE_ORDER];
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`${header.join(",")}\n`));
      try {
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await client
            .from(T30_PREDICTIONS_TABLE)
            .select([...CSV_COLUMNS, "features"].join(", "))
            .eq("model_version", T30_MODEL_VERSION)
            .order("target_ts", { ascending: true })
            .range(from, from + PAGE - 1);
          if (error) throw new Error(error.message);
          const rows = (data ?? []) as unknown as Row[];
          if (rows.length > 0) {
            const chunk = rows
              .map((r) => {
                const feat = (r.features ?? {}) as Row;
                return [
                  ...CSV_COLUMNS.map((c) => cell(r[c])),
                  ...T30_FEATURE_ORDER.map((f) => cell(feat[f])),
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
      "content-disposition": `attachment; filename="t30-priceflow-balanced-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}
