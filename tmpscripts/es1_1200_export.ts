import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ES1_ROW_MODEL_VERSIONS } from "@/lib/b4x4es1/config";

const COLUMNS = [
  "target_candle_ts",
  "precision_sleeve",
  "would_trade",
  "actual_open",
  "actual_close",
  "actual_direction",
  "precision_result",
  "precision_result_score",
];

async function main() {
  const sb = supabaseAdmin;
  const PAGE = 500;
  const rows: any[] = [];

  // Fetch newest-first up to 1200 LIVE non-CATCHUP rows
  for (let offset = 0; rows.length < 1200; offset += PAGE) {
    const { data, error } = await sb
      .from("b4x4_es1_predictions")
      .select(COLUMNS.join(","))
      .in("model_version", ES1_ROW_MODEL_VERSIONS)
      .eq("run_mode", "LIVE")
      .order("target_candle_ts", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE);

    if (error) throw new Error(`query failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  const selected = rows.slice(0, 1200);
  // Reverse to chronological order (oldest → newest)
  selected.reverse();

  const header = [
    "target_ts",
    "selected_sleeve",
    "would_trade",
    "actual_open",
    "actual_close",
    "actual_direction",
    "precision_result",
    "precision_raw_score",
  ].join(",");

  const csv = [header, ...selected.map((r) => [
    r.target_candle_ts,
    r.precision_sleeve ?? "",
    r.would_trade ?? "",
    r.actual_open ?? "",
    r.actual_close ?? "",
    r.actual_direction ?? "",
    r.precision_result ?? "",
    r.precision_result_score ?? "",
  ].join(","))].join("\n");

  const outputPath = "/mnt/documents/es1_latest_1200.csv";
  await Bun.write(outputPath, csv + "\n");
  console.log(`Wrote ${selected.length} rows to ${outputPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
