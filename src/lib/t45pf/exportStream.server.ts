// T45 PriceFlow Q37.5 — streaming CSV export (server only).
//
// Reporting only. Rows are paged out of the database and written into the HTTP
// response as they arrive, so the export never has to buffer the whole history.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  MODEL_VERSION,
  T45PF_FEATURE_ORDER,
  T45PF_PREDICTIONS_TABLE,
} from "./config";

type Row = Record<string, unknown>;

const PAGE = 500;

function cell(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function firstRow(): Promise<Row | null> {
  const { data } = await (supabaseAdmin as any)
    .from(T45PF_PREDICTIONS_TABLE)
    .select("*")
    .eq("model_version", MODEL_VERSION)
    .order("target_ts", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

/** Streams the whole T45 PriceFlow history, oldest first, as text/csv. */
export async function streamPriceFlowCsv(): Promise<Response> {
  const sample = await firstRow();
  const baseCols = Object.keys(sample ?? {}).filter((k) => k !== "feature_values_json");
  const featureCols = T45PF_FEATURE_ORDER.map((f) => `feature_${f}`);
  const header = [...baseCols, ...featureCols];
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`${header.join(",")}\n`));
      try {
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await (supabaseAdmin as any)
            .from(T45PF_PREDICTIONS_TABLE)
            .select("*")
            .eq("model_version", MODEL_VERSION)
            .order("target_ts", { ascending: true })
            .range(from, from + PAGE - 1);
          if (error) throw new Error(error.message);
          const rows = (data ?? []) as Row[];
          if (rows.length > 0) {
            const chunk = rows
              .map((r) => {
                const feats = (r.feature_values_json ?? {}) as Row;
                return [
                  ...baseCols.map((c) => cell(r[c])),
                  ...T45PF_FEATURE_ORDER.map((f) => cell(feats[f])),
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
      "content-disposition": `attachment; filename="t45-priceflow-q375-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}
