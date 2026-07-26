import { createServerFn } from "@tanstack/react-start";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function fetchAllModel8V3Rows() {
  const sb = await admin();
  const PAGE = 1000;
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("model8_v3_predictions")
      .select("*")
      .order("target_candle_ts", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...batch);
    if (batch.length < PAGE) break;
    if (from > 100_000) break;
  }
  return rows;
}

/** Simple stats: win / loss / push / pending / abstain / current pending row. */
export const getModel8V3Stats = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await fetchAllModel8V3Rows();
  let wins = 0, losses = 0, pushes = 0, pending = 0, abstains = 0;
  const recent: Array<{ status: string; ts: string }> = [];
  for (const r of rows) {
    const q = r.qualified_result as string | null;
    const ts = String(r.resolved_at ?? r.target_candle_ts ?? "");
    if (q === "WIN") { wins++; recent.push({ status: "win", ts }); }
    else if (q === "LOSS") { losses++; recent.push({ status: "loss", ts }); }
    else if (q === "PUSH") { pushes++; recent.push({ status: "push", ts }); }
    else if (q === "ABSTAIN") { abstains++; }
    else if (r.resolved_at == null) { pending++; }
  }
  const decided = wins + losses;
  const win_rate = decided === 0 ? 0 : Math.round((wins / decided) * 10000) / 100;
  const last10 = recent.sort((a, b) => (b.ts > a.ts ? 1 : -1)).slice(0, 10);
  const l10w = last10.filter((r) => r.status === "win").length;
  const l10l = last10.filter((r) => r.status === "loss").length;
  const last_10_win_rate = l10w + l10l === 0 ? 0 : Math.round((l10w / (l10w + l10l)) * 10000) / 100;
  return {
    total_rows: rows.length,
    wins, losses, pushes, pending, abstains,
    trades: wins + losses,
    win_rate,
    last_10_win_rate,
  };
});

/** Newest row (pending or resolved) for the current-prediction card. */
export const getModel8V3Pending = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("model8_v3_predictions")
    .select("prediction_id, target_candle_ts, qualified_prediction, raw_prediction, calibrated_probability_green, raw_probability_green, abstain_reason, resolved_at, qualified_result, actual_direction, data_quality_valid, feature_history_valid")
    .order("target_candle_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
});

/** CSV export — every column. */
export const exportModel8V3Csv = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await fetchAllModel8V3Rows();
  return rows.map((r) => ({
    ...r,
    feature_values: r.feature_values ? JSON.stringify(r.feature_values) : "",
    fit_snapshot: r.fit_snapshot ? JSON.stringify(r.fit_snapshot) : "",
  }));
});
