// C85 durable decision store.
//
// Invariants enforced here:
//   * one logical decision per (model_version, ticker, target_open_utc),
//     including abstentions — an abstain is a recorded decision, not a gap;
//   * a published LIVE side is immutable (the database trigger
//     c85_targets_guard_immutable is the real enforcement, this is the friendly
//     path);
//   * the decision row is durable BEFORE any dispatch is attempted, so a crash
//     between commit and send leaves a replayable outbox entry, never a silent
//     signal;
//   * RESEARCH_BACKFILL and BRIDGE rows never enqueue an outbox entry.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  C85_MODEL_VERSION,
  C85_OUTBOX_TABLE,
  C85_TARGETS_TABLE,
} from "./config";

export type RunMode = "LIVE" | "RESEARCH_BACKFILL" | "BRIDGE";

export interface C85DecisionInput {
  ticker: string;
  target_open_utc: string;
  deadline_utc: string;
  run_mode: RunMode;
  status: string;

  binance_complete?: boolean | null;
  anchor_valid?: boolean | null;
  cm_valid?: boolean | null;
  aux_valid?: boolean | null;
  direction_valid?: boolean | null;
  structure_valid?: boolean | null;
  core_valid?: boolean | null;

  probability_yes?: number | null;
  proposal?: number | null;
  probability_correct?: number | null;

  aux_long_direction_logit?: number | null;
  aux_long_scale_logit?: number | null;
  aux_recent_direction_logit?: number | null;
  aux_recent_scale_logit?: number | null;

  admission_rank?: number | null;
  admission_count?: number | null;
  filter_rank?: number | null;
  filter_count?: number | null;

  core_side?: number | null;
  extension_fired?: boolean | null;
  last_yes_price?: number | null;
  base_side?: number | null;
  weak?: boolean | null;

  deterioration_ewma16?: number | null;
  deterioration_ewma128?: number | null;
  deterioration_settled_count?: number | null;
  deterioration_warmup?: boolean | null;

  final_side: number;
  gate_reasons?: string[] | null;
  consumed_state_cutoff_ns?: string | null;

  direction_fit_id?: string | null;
  meta_fit_id?: string | null;
  aux_fit_month?: string | null;
  feature_order_sha256?: string | null;
  features?: Record<string, unknown> | null;
  source_ids?: Record<string, unknown> | null;
  source_hash?: string | null;

  target_open_ns?: string | null;
  packet_freeze_ns?: string | null;
  compute_started_ns?: string | null;
  compute_complete_ns?: string | null;
  decision_durable_ns?: string | null;
  dispatch_ns?: string | null;
  publication_offset_ms?: number | null;
}

export function dedupeKey(ticker: string, targetOpenUtc: string): string {
  return `C85:${C85_MODEL_VERSION}:${ticker}:${targetOpenUtc}`;
}

/**
 * Persist the decision. Returns the stored row plus whether this call created
 * it, so a duplicate worker job is a no-op rather than a second signal.
 */
export async function upsertC85Decision(
  supabase: SupabaseClient,
  input: C85DecisionInput,
): Promise<{ row: Record<string, unknown>; created: boolean; immutableConflict: boolean }> {
  const { data: existing } = await supabase
    .from(C85_TARGETS_TABLE)
    .select("id, run_mode, final_side, published_at, webhook_status")
    .eq("model_version", C85_MODEL_VERSION)
    .eq("ticker", input.ticker)
    .eq("target_open_utc", input.target_open_utc)
    .maybeSingle();

  const prior = existing as Record<string, unknown> | null;
  if (prior && prior.published_at && prior.run_mode === "LIVE") {
    // Already published. The side is frozen; report the conflict instead of
    // rewriting history.
    const changed = Number(prior.final_side) !== input.final_side;
    return { row: prior, created: false, immutableConflict: changed };
  }

  const { data, error } = await supabase
    .from(C85_TARGETS_TABLE)
    .upsert(
      {
        model_version: C85_MODEL_VERSION,
        webhook_dedupe_key: dedupeKey(input.ticker, input.target_open_utc),
        published_at: input.run_mode === "LIVE" ? new Date().toISOString() : null,
        ...input,
      } as never,
      { onConflict: "model_version,ticker,target_open_utc" },
    )
    .select()
    .single();
  if (error) throw new Error(`c85_upsert_decision:${error.message}`);
  return { row: data as Record<string, unknown>, created: !prior, immutableConflict: false };
}

/**
 * Enqueue exactly one outbox entry for a live directional decision. Abstains,
 * backfill and bridge rows never enqueue. The unique dedupe key makes a retry
 * or a duplicate worker harmless.
 */
export async function enqueueC85Outbox(
  supabase: SupabaseClient,
  args: {
    targetId: string;
    ticker: string;
    targetOpenUtc: string;
    payload: Record<string, unknown>;
    expiresAt: string;
  },
): Promise<{ enqueued: boolean }> {
  const { error } = await supabase.from(C85_OUTBOX_TABLE).insert(
    {
      dedupe_key: dedupeKey(args.ticker, args.targetOpenUtc),
      target_id: args.targetId,
      payload: args.payload,
      state: "PENDING",
      expires_at: args.expiresAt,
    } as never,
  );
  // 23505 = already enqueued; that is the desired idempotent outcome.
  if (error && !error.message.includes("duplicate key")) {
    throw new Error(`c85_enqueue_outbox:${error.message}`);
  }
  return { enqueued: !error };
}

export async function markC85Dispatch(
  supabase: SupabaseClient,
  args: {
    targetId: string;
    ticker: string;
    targetOpenUtc: string;
    status: string;
    responseStatus?: number | null;
    error?: string | null;
    dispatchNs?: string | null;
    publicationOffsetMs?: number | null;
  },
): Promise<void> {
  await supabase
    .from(C85_TARGETS_TABLE)
    .update(
      {
        webhook_status: args.status,
        webhook_last_error: args.error ?? null,
        dispatch_ns: args.dispatchNs ?? null,
        publication_offset_ms: args.publicationOffsetMs ?? null,
      } as never,
    )
    .eq("id", args.targetId);

  await supabase
    .from(C85_OUTBOX_TABLE)
    .update(
      {
        state: args.status === "SENT" ? "SENT" : args.status,
        sent_at: args.status === "SENT" ? new Date().toISOString() : null,
        response_status: args.responseStatus ?? null,
        last_error: args.error ?? null,
      } as never,
    )
    .eq("dedupe_key", dedupeKey(args.ticker, args.targetOpenUtc));
}
