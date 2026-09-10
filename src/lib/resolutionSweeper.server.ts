// Straggler resolution sweeper.
//
// Downstream model rows (V6, B4x4, TD1/TD2) are normally resolved as a side
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

  // ---- V6: retired. No further tracking or resolution sweeping. ----
  const v6Swept = false;

  // ---- B4x4: retired (2026-09-10). No tracking or resolution sweeping. ----
  const b4Targets: string[] = [];

  // ---- TD1 / TD2 ----
  // Gradeable rows (A2 gave a direction) go through the normal resolver.
  // Rows where A2 itself was ineligible can never be graded; close them out
  // against the confirmed candle as PUSH so they stop re-appearing forever.
  const tdTargets: string[] = [];
  const tdClosedIneligible = 0;
  // TD1/TD2 layer paused and archived (2026-09-07) — no sweeping.

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

