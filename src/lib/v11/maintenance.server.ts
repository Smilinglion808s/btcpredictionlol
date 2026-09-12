// Version 1.1 — off-critical-path maintenance and cold bootstrap.
//
// Nothing here runs before a decision. It imports missing live context,
// refreshes official labels, rebuilds vectors, fits the daily head and then
// scores every unprocessed official opportunity in order — including the very
// first one, from an empty checkpoint. It cannot send anything.

import type { SupabaseClient } from "@supabase/supabase-js";
import { V11_RUN_MODES, V1_MODEL_VERSION, utcDate } from "./config";
import { backfillV11Vectors, ensureV11Head } from "./fit.server";
import { observeV11Target } from "./observer.server";
import {
  readState,
  upsertContextRow,
  readContextRow,
  readLiveContext,
} from "./store.server";

export interface V11MaintenanceReport {
  labelsRefreshed: number;
  labelsFromSettlements: number;
  labelsFromKalshi: number;
  contextAdded: number;
  vectorsBuilt: number;
  headFitted: string | null;
  headSkippedReason: string | null;
  bootstrapped: boolean;
  recovered: number;
  lastProcessedTs: string | null;
}

/** A candle is only an official opportunity once it has fully closed. */
const CANDLE_MS = 15 * 60_000;

/**
 * Import official opportunities the V1 worker committed that V11 has no context
 * row for yet, oldest first. This is what makes a cold start possible: without
 * it there is nothing to score.
 */
async function importContext(
  sb: SupabaseClient,
  before: string,
  limit: number,
): Promise<number> {
  const { data: lastCtx } = await sb
    .from("v11_context_rows")
    .select("target_ts")
    .order("target_ts", { ascending: false })
    .limit(1);
  const from = (lastCtx ?? [])[0]?.target_ts as string | undefined;

  let q = sb
    .from("c85_targets")
    .select("target_open_utc")
    .eq("model_version", V1_MODEL_VERSION)
    .lt("target_open_utc", before)
    .order("target_open_utc", { ascending: true })
    .limit(limit);
  // Re-check the newest known row too: its V1 features may have been completed
  // after V11 first saw it.
  if (from) q = q.gte("target_open_utc", new Date(from).toISOString());
  const { data, error } = await q;
  if (error) throw error;

  let added = 0;
  for (const row of (data ?? []) as { target_open_utc: string }[]) {
    const ts = new Date(row.target_open_utc).toISOString();
    const existing = await readContextRow(sb, ts);
    if (existing) continue;
    const live = await readLiveContext(sb, ts);
    if (!live) continue;
    await upsertContextRow(sb, live, "c85_targets");
    added++;
  }
  return added;
}

/**
 * Fill in official outcomes for context rows that have none.
 *
 * Two native sources, in order: the project's own `c85_settlements` rows for
 * the V1 model, then the project's native Kalshi resolver for every other
 * interval (V1 abstentions, T45-only intervals, historical rows). OKX is never
 * consulted. Labels are only ever FILLED IN, never cleared or overwritten.
 */
async function refreshLabels(
  sb: SupabaseClient,
  limit: number,
  kalshiLimit: number,
  before: string,
  nowMs: number = Date.now(),
): Promise<{ total: number; fromSettlements: number; fromKalshi: number }> {
  const { data, error } = await sb
    .from("v11_context_rows")
    .select("target_ts")
    .is("label", null)
    .lt("target_ts", before)
    .order("target_ts", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const pending = ((data ?? []) as { target_ts: string }[]).map((r) =>
    new Date(r.target_ts).toISOString(),
  );
  if (pending.length === 0) return { total: 0, fromSettlements: 0, fromKalshi: 0 };

  const write = async (
    ts: string,
    label: number,
    settlementTs: string | null,
    settlementTsSource: string | null,
    source: string,
  ): Promise<boolean> => {
    if (label !== 1 && label !== -1) return false;
    const existing = await readContextRow(sb, ts);
    if (!existing || existing.label !== null) return false;
    await upsertContextRow(
      sb,
      {
        ...existing,
        label,
        settlementTs: settlementTs ?? existing.settlementTs,
        settlementTsSource: settlementTs
          ? settlementTsSource
          : (existing.settlementTsSource ?? null),
        settlementKnownAt: new Date().toISOString(),
      },
      source,
    );
    return true;
  };

  let fromSettlements = 0;
  const stillPending: string[] = [];

  // 1) Native model-scoped settlements.
  const settled = new Map<string, { label: number; ts: string | null }>();
  for (let i = 0; i < pending.length; i += 200) {
    const chunk = pending.slice(i, i + 200);
    const { data: sRows, error: sErr } = await sb
      .from("c85_settlements")
      .select("target_open_utc, label, settlement_ts, model_version")
      .eq("model_version", V1_MODEL_VERSION)
      .in("target_open_utc", chunk)
      .not("label", "is", null);
    if (sErr) throw sErr;
    for (const r of (sRows ?? []) as Record<string, unknown>[]) {
      settled.set(new Date(r.target_open_utc as string).toISOString(), {
        label: Number(r.label),
        ts: (r.settlement_ts as string | null) ?? null,
      });
    }
  }
  for (const ts of pending) {
    const hit = settled.get(ts);
    if (
      hit &&
      (await write(ts, hit.label, hit.ts, hit.ts ? "native" : null, "c85_settlements"))
    ) {
      fromSettlements++;
    } else if (!hit) {
      stillPending.push(ts);
    }
  }

  // 2) Native resolver for every other official interval, WITH timing
  //    provenance. Market close is not proof of settlement, so no close-time
  //    stamp is ever invented: either the venue publishes a settlement instant
  //    or we record the conservative first-observation time and say so.
  //
  //    Selection is newest-first plus a rotating slot for old pending rows, so
  //    a handful of permanently missing old markets cannot monopolise every
  //    pass and starve freshly closed intervals.
  let fromKalshi = 0;
  const { fetchV11NativeResolution } = await import("./kalshi.server");
  const newestFirst = [...stillPending].sort((a, b) => Date.parse(b) - Date.parse(a));
  const oldSlots = Math.min(2, Math.max(0, kalshiLimit - 1));
  const fresh = newestFirst.slice(0, Math.max(0, kalshiLimit - oldSlots));
  const oldPool = newestFirst.slice(fresh.length).reverse(); // oldest first
  const rotation: string[] = [];
  if (oldPool.length > 0 && oldSlots > 0) {
    const cursor = Math.floor(nowMs / (60 * 60_000)); // advances every hour
    for (let i = 0; i < Math.min(oldSlots, oldPool.length); i++) {
      rotation.push(oldPool[(cursor + i) % oldPool.length] as string);
    }
  }
  const attempts = [...new Set([...fresh, ...rotation])];
  for (const ts of attempts) {
    let res: Awaited<ReturnType<typeof fetchV11NativeResolution>> = null;
    try {
      res = await fetchV11NativeResolution(ts);
    } catch {
      res = null;
    }
    if (!res) continue;
    const label = res.result === "YES" ? 1 : -1;
    const native = res.nativeSettlementTs;
    const settlementTs = native ?? new Date().toISOString();
    const provenance = native ? "native" : "observed";
    if (await write(ts, label, settlementTs, provenance, "kalshi")) fromKalshi++;
  }

  return {
    total: fromSettlements + fromKalshi,
    fromSettlements,
    fromKalshi,
  };
}

/**
 * Score every official opportunity that has no committed decision, oldest
 * first, through the latest completed opportunity.
 *
 * COLD BOOTSTRAP: with no checkpoint at all this starts from the very first
 * context row. The previous version returned 0 in that case, so a fresh
 * deployment never scored anything.
 */
async function catchUp(
  sb: SupabaseClient,
  before: string,
  limit: number,
): Promise<{ recovered: number; bootstrapped: boolean; lastProcessedTs: string | null }> {
  const state = await readState(sb);
  const bootstrapped = !state.lastProcessedTs;
  let q = sb
    .from("v11_context_rows")
    .select("target_ts")
    .lt("target_ts", before)
    .order("target_ts", { ascending: true })
    .limit(limit);
  if (state.lastProcessedTs) q = q.gt("target_ts", state.lastProcessedTs);
  const { data, error } = await q;
  if (error) throw error;

  let n = 0;
  let lastTs: string | null = state.lastProcessedTs;
  for (const row of (data ?? []) as { target_ts: string }[]) {
    const ts = new Date(row.target_ts).toISOString();
    const res = await observeV11Target(sb, ts, {
      requestedRunMode: V11_RUN_MODES.RECOVERY,
    });
    // A refused commit means the chain did not advance; stop rather than
    // marching past a hole.
    if (!res.processed && !res.duplicate) break;
    if (res.processed) n++;
    lastTs = ts;
  }
  return { recovered: n, bootstrapped: bootstrapped && n > 0, lastProcessedTs: lastTs };
}

export async function runV11Maintenance(
  sb: SupabaseClient,
  opts: {
    now?: Date;
    labelLimit?: number;
    kalshiLimit?: number;
    contextLimit?: number;
    recoverLimit?: number;
  } = {},
): Promise<V11MaintenanceReport> {
  const now = opts.now ?? new Date();
  // Only fully-closed candles are official opportunities.
  // Exclusive upper bound: the candle currently in progress is not yet an
  // official opportunity for maintenance.
  const before = new Date(
    Math.floor(now.getTime() / CANDLE_MS) * CANDLE_MS,
  ).toISOString();

  const report: V11MaintenanceReport = {
    labelsRefreshed: 0,
    labelsFromSettlements: 0,
    labelsFromKalshi: 0,
    contextAdded: 0,
    vectorsBuilt: 0,
    headFitted: null,
    headSkippedReason: null,
    bootstrapped: false,
    recovered: 0,
    lastProcessedTs: null,
  };

  report.contextAdded = await importContext(sb, before, opts.contextLimit ?? 600);

  const labels = await refreshLabels(
    sb,
    opts.labelLimit ?? 400,
    opts.kalshiLimit ?? 12,
    before,
    now.getTime(),
  );
  report.labelsRefreshed = labels.total;
  report.labelsFromSettlements = labels.fromSettlements;
  report.labelsFromKalshi = labels.fromKalshi;

  // Trailing window only: full history is rebuilt by the offline backfill
  // script. Frozen inputs are re-derived from the same stored context, so this
  // never rewrites a value the model was scored against with different data.
  const built = await backfillV11Vectors(
    sb,
    new Date(now.getTime() - 3 * 86_400_000).toISOString(),
    new Date(now.getTime() + 60_000).toISOString(),
  );
  report.vectorsBuilt = built.written;

  // Today's head only. A head for a cutoff that has not passed is refused by
  // the fitter itself, so no future-dated head can be created here.
  const today = utcDate(now);
  const fit = await ensureV11Head(sb, today);
  if (fit.head) report.headFitted = today;
  else report.headSkippedReason = fit.reason ?? "UNKNOWN";

  const caught = await catchUp(sb, before, opts.recoverLimit ?? 24);
  report.recovered = caught.recovered;
  report.bootstrapped = caught.bootstrapped;
  report.lastProcessedTs = caught.lastProcessedTs;
  return report;
}
