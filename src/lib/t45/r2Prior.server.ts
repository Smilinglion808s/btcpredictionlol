// T45 Balanced — certified R2 prior resolution (server only).
//
// The frozen T45 head consumes a specific upstream prior stream:
//
//   THREE::P0.35::TECH0.18::STUMP_MIXED_FAST::Q0.08::INDEPENDENT
//
// The deployment package supplies that stream historically (2025-12-01 →
// 2026-08-18) but the repository does NOT contain a certified live generator
// for it. Rather than substitute a different prior — which would silently move
// the model off its frozen identity — T45 fails closed: with no certified prior
// for a target, no decision is produced for that target.

import type { SupabaseClient } from "@supabase/supabase-js";
import { T45_FEATURE_VERSION, T45_R2_PRIOR_KEY } from "./config";

export interface T45R2Prior {
  value: number | null;
  source: string | null;
  available: boolean;
  reason: string | null;
}

export const T45_R2_UNAVAILABLE_REASON = "R2_PRIOR_GENERATOR_UNAVAILABLE";

export async function resolveT45R2Prior(
  sb: SupabaseClient,
  targetTs: string,
): Promise<T45R2Prior> {
  // Historical (frozen package) rows carry the certified prior inline.
  const { data } = await sb
    .from("t45_features")
    .select("t45_r2_prediction, r2_prior_key, r2_prior_source")
    .eq("target_ts", targetTs)
    .eq("feature_version", T45_FEATURE_VERSION)
    .maybeSingle();

  const row = (data ?? null) as Record<string, unknown> | null;
  const value = row?.t45_r2_prediction;
  if (
    row &&
    row.r2_prior_key === T45_R2_PRIOR_KEY &&
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return {
      value: Math.trunc(value),
      source: (row.r2_prior_source as string | null) ?? "STORED",
      available: true,
      reason: null,
    };
  }

  return {
    value: null,
    source: null,
    available: false,
    reason: T45_R2_UNAVAILABLE_REASON,
  };
}
