// Version 1.1 — off-critical-path maintenance.
//
// Nothing here runs before a decision. It refreshes labels, catches context and
// vectors up, fits daily heads and bootstraps the confidence history AFTER the
// boundary work is finished, so a slow refit can never delay a T+45 decision.
// It cannot send anything.

import type { SupabaseClient } from "@supabase/supabase-js";
import { V11_RUN_MODES, utcDate } from "./config";
import { backfillV11Vectors, ensureV11Head } from "./fit.server";
import { observeV11Target } from "./observer.server";
import { readState, upsertContextRow, readContextRow } from "./store.server";

export interface V11MaintenanceReport {
  labelsRefreshed: number;
  contextAdded: number;
  vectorsBuilt: number;
  headFitted: string | null;
  headSkippedReason: string | null;
  recovered: number;
}

/**
 * Copy newly settled official outcomes onto the V11 context rows.
 *
 * Labels are only ever FILLED IN, never cleared: the upsert path preserves an
 * existing settlement, so a later read that has lost the outcome cannot erase a
 * label the model was already scored against.
 */
async function refreshLabels(sb: SupabaseClient, limit: number): Promise<number> {
  const { data, error } = await sb
    .from("v11_context_rows")
    .select("target_ts")
    .is("label", null)
    .order("target_ts", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const pending = ((data ?? []) as { target_ts: string }[]).map((r) =>
    new Date(r.target_ts).toISOString(),
  );
  if (pending.length === 0) return 0;

  const { data: settled, error: sErr } = await sb
    .from("c85_targets")
    .select("target_open_utc, official_label, official_settlement_ts")
    .in("target_open_utc", pending)
    .not("official_label", "is", null);
  if (sErr) throw sErr;

  let n = 0;
  for (const row of (settled ?? []) as Record<string, unknown>[]) {
    const ts = new Date(row.target_open_utc as string).toISOString();
    const label = Number(row.official_label);
    if (label !== 1 && label !== -1) continue;
    const existing = await readContextRow(sb, ts);
    if (!existing || existing.label !== null) continue;
    await upsertContextRow(
      sb,
      {
        ...existing,
        label,
        settlementTs:
          (row.official_settlement_ts as string | null) ?? existing.settlementTs,
      },
      "c85_targets",
    );
    n++;
  }
  return n;
}

/**
 * Recover any official opportunity after the checkpoint that has no committed
 * decision, oldest first. Recovered rows are RECOVERY — never live evidence.
 */
async function recoverGaps(
  sb: SupabaseClient,
  before: string,
  limit: number,
): Promise<number> {
  const state = await readState(sb);
  if (!state.lastProcessedTs) return 0;
  const { data, error } = await sb
    .from("v11_context_rows")
    .select("target_ts")
    .gt("target_ts", state.lastProcessedTs)
    .lt("target_ts", before)
    .order("target_ts", { ascending: true })
    .limit(limit);
  if (error) throw error;
  let n = 0;
  for (const row of (data ?? []) as { target_ts: string }[]) {
    const res = await observeV11Target(sb, row.target_ts, {
      requestedRunMode: V11_RUN_MODES.RECOVERY,
    });
    if (res.processed) n++;
  }
  return n;
}

export async function runV11Maintenance(
  sb: SupabaseClient,
  opts: { now?: Date; labelLimit?: number; recoverLimit?: number } = {},
): Promise<V11MaintenanceReport> {
  const now = opts.now ?? new Date();
  const report: V11MaintenanceReport = {
    labelsRefreshed: 0,
    contextAdded: 0,
    vectorsBuilt: 0,
    headFitted: null,
    headSkippedReason: null,
    recovered: 0,
  };

  report.labelsRefreshed = await refreshLabels(sb, opts.labelLimit ?? 400);
  // Trailing window only: full history is rebuilt by the offline backfill script.
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

  report.recovered = await recoverGaps(sb, now.toISOString(), opts.recoverLimit ?? 24);
  return report;
}
