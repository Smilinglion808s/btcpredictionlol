// Straggler resolution sweeper.
//
// Downstream model rows (V6, B4x4, TD1/TD2/TD3) are normally resolved as a side
// effect of the base prediction resolving. Any cycle where the base row never
// resolved — or resolved as a DOJI/PUSH, which short-circuits the shadow
// resolver — leaves permanently unresolved rows that silently drop out of the
// stats and CSV exports. This sweeper closes them out independently, using the
// confirmed candle as the single source of ground truth. It is idempotent.

import type { SupabaseClient } from "@supabase/supabase-js";

const TF_MS = 15 * 60 * 1000;
const LOOKBACK_MS = 60 * 24 * 60 * 60 * 1000;

type Dir = "GREEN" | "RED" | "PUSH";

interface CandleRow {
  candle_ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  confirm: boolean | null;
}

async function loadConfirmedCandles(
  supabase: SupabaseClient,
  sinceIso: string,
): Promise<Map<string, { dir: Dir; ohlc: CandleRow }>> {
  const out = new Map<string, { dir: Dir; ohlc: CandleRow }>();
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data } = await supabase
      .from("candles")
      .select("candle_ts, open, high, low, close, confirm")
      .eq("symbol", "BTC-USDT")
      .eq("timeframe", "15m")
      .eq("fetch_source", "okx")
      .gte("candle_ts", sinceIso)
      .order("candle_ts", { ascending: true })
      .range(from, from + page - 1);
    const rows = (data ?? []) as unknown as CandleRow[];
    for (const raw of rows) {
      if (raw.confirm === false) continue;
      const open = Number(raw.open);
      const close = Number(raw.close);
      if (!Number.isFinite(open) || !Number.isFinite(close) || open <= 0) continue;
      const dir: Dir = close > open ? "GREEN" : close < open ? "RED" : "PUSH";
      out.set(new Date(raw.candle_ts).toISOString(), { dir, ohlc: raw });
    }
    if (rows.length < page) break;
  }
  return out;
}


export interface SweepResult {
  v6_swept: boolean;
  b4x4_resolved: number;
  b4x4_targets: string[];
  td1_resolved: number;
  td1_targets: string[];
  td1_closed_ineligible: number;

  errors: string[];
}

export async function sweepUnresolvedRows(
  supabase: SupabaseClient,
): Promise<SweepResult> {
  const errors: string[] = [];
  const nowMs = Date.now();
  const cutoffIso = new Date(nowMs - TF_MS).toISOString();
  const sinceIso = new Date(nowMs - LOOKBACK_MS).toISOString();
  const candles = await loadConfirmedCandles(supabase, sinceIso);

  // ---- V6: its own resolver already sweeps every due unresolved row. ----
  let v6Swept = false;
  try {
    const { resolveDueV6 } = await import("@/lib/v6/orchestrator");
    await resolveDueV6(supabase);
    v6Swept = true;
  } catch (e) {
    errors.push(`v6: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ---- B4x4: resolve any closed target still missing resolved_at. ----
  const b4Targets: string[] = [];
  try {
    const { data } = await supabase
      .from("b4x4_predictions")
      .select("target_candle_ts")
      .is("resolved_at", null)
      .gte("target_candle_ts", sinceIso)
      .lte("target_candle_ts", cutoffIso)
      .order("target_candle_ts", { ascending: true })
      .limit(500);
    const { resolveB4x4Row } = await import("@/lib/b4x4/orchestrator");
    for (const r of (data ?? []) as unknown as Array<{ target_candle_ts: string }>) {
      const ts = new Date(r.target_candle_ts).toISOString();
      const c = candles.get(ts);
      if (!c) continue;
      await resolveB4x4Row(supabase, r.target_candle_ts, c.dir, {
        open: Number(c.ohlc.open),
        high: Number(c.ohlc.high),
        low: Number(c.ohlc.low),
        close: Number(c.ohlc.close),
      });
      b4Targets.push(ts);
    }
  } catch (e) {
    errors.push(`b4x4: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ---- TD1 / TD2 / TD3 ----
  // Gradeable rows (A2 gave a direction) go through the normal resolver.
  // Rows where A2 itself was ineligible can never be graded; close them out
  // against the confirmed candle as PUSH so they stop re-appearing forever.
  const tdTargets: string[] = [];
  let tdClosedIneligible = 0;
  try {
    const { data } = await supabase
      .from("model7_td1_rc_shadow")
      .select("id, prediction_id, candle_ts, a2_original_decision")
      .is("resolved_at", null)
      .gte("candle_ts", sinceIso)
      .lte("candle_ts", cutoffIso)
      .order("candle_ts", { ascending: true })
      .limit(1000);
    const { resolveTd1RcRow } = await import("@/lib/model7/td1/orchestrator");
    const seen = new Set<string>();
    type TdRow = { id: string; prediction_id: string | null; candle_ts: string; a2_original_decision: string | null };
    for (const r of (data ?? []) as unknown as TdRow[]) {
      const c = candles.get(new Date(r.candle_ts).toISOString());
      if (!c) continue;
      // Ungradeable: A2 never produced a direction, or the candle was a doji
      // (open == close), which no directional policy can win or lose.
      const gradeable =
        (r.a2_original_decision === "YES" || r.a2_original_decision === "NO") && c.dir !== "PUSH";
      if (!gradeable) {
        await supabase
          .from("model7_td1_rc_shadow")
          .update({
            actual_direction: c.dir,
            result: "PUSH",
            resolved_at: new Date().toISOString(),
          } as never)
          .eq("id", r.id);
        tdClosedIneligible += 1;
        continue;
      }
      if (!r.prediction_id || seen.has(r.prediction_id)) continue;

      seen.add(r.prediction_id);
      await resolveTd1RcRow(supabase, r.prediction_id, c.dir as "GREEN" | "RED");
      tdTargets.push(new Date(r.candle_ts).toISOString());
    }
  } catch (e) {
    errors.push(`td1: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    v6_swept: v6Swept,
    b4x4_resolved: b4Targets.length,
    b4x4_targets: b4Targets,
    td1_resolved: tdTargets.length,
    td1_targets: tdTargets,
    td1_closed_ineligible: tdClosedIneligible,
    errors,
  };
}

