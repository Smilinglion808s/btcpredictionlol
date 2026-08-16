// B4x4-ES1 Binance Order-Book R1 — deterministic CSV shaping (pure).
//
// The dedicated export joins, per target: SPOT features, USD_M_PERP features,
// all six policy decisions and their resolution attribution. The 100 ms stream
// is never exported here; raw observations stay in the supplemental export.

import { BINANCE_OB_POLICIES, type BinanceObPolicyName } from "./config";

export type Row = Record<string, unknown>;

/** Feature columns copied per market, in this exact order. */
export const FEATURE_EXPORT_COLUMNS = [
  "capture_status",
  "ready",
  "ready_reason",
  "history_ready",
  "history_ready_reason",
  "history_valid_count",
  "observation_count_60s",
  "expected_observation_count_60s",
  "watchdog_created",
  "failure_reason",
  "sequence_ok",
  "book_complete_10bps",
  "resync_generation",
  "feature_cutoff_ts",
  "final_exchange_event_ts",
  "final_received_at",
  "final_target_age_ms",
  "final_update_id",
  "final_best_bid",
  "final_best_ask",
  "final_mid_price",
  "final_spread_bps",
  "final_microprice_displacement_bps",
  "final_bid_depth_btc_10bps",
  "final_ask_depth_btc_10bps",
  "final_total_depth_btc_10bps",
  "final_total_depth_usd_10bps",
  "final_imbalance_1bps",
  "final_imbalance_2bps",
  "final_imbalance_5bps",
  "final_imbalance_10bps",
  "final_abs_imbalance_10bps",
  "mean_imbalance_10bps_5s",
  "mean_imbalance_10bps_15s",
  "mean_imbalance_10bps_60s",
  "median_imbalance_10bps_15s",
  "slope_imbalance_10bps_15s",
  "slope_imbalance_10bps_60s",
  "stddev_imbalance_10bps_60s",
  "range_imbalance_10bps_60s",
  "sign_persistence_5s",
  "sign_persistence_15s",
  "sign_persistence_60s",
  "sign_change_count_60s",
  "normalized_ofi_5s",
  "normalized_ofi_15s",
  "normalized_ofi_60s",
  "bid_replenishment_btc_15s",
  "ask_replenishment_btc_15s",
  "abs_imbalance_percentile_96",
  "total_depth_percentile_96",
  "spread_percentile_96",
  "receive_latency_p50_ms",
  "receive_latency_p95_ms",
] as const;

/** Policy columns copied per policy, in this exact order. */
export const POLICY_EXPORT_COLUMNS = [
  "qualified",
  "qualification_reason",
  "candidate_direction",
  "would_trade",
  "decision_reason",
  "actual_direction",
  "result",
  "result_score",
  "resolved_at",
  "resolver_version",
  "resolution_attempt_count",
  "run_mode",
  "webhook_eligible",
  "input_values_hash",
] as const;

export const COMBINED_HEADER_PREFIX = [
  "target_ts",
  "local_date_boise",
  "venue",
  "symbol",
  "feature_version",
  "policy_version",
  "collector_version",
  "implementation_revision",
  "config_hash",
  "outcome_source",
  "spot_present",
  "perp_present",
  "policy_row_count",
] as const;

export function combinedColumns(): string[] {
  const cols: string[] = [...COMBINED_HEADER_PREFIX];
  for (const m of ["spot", "perp"] as const) {
    for (const c of FEATURE_EXPORT_COLUMNS) cols.push(`${m}_${c}`);
  }
  for (const p of BINANCE_OB_POLICIES) {
    const short = p.toLowerCase();
    for (const c of POLICY_EXPORT_COLUMNS) cols.push(`${short}_${c}`);
  }
  return cols;
}

export function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCsv(columns: readonly string[], rows: readonly Row[]): string {
  const header = columns.join(",");
  if (rows.length === 0) return `${header}\n`;
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(",")).join("\n");
  return `${header}\n${body}\n`;
}

export interface CombinedInputs {
  features: readonly Row[];
  policies: readonly Row[];
  localDate(iso: string): string;
  outcomeSource: string;
  featureVersion: string;
  policyVersion: string;
}

/**
 * One row per target. Missing markets/policies produce empty cells — never
 * fabricated zeros — so absence stays visible in the dataset.
 */
export function buildCombinedRows(input: CombinedInputs): Row[] {
  const byTarget = new Map<string, { spot: Row | null; perp: Row | null; policies: Map<string, Row> }>();
  const bucket = (ts: string) => {
    let b = byTarget.get(ts);
    if (!b) {
      b = { spot: null, perp: null, policies: new Map() };
      byTarget.set(ts, b);
    }
    return b;
  };

  for (const f of input.features) {
    const ts = new Date(String(f.target_ts)).toISOString();
    const b = bucket(ts);
    if (f.market_kind === "SPOT") b.spot = f;
    else if (f.market_kind === "USD_M_PERP") b.perp = f;
  }
  for (const p of input.policies) {
    const ts = new Date(String(p.target_ts)).toISOString();
    bucket(ts).policies.set(String(p.policy_name), p);
  }

  const targets = [...byTarget.keys()].sort();
  return targets.map((ts) => {
    const b = byTarget.get(ts)!;
    const anyFeature = b.spot ?? b.perp;
    const anyPolicy = [...b.policies.values()][0] ?? null;
    const row: Row = {
      target_ts: ts,
      local_date_boise: input.localDate(ts),
      venue: anyFeature?.venue ?? null,
      symbol: anyFeature?.symbol ?? null,
      feature_version: anyFeature?.feature_version ?? input.featureVersion,
      policy_version: anyPolicy?.policy_version ?? input.policyVersion,
      collector_version: anyFeature?.collector_version ?? null,
      implementation_revision: anyFeature?.implementation_revision ?? null,
      config_hash: anyFeature?.config_hash ?? null,
      outcome_source: input.outcomeSource,
      spot_present: b.spot != null,
      perp_present: b.perp != null,
      policy_row_count: b.policies.size,
    };
    for (const [prefix, src] of [
      ["spot", b.spot],
      ["perp", b.perp],
    ] as const) {
      for (const c of FEATURE_EXPORT_COLUMNS) row[`${prefix}_${c}`] = src ? (src[c] ?? null) : null;
    }
    for (const p of BINANCE_OB_POLICIES as readonly BinanceObPolicyName[]) {
      const src = b.policies.get(p) ?? null;
      const short = p.toLowerCase();
      for (const c of POLICY_EXPORT_COLUMNS) row[`${short}_${c}`] = src ? (src[c] ?? null) : null;
    }
    return row;
  });
}

/** Compact per-target Binance columns appended to the main ES1 CSV. */
export const ES1_COMPACT_BINANCE_COLUMNS = [
  "binance_ob_version",
  "binance_ob_mode",
  "binance_ob_capture_status",
  "binance_ob_spot_ready",
  "binance_ob_perp_ready",
  "binance_ob_ready_reason",
  "binance_ob_history_ready",
  "binance_ob_history_valid_count",
  "binance_ob_final_imbalance_10bps",
  "binance_ob_abs_percentile_96",
  "binance_ob_sign_persistence_15s",
  "binance_ob_shadow_direction",
  "binance_ob_shadow_would_trade",
  "binance_ob_shadow_reason",
  "binance_ob_selected_shadow_policy",
  "binance_ob_influenced_decision",
] as const;
