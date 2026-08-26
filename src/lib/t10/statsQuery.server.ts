// T10 Bridge R1 — dashboard aggregates and pending row.
//
// Reads t10_* only. Nothing here can influence a decision.

import { createClient } from "@supabase/supabase-js";
import {
  T10_ACTIVATION_KEY,
  T10_ACTIVATION_TABLE,
  T10_BRIDGE_VARIANT,
  T10_BRIDGE_VERSION,
  T10_CONFIG_HASH,
  T10_FEATURE_ORDER,
  T10_FEATURE_ORDER_HASH,
  T10_MODEL_NAME,
  T10_PREDICTIONS_TABLE,
  boiseDate,
  floorTarget,
} from "./config";

type Row = Record<string, unknown>;

function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface T10Stats {
  model_name: string;
  model_version: string;
  model_variant: string;
  config_hash: string;
  feature_order_hash: string;
  feature_count: number;
  mode: string;
  webhooks_enabled: boolean;
  activation_boundary_ts: string | null;
  total_rows: number;
  packet_ready: number;
  packet_ready_rate: number | null;
  traded: number;
  wins: number;
  losses: number;
  pushes: number;
  abstains: number;
  pending: number;
  win_rate: number | null;
  net_units: number;
  last_target_ts: string | null;
  last_decision_reason: string | null;
  last_decision_offset_ms: number | null;
  signals_sent: number;
  last_webhook_offset_ms: number | null;
  last_webhook_latency_ms: number | null;
  last_webhook_target_ts: string | null;
  avg_decision_offset_ms: number | null;
  today: {
    date: string;
    traded: number;
    wins: number;
    losses: number;
    win_rate: number | null;
    net_units: number;
  };
  daily: {
    date: string;
    traded: number;
    wins: number;
    losses: number;
    net: number;
    win_rate: number | null;
  }[];
}

const PAGE = 1000;

async function loadRecent(limit = 4000): Promise<Row[]> {
  const client = sb();
  const rows: Row[] = [];
  for (let from = 0; from < limit; from += PAGE) {
    const to = Math.min(from + PAGE, limit) - 1;
    const { data, error } = await client
      .from(T10_PREDICTIONS_TABLE)
      .select(
        "target_ts, run_mode, packet_complete, policy_would_trade, policy_decision_reason, result, raw_score, actual_direction, resolved_at, decision_offset_ms, boise_date, webhook_sent, webhook_sent_at, webhook_offset_ms, webhook_latency_ms",
      )
      .eq("model_version", T10_BRIDGE_VERSION)
      .order("target_ts", { ascending: false })
      .range(from, to);
    if (error) throw new Error(`t10_stats:${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < to - from + 1) break;
  }
  return rows;
}

export async function buildT10Stats(): Promise<T10Stats> {
  const client = sb();
  const { data: act } = await client
    .from(T10_ACTIVATION_TABLE)
    .select("*")
    .eq("singleton_key", T10_ACTIVATION_KEY)
    .maybeSingle();
  const activation = (act ?? {}) as Row;

  const rows = await loadRecent();
  const live = rows.filter((r) => String(r.run_mode) === "LIVE");
  const todayKey = boiseDate(new Date().toISOString());

  let packetReady = 0;
  let traded = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let abstains = 0;
  let pending = 0;
  let net = 0;
  const dayMap = new Map<string, { traded: number; wins: number; losses: number }>();
  const today = {
    date: todayKey,
    traded: 0,
    wins: 0,
    losses: 0,
    win_rate: null as number | null,
    net_units: 0,
  };

  for (const r of live) {
    if (r.packet_complete === true) packetReady += 1;
    const isTrade = r.policy_would_trade === true;
    if (isTrade) traded += 1;
    else abstains += 1;
    const result = String(r.result ?? "");
    const isToday = String(r.boise_date ?? "") === todayKey;
    if (!r.resolved_at) {
      if (isTrade) pending += 1;
      continue;
    }
    if (result === "WIN") wins += 1;
    else if (result === "LOSS") losses += 1;
    else if (result === "PUSH") pushes += 1;
    net += Number(r.raw_score ?? 0);
    if (isTrade) {
      const key = String(r.boise_date ?? boiseDate(String(r.target_ts)));
      const agg = dayMap.get(key) ?? { traded: 0, wins: 0, losses: 0 };
      if (result === "WIN" || result === "LOSS" || result === "PUSH") agg.traded += 1;
      if (result === "WIN") agg.wins += 1;
      if (result === "LOSS") agg.losses += 1;
      dayMap.set(key, agg);
    }
    if (isToday && isTrade) {
      today.traded += 1;
      if (result === "WIN") {
        today.wins += 1;
        today.net_units += 1;
      }
      if (result === "LOSS") {
        today.losses += 1;
        today.net_units -= 1;
      }
    }
  }

  const decided = wins + losses;
  today.win_rate = today.wins + today.losses > 0 ? today.wins / (today.wins + today.losses) : null;

  const last = live[0] ?? null;
  // Delivery timing: `live` is newest-first, so the first sent row is the most
  // recent signal actually put on the wire.
  const sent = live.filter((r) => r.webhook_sent === true);
  const lastSent = sent[0] ?? null;
  const offsets = live
    .map((r) => Number(r.decision_offset_ms))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 120_000)
    .slice(0, 50);
  return {
    model_name: T10_MODEL_NAME,
    model_version: T10_BRIDGE_VERSION,
    model_variant: T10_BRIDGE_VARIANT,
    config_hash: T10_CONFIG_HASH,
    feature_order_hash: T10_FEATURE_ORDER_HASH,
    feature_count: T10_FEATURE_ORDER.length,
    mode: String(activation.mode ?? "SHADOW_ONLY"),
    webhooks_enabled: activation.webhooks_enabled === true,
    activation_boundary_ts: (activation.activation_boundary_ts as string | null) ?? null,
    total_rows: live.length,
    packet_ready: packetReady,
    packet_ready_rate: live.length ? packetReady / live.length : null,
    traded,
    wins,
    losses,
    pushes,
    abstains,
    pending,
    win_rate: decided ? wins / decided : null,
    net_units: net,
    last_target_ts: last ? new Date(String(last.target_ts)).toISOString() : null,
    last_decision_reason: (last?.policy_decision_reason as string | null) ?? null,
    last_decision_offset_ms:
      last?.decision_offset_ms == null ? null : Number(last.decision_offset_ms),
    signals_sent: sent.length,
    last_webhook_offset_ms:
      lastSent?.webhook_offset_ms == null ? null : Number(lastSent.webhook_offset_ms),
    last_webhook_latency_ms:
      lastSent?.webhook_latency_ms == null ? null : Number(lastSent.webhook_latency_ms),
    last_webhook_target_ts: lastSent ? new Date(String(lastSent.target_ts)).toISOString() : null,
    avg_decision_offset_ms: offsets.length
      ? offsets.reduce((a, b) => a + b, 0) / offsets.length
      : null,
    today,
    daily: [...dayMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14)
      .map(([date, a]) => ({
        date,
        traded: a.traded,
        wins: a.wins,
        losses: a.losses,
        net: a.wins - a.losses,
        win_rate: a.wins + a.losses ? a.wins / (a.wins + a.losses) : null,
      })),
  };
}

export interface T10Pending {
  target_ts: string | null;
  packet_complete: boolean;
  base_direction: string | null;
  policy_would_trade: boolean;
  policy_direction: string | null;
  policy_decision_reason: string | null;
  final_prediction: string | null;
  correctness_probability: number | null;
  long_rank: number | null;
  fast_rank: number | null;
  fit_certified: boolean;
  decision_offset_ms: number | null;
  is_current_candle: boolean;
}

/** Newest LIVE T10 row — its decision for the candle now in flight. */
export async function loadT10Pending(): Promise<T10Pending | null> {
  const { data } = await sb()
    .from(T10_PREDICTIONS_TABLE)
    .select(
      "target_ts, packet_complete, base_direction, policy_would_trade, policy_direction, policy_decision_reason, final_prediction, correctness_probability, long_rank, fast_rank, fit_certified, decision_offset_ms",
    )
    .eq("model_version", T10_BRIDGE_VERSION)
    .eq("run_mode", "LIVE")
    .order("target_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  const r = data as Row | null;
  if (!r) return null;
  const ts = new Date(String(r.target_ts)).toISOString();
  return {
    target_ts: ts,
    packet_complete: r.packet_complete === true,
    base_direction: (r.base_direction as string | null) ?? null,
    policy_would_trade: r.policy_would_trade === true,
    policy_direction: (r.policy_direction as string | null) ?? null,
    policy_decision_reason: (r.policy_decision_reason as string | null) ?? null,
    final_prediction: (r.final_prediction as string | null) ?? null,
    correctness_probability:
      r.correctness_probability == null ? null : Number(r.correctness_probability),
    long_rank: r.long_rank == null ? null : Number(r.long_rank),
    fast_rank: r.fast_rank == null ? null : Number(r.fast_rank),
    fit_certified: r.fit_certified === true,
    decision_offset_ms: r.decision_offset_ms == null ? null : Number(r.decision_offset_ms),
    is_current_candle: new Date(ts).getTime() === floorTarget(Date.now()),
  };
}
